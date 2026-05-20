import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import { requireAdmin } from '../auth.js';
import {
  testConnection as ciscoTestConnection,
  discoverOperations as ciscoDiscoverOperations,
  type DiscoveredOperation,
} from '../monitor/cisco/collector.js';
import { encryptSecret, decryptSecret } from '../monitor/cisco/secret.js';
import type { CiscoDeviceConn } from '../monitor/cisco/snmp.js';

const router = Router();

// Columns we expose. Password / community fields are deliberately
// dropped — never echoed back to a client, even an authenticated one.
const PUBLIC_COLS = `
  id, name, host, snmp_port, snmp_version, v3_username,
  v3_auth_protocol, v3_priv_protocol,
  poll_interval_seconds, enabled, last_seen, last_error, created_at
`;

interface DeviceRow {
  id: string;
  name: string;
  host: string;
  snmp_port: number;
  snmp_version: '2c' | '3';
  community: string | null;
  v3_username: string | null;
  v3_auth_protocol: string | null;
  v3_auth_password: string | null;
  v3_priv_protocol: string | null;
  v3_priv_password: string | null;
  poll_interval_seconds: number;
  enabled: number;
}

function rowToConn(r: DeviceRow): CiscoDeviceConn {
  return {
    host: r.host,
    snmp_port: r.snmp_port,
    snmp_version: r.snmp_version === '3' ? '3' : '2c',
    community: decryptSecret(r.community),
    v3_username: r.v3_username,
    v3_auth_protocol: r.v3_auth_protocol,
    v3_auth_password: decryptSecret(r.v3_auth_password),
    v3_priv_protocol: r.v3_priv_protocol,
    v3_priv_password: decryptSecret(r.v3_priv_password),
  };
}

function loadDeviceOr404(id: string, res: Response): DeviceRow | null {
  const row = getDb().prepare('SELECT * FROM cisco_devices WHERE id = ?').get(String(id)) as DeviceRow | undefined;
  if (!row) { res.status(404).json({ error: 'Device not found' }); return null; }
  return row;
}

// ─────────────────────────── CRUD ────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  const rows = getDb().prepare(`SELECT ${PUBLIC_COLS} FROM cisco_devices ORDER BY name`).all();
  res.json(rows);
});

router.get('/:id', (req: Request, res: Response) => {
  const row = getDb().prepare(`SELECT ${PUBLIC_COLS} FROM cisco_devices WHERE id = ?`).get(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Device not found' });
  res.json(row);
});

router.post('/', requireAdmin, (req: Request, res: Response) => {
  const b = req.body as Partial<DeviceRow> & { v3_auth_password?: string; v3_priv_password?: string; community?: string };
  if (!b.name || !b.host) return res.status(400).json({ error: 'name and host are required' });
  const version = b.snmp_version === '3' ? '3' : '2c';
  if (version === '2c' && !b.community) return res.status(400).json({ error: 'community is required for SNMP v2c' });
  if (version === '3' && !b.v3_username) return res.status(400).json({ error: 'v3_username is required for SNMP v3' });

  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO cisco_devices
      (id, name, host, snmp_port, snmp_version, community,
       v3_username, v3_auth_protocol, v3_auth_password,
       v3_priv_protocol, v3_priv_password,
       poll_interval_seconds, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, b.name.trim(), b.host.trim(), b.snmp_port ?? 161, version,
    version === '2c' ? encryptSecret(b.community!) : null,
    version === '3' ? b.v3_username : null,
    version === '3' ? (b.v3_auth_protocol || null) : null,
    version === '3' ? encryptSecret(b.v3_auth_password ?? null) : null,
    version === '3' ? (b.v3_priv_protocol || null) : null,
    version === '3' ? encryptSecret(b.v3_priv_password ?? null) : null,
    b.poll_interval_seconds ?? 60,
    b.enabled ?? 1,
  );
  const row = getDb().prepare(`SELECT ${PUBLIC_COLS} FROM cisco_devices WHERE id = ?`).get(id);
  res.status(201).json(row);
});

router.put('/:id', requireAdmin, (req: Request, res: Response) => {
  const existing = loadDeviceOr404(String(req.params.id), res); if (!existing) return;
  const b = req.body as Partial<DeviceRow> & { v3_auth_password?: string; v3_priv_password?: string; community?: string };

  // For secret fields: undefined = keep current, empty string = clear,
  // anything else = re-encrypt
  const updatedCommunity =
    b.community === undefined ? existing.community : (b.community === '' ? null : encryptSecret(b.community));
  const updatedAuthPw =
    b.v3_auth_password === undefined ? existing.v3_auth_password : (b.v3_auth_password === '' ? null : encryptSecret(b.v3_auth_password));
  const updatedPrivPw =
    b.v3_priv_password === undefined ? existing.v3_priv_password : (b.v3_priv_password === '' ? null : encryptSecret(b.v3_priv_password));

  getDb().prepare(`
    UPDATE cisco_devices
    SET name = ?, host = ?, snmp_port = ?, snmp_version = ?,
        community = ?, v3_username = ?, v3_auth_protocol = ?, v3_auth_password = ?,
        v3_priv_protocol = ?, v3_priv_password = ?,
        poll_interval_seconds = ?, enabled = ?
    WHERE id = ?
  `).run(
    (b.name ?? existing.name).trim(),
    (b.host ?? existing.host).trim(),
    b.snmp_port ?? existing.snmp_port,
    b.snmp_version ?? existing.snmp_version,
    updatedCommunity,
    b.v3_username ?? existing.v3_username,
    b.v3_auth_protocol ?? existing.v3_auth_protocol,
    updatedAuthPw,
    b.v3_priv_protocol ?? existing.v3_priv_protocol,
    updatedPrivPw,
    b.poll_interval_seconds ?? existing.poll_interval_seconds,
    b.enabled ?? existing.enabled,
    existing.id,
  );

  const row = getDb().prepare(`SELECT ${PUBLIC_COLS} FROM cisco_devices WHERE id = ?`).get(existing.id);
  res.json(row);
});

router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const result = getDb().prepare('DELETE FROM cisco_devices WHERE id = ?').run(String(req.params.id));
  if (result.changes === 0) return res.status(404).json({ error: 'Device not found' });
  res.status(204).send();
});

// ─────────────────────── Live actions ─────────────────────────────

router.post('/:id/test', requireAdmin, async (req: Request, res: Response) => {
  const existing = loadDeviceOr404(String(req.params.id), res); if (!existing) return;
  const result = await ciscoTestConnection(rowToConn(existing));
  const db = getDb();
  if (result.ok) {
    db.prepare('UPDATE cisco_devices SET last_seen = ?, last_error = NULL WHERE id = ?')
      .run(Math.floor(Date.now() / 1000), existing.id);
  } else {
    db.prepare('UPDATE cisco_devices SET last_error = ? WHERE id = ?').run(result.error || 'unknown error', existing.id);
  }
  res.json(result);
});

router.get('/:id/operations', requireAdmin, async (req: Request, res: Response) => {
  const existing = loadDeviceOr404(String(req.params.id), res); if (!existing) return;
  try {
    const ops = await ciscoDiscoverOperations(rowToConn(existing));
    res.json(ops);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Import selected operations as oneresponse targets.
//   { group_id, operations: [{ index, type, target, name? }] }
// Returns { created: [target_id, ...], errors: [...] }
router.post('/:id/import', requireAdmin, (req: Request, res: Response) => {
  const existing = loadDeviceOr404(String(req.params.id), res); if (!existing) return;
  const { group_id, operations } = req.body as {
    group_id?: string;
    operations?: { index: number; type: string; target?: string | null; name?: string }[];
  };
  if (!group_id) return res.status(400).json({ error: 'group_id is required' });
  if (!Array.isArray(operations) || operations.length === 0) {
    return res.status(400).json({ error: 'operations[] required' });
  }

  const db = getDb();
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(group_id);
  if (!group) return res.status(400).json({ error: 'Invalid group_id' });

  const insert = db.prepare(`
    INSERT INTO targets
      (id, group_id, name, host, site_code, probe_interval, probe_count, enabled,
       probe_type, device_id, ipsla_oper_index, ipsla_oper_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'cisco-ipsla', ?, ?, ?)
  `);

  const out = { created: [] as string[], errors: [] as string[] };
  const tx = db.transaction((ops: typeof operations) => {
    for (const op of ops!) {
      try {
        if (!Number.isFinite(op.index) || !op.type) {
          out.errors.push(`Skipped operation with bad index/type: ${JSON.stringify(op)}`);
          continue;
        }
        const id = uuidv4();
        const name = op.name?.trim() || `${existing.name}#${op.index}`;
        // Use the discovered op target if we have one, otherwise the
        // device host — host is required by the targets table and not
        // really used for cisco-ipsla probes (we read results from SNMP),
        // but keeping it populated keeps existing UI happy.
        const host = (op.target || existing.host).trim();
        insert.run(
          id, group_id, name, host, null, existing.poll_interval_seconds, 1,
          existing.id, op.index, op.type,
        );
        out.created.push(id);
      } catch (err) {
        out.errors.push(`Operation ${op.index}: ${(err as Error).message}`);
      }
    }
  });
  tx(operations!);
  res.json(out);
});

export default router;

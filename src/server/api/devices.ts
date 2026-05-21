import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import { requireAdmin } from '../auth.js';
import {
  testConnection as ciscoTestConnection,
  discoverOperations as ciscoDiscoverOperations,
  pollOperation as ciscoPollOperation,
  type DiscoveredOperation,
} from '../monitor/cisco/collector.js';
import { encryptSecret, decryptSecret } from '../monitor/cisco/secret.js';
import { snmpGet, type CiscoDeviceConn } from '../monitor/cisco/snmp.js';
import { calculateSlaScore } from '../monitor/scoring.js';
import {
  RTT_MON_LATEST_RTT_OPER_COMPLETION_TIME,
  RTT_MON_LATEST_RTT_OPER_SENSE,
  RTT_MON_LATEST_JITTER_NUM_RTT,
  RTT_MON_LATEST_JITTER_RTT_SUM,
  RTT_MON_LATEST_JITTER_RTT_MIN,
  RTT_MON_LATEST_JITTER_RTT_MAX,
  RTT_MON_LATEST_JITTER_LOSS_SD,
  RTT_MON_LATEST_JITTER_LOSS_DS,
  RTT_MON_LATEST_JITTER_OOS,
  RTT_MON_LATEST_JITTER_MIA,
  RTT_MON_LATEST_JITTER_SENSE,
  RTT_MON_LATEST_JITTER_MOS,
  type OperKind,
} from '../monitor/cisco/mibConstants.js';

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
  const defaultCommunityRow = getDb().prepare("SELECT value FROM settings WHERE key = 'default_snmp_community'").get() as { value: string | null } | undefined;
  const defaultCommunity = (defaultCommunityRow?.value || '').trim();
  const effectiveCommunity = (b.community || '').trim() || defaultCommunity;
  if (version === '2c' && !effectiveCommunity) return res.status(400).json({ error: 'community is required for SNMP v2c (or set default_snmp_community in Settings)' });
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
    version === '2c' ? encryptSecret(effectiveCommunity) : null,
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

// Debug endpoint — fetch the raw varbinds the collector would read for
// a given operation, with the human-readable column names alongside.
// Returns { kind, varbinds: [{name, oid, value}] } so the operator can
// see at a glance whether the device reports nothing (column mismatch),
// a non-OK sense (probe failing), or values that look right (collector
// or normalisation bug).
router.get('/:id/inspect/:operIndex', requireAdmin, async (req: Request, res: Response) => {
  const existing = loadDeviceOr404(String(req.params.id), res); if (!existing) return;
  const operIndex = parseInt(String(req.params.operIndex), 10);
  if (!Number.isFinite(operIndex)) return res.status(400).json({ error: 'operIndex must be an integer' });
  const kind = (req.query.kind as string | undefined) || 'udp-jitter';

  const named: { name: string; oid: string }[] = kind === 'udp-jitter'
    ? [
        { name: 'numRtt',  oid: RTT_MON_LATEST_JITTER_NUM_RTT },
        { name: 'rttSum',  oid: RTT_MON_LATEST_JITTER_RTT_SUM },
        { name: 'rttMin',  oid: RTT_MON_LATEST_JITTER_RTT_MIN },
        { name: 'rttMax',  oid: RTT_MON_LATEST_JITTER_RTT_MAX },
        { name: 'lossSd',  oid: RTT_MON_LATEST_JITTER_LOSS_SD },
        { name: 'lossDs',  oid: RTT_MON_LATEST_JITTER_LOSS_DS },
        { name: 'oos',     oid: RTT_MON_LATEST_JITTER_OOS },
        { name: 'mia',     oid: RTT_MON_LATEST_JITTER_MIA },
        { name: 'sense',   oid: RTT_MON_LATEST_JITTER_SENSE },
        { name: 'mos',     oid: RTT_MON_LATEST_JITTER_MOS },
      ]
    : [
        { name: 'completionTime', oid: RTT_MON_LATEST_RTT_OPER_COMPLETION_TIME },
        { name: 'sense',          oid: RTT_MON_LATEST_RTT_OPER_SENSE },
      ];

  try {
    const oids = named.map(n => `${n.oid}.${operIndex}`);
    const vbs = await snmpGet(rowToConn(existing), oids);
    const varbinds = named.map((n, i) => ({
      name: n.name,
      oid: oids[i],
      value: vbs[i]?.value ?? null,
    }));
    res.json({ kind, operIndex, varbinds });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// One-shot dry run of the full pipeline for this device. Discovers every
// cisco-ipsla target bound to the device, polls each one (raw SNMP +
// normalised result + what the INSERT would write) and returns the lot
// as structured JSON — without writing anything to the DB.
//
// Use this any time the dashboard says "no data" for a Cisco target:
//   curl -b cookie.jar http://onere/api/v1/devices/<id>/diagnostics
// The operator gets every stage's output side by side so it's obvious
// which one is failing.
router.get('/:id/diagnostics', requireAdmin, async (req: Request, res: Response) => {
  const existing = loadDeviceOr404(String(req.params.id), res); if (!existing) return;
  const conn = rowToConn(existing);

  interface OpDiag {
    target_id: string;
    target_name: string;
    target_enabled: boolean;
    oper_index: number;
    oper_type: string;
    varbinds?: { name: string; oid: string; value: unknown }[];
    raw_values?: Record<string, number | null>;
    sense?: number | null;
    normalised?: Record<string, unknown>;
    would_insert?: Record<string, unknown>;
    note?: string;
    error?: string;
  }

  const ranAt = Math.floor(Date.now() / 1000);
  const db = getDb();
  const targets = db.prepare(`
    SELECT t.id, t.name, t.enabled, t.ipsla_oper_index, t.ipsla_oper_type,
           g.sla_latency_ms, g.sla_jitter_ms, g.sla_loss_pct
    FROM targets t
    JOIN groups g ON t.group_id = g.id
    WHERE t.device_id = ? AND t.probe_type = 'cisco-ipsla'
    ORDER BY t.ipsla_oper_index
  `).all(existing.id) as Array<{
    id: string; name: string; enabled: number;
    ipsla_oper_index: number | null; ipsla_oper_type: string | null;
    sla_latency_ms: number; sla_jitter_ms: number; sla_loss_pct: number;
  }>;

  // First, confirm SNMP works at all
  let testResult;
  try { testResult = await ciscoTestConnection(conn); }
  catch (err) { testResult = { ok: false, error: (err as Error).message }; }

  const results: OpDiag[] = [];
  for (const t of targets) {
    if (t.ipsla_oper_index == null || !t.ipsla_oper_type) {
      results.push({
        target_id: t.id, target_name: t.name, target_enabled: !!t.enabled,
        oper_index: -1, oper_type: t.ipsla_oper_type || '(null)',
        note: 'target has null ipsla_oper_index or ipsla_oper_type — would be skipped by the scheduler',
      });
      continue;
    }
    const opIdx = t.ipsla_oper_index;
    const kind = t.ipsla_oper_type as OperKind;

    // Stage A: raw SNMP read of every column we care about, named.
    const named: { name: string; oid: string }[] = kind === 'udp-jitter'
      ? [
          { name: 'numRtt',  oid: RTT_MON_LATEST_JITTER_NUM_RTT },
          { name: 'rttSum',  oid: RTT_MON_LATEST_JITTER_RTT_SUM },
          { name: 'rttMin',  oid: RTT_MON_LATEST_JITTER_RTT_MIN },
          { name: 'rttMax',  oid: RTT_MON_LATEST_JITTER_RTT_MAX },
          { name: 'lossSd',  oid: RTT_MON_LATEST_JITTER_LOSS_SD },
          { name: 'lossDs',  oid: RTT_MON_LATEST_JITTER_LOSS_DS },
          { name: 'oos',     oid: RTT_MON_LATEST_JITTER_OOS },
          { name: 'mia',     oid: RTT_MON_LATEST_JITTER_MIA },
          { name: 'sense',   oid: RTT_MON_LATEST_JITTER_SENSE },
          { name: 'mos',     oid: RTT_MON_LATEST_JITTER_MOS },
        ]
      : [
          { name: 'completionTime', oid: RTT_MON_LATEST_RTT_OPER_COMPLETION_TIME },
          { name: 'sense',          oid: RTT_MON_LATEST_RTT_OPER_SENSE },
        ];

    let varbinds: { name: string; oid: string; value: unknown }[] | undefined;
    const raw_values: Record<string, number | null> = {};
    let sense: number | null = null;
    let normalised: Record<string, unknown> | undefined;
    let would_insert: Record<string, unknown> | undefined;
    let error: string | undefined;

    try {
      const oids = named.map(n => `${n.oid}.${opIdx}`);
      const vbs = await snmpGet(conn, oids);
      varbinds = named.map((n, i) => ({ name: n.name, oid: oids[i], value: vbs[i]?.value ?? null }));
      for (let i = 0; i < named.length; i++) {
        const v = vbs[i]?.value;
        raw_values[named[i].name] = typeof v === 'number' ? v : v == null ? null : Number(v);
      }
      sense = raw_values.sense ?? null;

      // Stage B: actually run the collector path (this is the same
      // call the scheduler makes — guarantees we surface bugs there too)
      const result = await ciscoPollOperation(conn, opIdx, kind);
      normalised = result as unknown as Record<string, unknown>;
      const slaScore = calculateSlaScore(
        { latency_avg: result.latency_avg, jitter: result.jitter, loss_pct: result.loss_pct },
        { sla_latency_ms: t.sla_latency_ms, sla_jitter_ms: t.sla_jitter_ms, sla_loss_pct: t.sla_loss_pct },
      );
      would_insert = {
        target_id: t.id,
        timestamp: ranAt,
        latency_min: result.latency_min,
        latency_avg: result.latency_avg,
        latency_max: result.latency_max,
        jitter: result.jitter,
        loss_pct: result.loss_pct,
        probe_count: result.probe_count,
        sla_score: slaScore,
        mos: (result as { mos?: number | null }).mos ?? null,
        source: 'cisco',
      };
    } catch (e) {
      error = (e as Error).message;
    }

    results.push({
      target_id: t.id, target_name: t.name, target_enabled: !!t.enabled,
      oper_index: opIdx, oper_type: kind,
      varbinds, raw_values, sense, normalised, would_insert, error,
    });
  }

  res.json({
    device_id: existing.id,
    device_name: existing.name,
    host: existing.host,
    snmp_version: existing.snmp_version,
    ran_at: ranAt,
    snmp_test: testResult,
    targets_for_this_device: targets.length,
    results,
    // Sanity hint: when sense ≠ 2 for every target, either the OID is
    // off (col 36 should be SENSE for udp-jitter; col 2 for echo) or
    // none of the operations are actually active on the device.
    hint: results.every(r => r.sense != null && r.sense !== 2)
      ? 'sense is non-OK for every operation — operations may not be scheduled on the device, or the sense column OID is wrong for your IOS version.'
      : results.every(r => r.sense == null)
        ? 'sense came back null for every operation — the OID column might not exist on this IOS version, or the operation index is wrong.'
        : 'See per-target details above.',
  });
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

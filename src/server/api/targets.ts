import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { toCsv, parseCsv } from '../util/csv.js';
import { requireAdmin } from '../auth.js';

const router = Router();

const TARGET_CSV_COLUMNS = [
  'id', 'group_id', 'group_name', 'name', 'host', 'site_code',
  'probe_interval', 'probe_count', 'enabled',
];

// --- export / import (must come before /:id) --------------------------

router.get('/export.csv', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT t.id, t.group_id, g.name AS group_name, t.name, t.host, t.site_code,
           t.probe_interval, t.probe_count, t.enabled
    FROM targets t JOIN groups g ON t.group_id = g.id
    ORDER BY g.name, t.name
  `).all() as Record<string, unknown>[];
  const csv = toCsv(rows, TARGET_CSV_COLUMNS);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="targets.csv"');
  res.send(csv);
});

router.post('/import', requireAdmin, (req: Request, res: Response) => {
  const csvText = typeof req.body === 'string' ? req.body : '';
  if (!csvText) return res.status(400).json({ error: 'Request body must be CSV text (Content-Type: text/csv)' });

  let parsed: Record<string, string>[];
  try {
    parsed = parseCsv(csvText);
  } catch (err) {
    return res.status(400).json({ error: 'Failed to parse CSV: ' + (err as Error).message });
  }

  const db = getDb();
  const result = { created: 0, updated: 0, errors: [] as string[] };

  const findGroupById = db.prepare('SELECT id FROM groups WHERE id = ?');
  const findGroupByName = db.prepare('SELECT id FROM groups WHERE name = ?');
  const findTarget = db.prepare('SELECT id FROM targets WHERE id = ?');

  const upsert = db.prepare(`
    INSERT INTO targets (id, group_id, name, host, site_code, probe_interval, probe_count, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      group_id = excluded.group_id,
      name = excluded.name,
      host = excluded.host,
      site_code = excluded.site_code,
      probe_interval = excluded.probe_interval,
      probe_count = excluded.probe_count,
      enabled = excluded.enabled
  `);

  const tx = db.transaction((rows: Record<string, string>[]) => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      if (!r.name || !r.host) {
        result.errors.push(`Row ${rowNum}: name and host are required`);
        continue;
      }
      // Resolve group_id: explicit id wins, else lookup by name
      let groupId = r.group_id || '';
      if (groupId && !findGroupById.get(groupId)) {
        result.errors.push(`Row ${rowNum}: group_id "${groupId}" not found`);
        continue;
      }
      if (!groupId) {
        if (!r.group_name) {
          result.errors.push(`Row ${rowNum}: needs group_id or group_name`);
          continue;
        }
        const g = findGroupByName.get(r.group_name) as { id: string } | undefined;
        if (!g) {
          result.errors.push(`Row ${rowNum}: group_name "${r.group_name}" not found`);
          continue;
        }
        groupId = g.id;
      }

      const id = r.id || uuidv4();
      const existed = !!findTarget.get(id);
      try {
        upsert.run(
          id,
          groupId,
          r.name,
          r.host,
          r.site_code || null,
          r.probe_interval ? parseInt(r.probe_interval) : 300,
          r.probe_count ? parseInt(r.probe_count) : 20,
          r.enabled === '' || r.enabled == null ? 1 : (parseInt(r.enabled) ? 1 : 0),
        );
        if (existed) result.updated++;
        else result.created++;
      } catch (err) {
        result.errors.push(`Row ${rowNum}: ${(err as Error).message}`);
      }
    }
  });
  tx(parsed);

  res.json(result);
});

// --- bulk operations (must come before /:id) ---------------------------

// Delete many targets at once. Body: { ids: string[] }.
router.post('/bulk/delete', requireAdmin, (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string') : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ids must be a non-empty array' });

  const db = getDb();
  const del = db.prepare('DELETE FROM targets WHERE id = ?');
  const tx = db.transaction((rows: string[]) => {
    let n = 0;
    for (const id of rows) n += del.run(id).changes;
    return n;
  });
  const deleted = tx(ids);
  res.json({ deleted });
});

// Apply the same field changes to many targets at once. Body:
// { ids: string[], patch: { enabled?, group_id?, probe_interval?, probe_count? } }.
// Only a safe subset of columns can be bulk-edited; probe wiring
// (probe_type/device/operation) is intentionally excluded since those are
// per-target and validated individually.
const BULK_EDITABLE = new Set(['enabled', 'group_id', 'probe_interval', 'probe_count']);

router.post('/bulk/update', requireAdmin, (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string') : [];
  const patch = (req.body?.patch && typeof req.body.patch === 'object') ? req.body.patch as Record<string, unknown> : {};
  if (ids.length === 0) return res.status(400).json({ error: 'ids must be a non-empty array' });

  const fields = Object.keys(patch).filter(k => BULK_EDITABLE.has(k));
  if (fields.length === 0) {
    return res.status(400).json({ error: `patch must include at least one of: ${Array.from(BULK_EDITABLE).join(', ')}` });
  }

  const db = getDb();
  if (fields.includes('group_id')) {
    const g = db.prepare('SELECT id FROM groups WHERE id = ?').get(patch.group_id as string);
    if (!g) return res.status(400).json({ error: 'Invalid group_id' });
  }

  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => {
    if (f === 'enabled') return patch.enabled ? 1 : 0;
    if (f === 'probe_interval' || f === 'probe_count') return Number(patch[f]);
    return patch[f];
  });
  const stmt = db.prepare(`UPDATE targets SET ${setClause} WHERE id = ?`);
  const tx = db.transaction((rows: string[]) => {
    let n = 0;
    for (const id of rows) n += stmt.run(...values, id).changes;
    return n;
  });
  const updated = tx(ids);
  res.json({ updated });
});

// --- standard CRUD -----------------------------------------------------

router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const groupId = req.query.group_id as string | undefined;
  if (groupId) {
    res.json(db.prepare('SELECT * FROM targets WHERE group_id = ? ORDER BY name').all(groupId));
  } else {
    res.json(db.prepare('SELECT * FROM targets ORDER BY name').all());
  }
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const target = db.prepare('SELECT * FROM targets WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Target not found' });
  res.json(target);
});

const VALID_PROBE_TYPES = new Set(['icmp', 'cisco-ipsla']);
const VALID_IPSLA_TYPES  = new Set(['icmp-echo', 'udp-echo', 'udp-jitter', 'tcp-connect', 'http', 'dns']);

function validateCiscoFields(
  db: ReturnType<typeof getDb>,
  probeType: string,
  deviceId: string | null,
  operIndex: number | null,
  operType: string | null,
): string | null {
  if (probeType === 'icmp') return null;
  if (probeType !== 'cisco-ipsla') return `invalid probe_type "${probeType}"`;
  if (!deviceId) return 'device_id is required for probe_type=cisco-ipsla';
  const dev = db.prepare('SELECT id FROM cisco_devices WHERE id = ?').get(deviceId);
  if (!dev) return 'device_id does not exist';
  if (operIndex == null || !Number.isFinite(operIndex)) return 'ipsla_oper_index is required';
  if (!operType || !VALID_IPSLA_TYPES.has(operType)) return 'ipsla_oper_type is required and must be one of: ' + Array.from(VALID_IPSLA_TYPES).join(', ');
  return null;
}

router.post('/', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const { group_id, name, host, site_code, probe_interval, probe_count, enabled,
          probe_type, device_id, ipsla_oper_index, ipsla_oper_type } = req.body;
  if (!group_id || !name || !host) {
    return res.status(400).json({ error: 'group_id, name, and host are required' });
  }
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(group_id);
  if (!group) return res.status(400).json({ error: 'Invalid group_id' });

  const pType = (probe_type || 'icmp') as string;
  if (!VALID_PROBE_TYPES.has(pType)) return res.status(400).json({ error: `invalid probe_type "${pType}"` });

  const ciscoErr = validateCiscoFields(db, pType, device_id ?? null, ipsla_oper_index ?? null, ipsla_oper_type ?? null);
  if (ciscoErr) return res.status(400).json({ error: ciscoErr });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO targets
      (id, group_id, name, host, site_code, probe_interval, probe_count, enabled,
       probe_type, device_id, ipsla_oper_index, ipsla_oper_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, group_id, name, host, site_code || null,
    probe_interval ?? 300, probe_count ?? 20, enabled ?? 1,
    pType,
    pType === 'cisco-ipsla' ? device_id : null,
    pType === 'cisco-ipsla' ? ipsla_oper_index : null,
    pType === 'cisco-ipsla' ? ipsla_oper_type : null,
  );

  const target = db.prepare('SELECT * FROM targets WHERE id = ?').get(id);
  res.status(201).json(target);
});

router.put('/:id', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM targets WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'Target not found' });

  const { group_id, name, host, site_code, probe_interval, probe_count, enabled,
          probe_type, device_id, ipsla_oper_index, ipsla_oper_type } = req.body;

  const newProbeType = (probe_type ?? existing.probe_type ?? 'icmp') as string;
  if (!VALID_PROBE_TYPES.has(newProbeType)) return res.status(400).json({ error: `invalid probe_type "${newProbeType}"` });

  const newDeviceId  = device_id        !== undefined ? device_id        : (existing.device_id as string | null);
  const newOperIndex = ipsla_oper_index !== undefined ? ipsla_oper_index : (existing.ipsla_oper_index as number | null);
  const newOperType  = ipsla_oper_type  !== undefined ? ipsla_oper_type  : (existing.ipsla_oper_type as string | null);

  const ciscoErr = validateCiscoFields(db, newProbeType, newDeviceId, newOperIndex, newOperType);
  if (ciscoErr) return res.status(400).json({ error: ciscoErr });

  db.prepare(`
    UPDATE targets
    SET group_id = ?, name = ?, host = ?, site_code = ?,
        probe_interval = ?, probe_count = ?, enabled = ?,
        probe_type = ?, device_id = ?, ipsla_oper_index = ?, ipsla_oper_type = ?
    WHERE id = ?
  `).run(
    group_id ?? existing.group_id,
    name ?? existing.name,
    host ?? existing.host,
    site_code ?? existing.site_code,
    probe_interval ?? existing.probe_interval,
    probe_count ?? existing.probe_count,
    enabled ?? existing.enabled,
    newProbeType,
    newProbeType === 'cisco-ipsla' ? newDeviceId  : null,
    newProbeType === 'cisco-ipsla' ? newOperIndex : null,
    newProbeType === 'cisco-ipsla' ? newOperType  : null,
    req.params.id
  );

  const target = db.prepare('SELECT * FROM targets WHERE id = ?').get(req.params.id);
  res.json(target);
});

router.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM targets WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Target not found' });
  res.status(204).send();
});

export default router;

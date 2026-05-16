import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { toCsv, parseCsv } from '../util/csv.js';

const router = Router();

const GROUP_CSV_COLUMNS = [
  'id', 'name', 'description', 'sla_latency_ms', 'sla_jitter_ms', 'sla_loss_pct',
];

const MEASUREMENT_EXPORT_COLUMNS = [
  'target_id', 'target_name', 'host', 'site_code', 'group_name',
  'timestamp_iso', 'timestamp_unix',
  'latency_min_ms', 'latency_avg_ms', 'latency_max_ms',
  'jitter_ms', 'loss_pct', 'probe_count', 'sla_score',
];

// --- export / import (must be registered before /:id catches them) ----

router.get('/export.csv', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, description, sla_latency_ms, sla_jitter_ms, sla_loss_pct
    FROM groups ORDER BY name
  `).all() as Record<string, unknown>[];
  const csv = toCsv(rows, GROUP_CSV_COLUMNS);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="groups.csv"');
  res.send(csv);
});

router.post('/import', (req: Request, res: Response) => {
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

  const upsert = db.prepare(`
    INSERT INTO groups (id, name, description, sla_latency_ms, sla_jitter_ms, sla_loss_pct)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      sla_latency_ms = excluded.sla_latency_ms,
      sla_jitter_ms = excluded.sla_jitter_ms,
      sla_loss_pct = excluded.sla_loss_pct
  `);

  const findExisting = db.prepare('SELECT id FROM groups WHERE id = ?');

  const tx = db.transaction((rows: Record<string, string>[]) => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.name) {
        result.errors.push(`Row ${i + 2}: missing name`);
        continue;
      }
      const id = r.id || uuidv4();
      const existed = !!findExisting.get(id);
      try {
        upsert.run(
          id,
          r.name,
          r.description || null,
          r.sla_latency_ms ? parseFloat(r.sla_latency_ms) : 100,
          r.sla_jitter_ms ? parseFloat(r.sla_jitter_ms) : 30,
          r.sla_loss_pct ? parseFloat(r.sla_loss_pct) : 1,
        );
        if (existed) result.updated++;
        else result.created++;
      } catch (err) {
        result.errors.push(`Row ${i + 2}: ${(err as Error).message}`);
      }
    }
  });
  tx(parsed);

  res.json(result);
});

// Export all measurements for all targets in a group
router.get('/:id/measurements/export.csv', (req: Request, res: Response) => {
  const db = getDb();
  const groupId = req.params.id;
  const from = parseInt(req.query.from as string) || 0;
  const to = parseInt(req.query.to as string) || Math.floor(Date.now() / 1000);

  const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId) as { name: string } | undefined;
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const rows = db.prepare(`
    SELECT
      t.id AS target_id, t.name AS target_name, t.host, t.site_code,
      g.name AS group_name,
      m.timestamp, m.latency_min, m.latency_avg, m.latency_max,
      m.jitter, m.loss_pct, m.probe_count, m.sla_score
    FROM measurements m
    JOIN targets t ON m.target_id = t.id
    JOIN groups g ON t.group_id = g.id
    WHERE g.id = ? AND m.timestamp >= ? AND m.timestamp <= ?
    ORDER BY t.name, m.timestamp ASC
  `).all(groupId, from, to) as Array<{
    target_id: string;
    target_name: string;
    host: string;
    site_code: string | null;
    group_name: string;
    timestamp: number;
    latency_min: number | null;
    latency_avg: number | null;
    latency_max: number | null;
    jitter: number | null;
    loss_pct: number | null;
    probe_count: number | null;
    sla_score: number | null;
  }>;

  const csvRows = rows.map(r => ({
    target_id: r.target_id,
    target_name: r.target_name,
    host: r.host,
    site_code: r.site_code,
    group_name: r.group_name,
    timestamp_iso: new Date(r.timestamp * 1000).toISOString(),
    timestamp_unix: r.timestamp,
    latency_min_ms: r.latency_min,
    latency_avg_ms: r.latency_avg,
    latency_max_ms: r.latency_max,
    jitter_ms: r.jitter,
    loss_pct: r.loss_pct,
    probe_count: r.probe_count,
    sla_score: r.sla_score,
  }));

  const csv = toCsv(csvRows, MEASUREMENT_EXPORT_COLUMNS);
  const safe = group.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="measurements_group_${safe}.csv"`);
  res.send(csv);
});

// --- standard CRUD -----------------------------------------------------

router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const groups = db.prepare('SELECT * FROM groups ORDER BY name').all();
  res.json(groups);
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  res.json(group);
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, description, sla_latency_ms, sla_jitter_ms, sla_loss_pct } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO groups (id, name, description, sla_latency_ms, sla_jitter_ms, sla_loss_pct)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, description || null, sla_latency_ms ?? 100, sla_jitter_ms ?? 30, sla_loss_pct ?? 1);

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  res.status(201).json(group);
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Group not found' });

  const { name, description, sla_latency_ms, sla_jitter_ms, sla_loss_pct } = req.body;
  db.prepare(`
    UPDATE groups SET name = ?, description = ?, sla_latency_ms = ?, sla_jitter_ms = ?, sla_loss_pct = ?
    WHERE id = ?
  `).run(
    name ?? (existing as Record<string, unknown>).name,
    description ?? (existing as Record<string, unknown>).description,
    sla_latency_ms ?? (existing as Record<string, unknown>).sla_latency_ms,
    sla_jitter_ms ?? (existing as Record<string, unknown>).sla_jitter_ms,
    sla_loss_pct ?? (existing as Record<string, unknown>).sla_loss_pct,
    req.params.id
  );

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  res.json(group);
});

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Group not found' });
  res.status(204).send();
});

export default router;

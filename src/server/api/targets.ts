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

router.post('/', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const { group_id, name, host, site_code, probe_interval, probe_count, enabled } = req.body;
  if (!group_id || !name || !host) {
    return res.status(400).json({ error: 'group_id, name, and host are required' });
  }

  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(group_id);
  if (!group) return res.status(400).json({ error: 'Invalid group_id' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO targets (id, group_id, name, host, site_code, probe_interval, probe_count, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, group_id, name, host, site_code || null, probe_interval ?? 300, probe_count ?? 20, enabled ?? 1);

  const target = db.prepare('SELECT * FROM targets WHERE id = ?').get(id);
  res.status(201).json(target);
});

router.put('/:id', requireAdmin, (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM targets WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'Target not found' });

  const { group_id, name, host, site_code, probe_interval, probe_count, enabled } = req.body;
  db.prepare(`
    UPDATE targets SET group_id = ?, name = ?, host = ?, site_code = ?, probe_interval = ?, probe_count = ?, enabled = ?
    WHERE id = ?
  `).run(
    group_id ?? existing.group_id,
    name ?? existing.name,
    host ?? existing.host,
    site_code ?? existing.site_code,
    probe_interval ?? existing.probe_interval,
    probe_count ?? existing.probe_count,
    enabled ?? existing.enabled,
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

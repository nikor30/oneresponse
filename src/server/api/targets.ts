import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

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

router.post('/', (req: Request, res: Response) => {
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

router.put('/:id', (req: Request, res: Response) => {
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

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM targets WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Target not found' });
  res.status(204).send();
});

export default router;

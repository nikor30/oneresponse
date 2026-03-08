import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

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

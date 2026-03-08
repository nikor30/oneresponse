import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import groupsRouter from './groups.js';
import targetsRouter from './targets.js';
import measurementsRouter from './measurements.js';
import peersRouter from './peers.js';

const router = Router();

router.use('/groups', groupsRouter);
router.use('/targets', targetsRouter);
router.use('/measurements', measurementsRouter);
router.use('/peers', peersRouter);

// Dashboard endpoint
router.get('/dashboard', (_req: Request, res: Response) => {
  const db = getDb();

  const dashboard = db.prepare(`
    SELECT
      g.id as group_id, g.name as group_name,
      g.sla_latency_ms, g.sla_jitter_ms, g.sla_loss_pct,
      t.id as target_id, t.name as target_name, t.host, t.site_code,
      m.timestamp, m.latency_min, m.latency_avg, m.latency_max,
      m.jitter, m.loss_pct, m.sla_score
    FROM targets t
    JOIN groups g ON t.group_id = g.id
    LEFT JOIN measurements m ON m.id = (
      SELECT id FROM measurements
      WHERE target_id = t.id AND peer_id IS NULL
      ORDER BY timestamp DESC LIMIT 1
    )
    WHERE t.enabled = 1
    ORDER BY g.name, t.name
  `).all();

  const groups = new Map<string, { group: Record<string, unknown>; targets: Record<string, unknown>[] }>();

  for (const row of dashboard as Record<string, unknown>[]) {
    const gid = row.group_id as string;
    if (!groups.has(gid)) {
      groups.set(gid, {
        group: {
          id: gid,
          name: row.group_name,
          sla_latency_ms: row.sla_latency_ms,
          sla_jitter_ms: row.sla_jitter_ms,
          sla_loss_pct: row.sla_loss_pct,
        },
        targets: [],
      });
    }
    groups.get(gid)!.targets.push({
      id: row.target_id,
      name: row.target_name,
      host: row.host,
      site_code: row.site_code,
      timestamp: row.timestamp,
      latency_min: row.latency_min,
      latency_avg: row.latency_avg,
      latency_max: row.latency_max,
      jitter: row.jitter,
      loss_pct: row.loss_pct,
      sla_score: row.sla_score,
    });
  }

  res.json(Array.from(groups.values()));
});

// API key management
router.post('/api-keys', (req: Request, res: Response) => {
  const { name, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const rawKey = uuidv4() + '-' + uuidv4();
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const id = uuidv4();

  const db = getDb();
  db.prepare('INSERT INTO api_keys (id, name, key_hash, permissions) VALUES (?, ?, ?, ?)').run(
    id, name, keyHash, permissions || 'read'
  );

  // Return the raw key only once
  res.status(201).json({ id, name, key: rawKey, permissions: permissions || 'read' });
});

router.get('/api-keys', (_req: Request, res: Response) => {
  const db = getDb();
  const keys = db.prepare('SELECT id, name, permissions, created_at FROM api_keys ORDER BY created_at DESC').all();
  res.json(keys);
});

router.delete('/api-keys/:id', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'API key not found' });
  res.status(204).send();
});

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Math.floor(Date.now() / 1000) });
});

export default router;

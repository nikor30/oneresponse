import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

// Get measurements for a target (time series data)
router.get('/:targetId', (req: Request, res: Response) => {
  const db = getDb();
  const { targetId } = req.params;
  const from = parseInt(req.query.from as string) || Math.floor(Date.now() / 1000) - 86400; // default 24h
  const to = parseInt(req.query.to as string) || Math.floor(Date.now() / 1000);
  const limit = Math.min(parseInt(req.query.limit as string) || 1000, 5000);

  const target = db.prepare('SELECT id FROM targets WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Target not found' });

  const measurements = db.prepare(`
    SELECT id, target_id, peer_id, timestamp, latency_min, latency_avg, latency_max,
           jitter, loss_pct, probe_count, sla_score
    FROM measurements
    WHERE target_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(targetId, from, to, limit);

  res.json(measurements);
});

// Dashboard endpoint: latest measurement per target, grouped by group
router.get('/', (_req: Request, res: Response) => {
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

  // Structure as groups with nested targets
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

export default router;

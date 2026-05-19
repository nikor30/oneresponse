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

  // Latest measurement + lifetime drift (5th / 95th percentile of latency_avg)
  // per target. Using latency_avg = median of 20 pings means a single bad
  // ping inside a sample can't blow up the range. Percentiles trim the
  // top/bottom 5 % so an isolated bad sample doesn't pin the drift line
  // to the chart edge. With < 20 samples we fall back to plain MIN/MAX.
  const dashboard = db.prepare(`
    WITH ranked AS (
      SELECT
        target_id,
        latency_avg,
        NTILE(20) OVER (PARTITION BY target_id ORDER BY latency_avg ASC) AS tile
      FROM measurements
      WHERE peer_id IS NULL
        AND loss_pct < 100
        AND latency_avg > 0
    ),
    lifetime AS (
      SELECT
        target_id,
        CASE WHEN COUNT(*) >= 20
          THEN MAX(CASE WHEN tile = 1 THEN latency_avg END)
          ELSE MIN(latency_avg)
        END AS latency_min_lifetime,
        CASE WHEN COUNT(*) >= 20
          THEN MIN(CASE WHEN tile = 20 THEN latency_avg END)
          ELSE MAX(latency_avg)
        END AS latency_max_lifetime,
        COUNT(*) AS sample_count
      FROM ranked
      GROUP BY target_id
    )
    SELECT
      g.id as group_id, g.name as group_name,
      g.sla_latency_ms, g.sla_jitter_ms, g.sla_loss_pct,
      t.id as target_id, t.name as target_name, t.host, t.site_code,
      m.timestamp, m.latency_min, m.latency_avg, m.latency_max,
      m.jitter, m.loss_pct, m.sla_score,
      lt.latency_min_lifetime, lt.latency_max_lifetime, lt.sample_count
    FROM targets t
    JOIN groups g ON t.group_id = g.id
    LEFT JOIN measurements m ON m.id = (
      SELECT id FROM measurements
      WHERE target_id = t.id AND peer_id IS NULL
      ORDER BY timestamp DESC LIMIT 1
    )
    LEFT JOIN lifetime lt ON lt.target_id = t.id
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
      latency_min_lifetime: row.latency_min_lifetime,
      latency_max_lifetime: row.latency_max_lifetime,
      sample_count: row.sample_count,
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

// Settings (key/value). Currently used for `site_name` — the local
// instance label shown above the dashboard so peer instances can be
// distinguished ("Europe Peer", "US", etc.).
router.get('/settings', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string | null }>;
  const out: Record<string, string | null> = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

router.put('/settings', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Body must be a JSON object of {key: value}' });
  }
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
  `);
  const tx = db.transaction((entries: [string, string | null][]) => {
    for (const [k, v] of entries) upsert.run(k, v);
  });
  const entries: [string, string | null][] = Object.entries(body).map(([k, v]) => [
    k,
    v == null ? null : String(v),
  ]);
  tx(entries);

  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string | null }>;
  const out: Record<string, string | null> = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Math.floor(Date.now() / 1000) });
});

export default router;

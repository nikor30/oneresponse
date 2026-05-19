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

interface DashboardRow {
  group_id: string;
  group_name: string;
  sla_latency_ms: number;
  sla_jitter_ms: number;
  sla_loss_pct: number;
  viz_latency_min: number | null;
  viz_latency_max: number | null;
  target_id: string;
  target_name: string;
  host: string;
  site_code: string | null;
  timestamp: number | null;
  latency_min: number | null;
  latency_avg: number | null;
  latency_max: number | null;
  jitter: number | null;
  loss_pct: number | null;
  sla_score: number | null;
  latency_min_lifetime: number | null;
  latency_max_lifetime: number | null;
  sample_count: number | null;
}

// Reusable: compute the local dashboard payload (groups+targets+latest+lifetime).
// Used both by GET /dashboard and by GET /peer-view (which peers fetch).
function computeLocalDashboard(): Array<{ group: Record<string, unknown>; targets: Record<string, unknown>[] }> {
  const db = getDb();
  const rows = db.prepare(`
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
      g.viz_latency_min, g.viz_latency_max,
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
  `).all() as DashboardRow[];

  const groups = new Map<string, { group: Record<string, unknown>; targets: Record<string, unknown>[] }>();
  for (const row of rows) {
    if (!groups.has(row.group_id)) {
      groups.set(row.group_id, {
        group: {
          id: row.group_id,
          name: row.group_name,
          sla_latency_ms: row.sla_latency_ms,
          sla_jitter_ms: row.sla_jitter_ms,
          sla_loss_pct: row.sla_loss_pct,
          viz_latency_min: row.viz_latency_min,
          viz_latency_max: row.viz_latency_max,
        },
        targets: [],
      });
    }
    groups.get(row.group_id)!.targets.push({
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
  return Array.from(groups.values());
}

function getSiteName(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'site_name'").get() as { value: string | null } | undefined;
  return row?.value || 'oneresponse';
}

function checkApiKey(apiKey: string | undefined): { ok: boolean; permissions?: string } {
  if (!apiKey) return { ok: false };
  const db = getDb();
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const key = db.prepare('SELECT permissions FROM api_keys WHERE key_hash = ?').get(keyHash) as { permissions: string } | undefined;
  if (!key) return { ok: false };
  return { ok: true, permissions: key.permissions };
}

// Dashboard endpoint (local view; no auth — used by the local browser)
router.get('/dashboard', (_req: Request, res: Response) => {
  res.json(computeLocalDashboard());
});

// Peer view — what another oneresponse node fetches to render this node
// inside its multi-instance dashboard. Requires a valid API key (read or
// write). Returns the same payload as /dashboard plus our site_name so
// the remote instance can label this pane.
router.get('/peer-view', (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const check = checkApiKey(apiKey);
  if (!check.ok) return res.status(401).json({ error: 'X-API-Key header required or invalid' });
  res.json({
    site_name: getSiteName(),
    dashboard: computeLocalDashboard(),
    timestamp: Math.floor(Date.now() / 1000),
  });
});

// Aggregated dashboard — local view plus a parallel fetch of every enabled
// peer's /peer-view. The frontend renders one chart pane per entry.
router.get('/dashboard/aggregate', async (_req: Request, res: Response) => {
  const localEntry = {
    peer_id: null as string | null,
    peer_name: null as string | null,
    url: null as string | null,
    site_name: getSiteName(),
    dashboard: computeLocalDashboard(),
    last_seen: Math.floor(Date.now() / 1000),
    error: null as string | null,
  };

  interface PeerRow { id: string; name: string; url: string; api_key: string }
  const db = getDb();
  const peers = db.prepare(
    "SELECT id, name, url, api_key FROM peers WHERE enabled = 1 AND (direction = 'pull' OR direction = 'both')"
  ).all() as PeerRow[];

  const peerEntries = await Promise.all(peers.map(async (peer) => {
    try {
      const url = `${peer.url.replace(/\/$/, '')}/api/v1/peer-view`;
      const response = await fetch(url, {
        headers: { 'X-API-Key': peer.api_key },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { site_name?: string; dashboard?: unknown; timestamp?: number };
      // Best-effort last_seen update; ignore failures
      try {
        db.prepare('UPDATE peers SET last_seen = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), peer.id);
      } catch { /* ignore */ }
      return {
        peer_id: peer.id,
        peer_name: peer.name,
        url: peer.url,
        site_name: data.site_name || peer.name,
        dashboard: data.dashboard || [],
        last_seen: data.timestamp || Math.floor(Date.now() / 1000),
        error: null,
      };
    } catch (err) {
      return {
        peer_id: peer.id,
        peer_name: peer.name,
        url: peer.url,
        site_name: peer.name,
        dashboard: [],
        last_seen: null,
        error: (err as Error).message || 'fetch failed',
      };
    }
  }));

  res.json([localEntry, ...peerEntries]);
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

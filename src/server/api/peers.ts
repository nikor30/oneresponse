import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const peers = db.prepare(
    'SELECT id, name, url, direction, enabled, last_seen, last_error, created_at FROM peers ORDER BY name'
  ).all();
  res.json(peers);
});

// One-shot connectivity check — calls the peer's /peer-view ourselves and
// surfaces the actual HTTP status + response body so the operator can see
// exactly what's wrong (key not recognised, wrong URL, peer down, etc.).
router.post('/:id/test', async (req: Request, res: Response) => {
  const db = getDb();
  const peer = db.prepare('SELECT id, name, url, api_key FROM peers WHERE id = ?').get(req.params.id) as
    { id: string; name: string; url: string; api_key: string } | undefined;
  if (!peer) return res.status(404).json({ error: 'Peer not found' });

  const url = `${peer.url.replace(/\/$/, '')}/api/v1/peer-view`;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: { 'X-API-Key': (peer.api_key || '').trim() },
      signal: AbortSignal.timeout(5000),
    });
    const elapsedMs = Date.now() - startedAt;
    let body: unknown = null;
    try { body = await response.json(); } catch { /* not JSON */ }

    if (!response.ok) {
      const message = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
        ? (body as { error: string }).error
        : `HTTP ${response.status}`;
      try {
        db.prepare('UPDATE peers SET last_error = ? WHERE id = ?').run(`HTTP ${response.status} — ${message}`, peer.id);
      } catch { /* ignore */ }
      return res.json({
        ok: false,
        status: response.status,
        elapsed_ms: elapsedMs,
        url,
        error: message,
      });
    }

    const data = body as { site_name?: string };
    try {
      db.prepare('UPDATE peers SET last_seen = ?, last_error = NULL WHERE id = ?')
        .run(Math.floor(Date.now() / 1000), peer.id);
    } catch { /* ignore */ }
    return res.json({
      ok: true,
      status: response.status,
      elapsed_ms: elapsedMs,
      url,
      site_name: data?.site_name || peer.name,
    });
  } catch (err) {
    const message = (err as Error).message || 'fetch failed';
    try {
      db.prepare('UPDATE peers SET last_error = ? WHERE id = ?').run(message, peer.id);
    } catch { /* ignore */ }
    return res.json({
      ok: false,
      elapsed_ms: Date.now() - startedAt,
      url,
      error: message,
    });
  }
});

// Peer direction is always 'both' now (the UI dropdown was confusing for
// the common case). The column is kept for back-compat with existing rows.
router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, url, api_key } = req.body;
  if (!name || !url || !api_key) {
    return res.status(400).json({ error: 'name, url, and api_key are required' });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO peers (id, name, url, api_key, direction)
    VALUES (?, ?, ?, ?, 'both')
  `).run(id, name.trim(), url.trim(), api_key.trim());

  const peer = db.prepare('SELECT id, name, url, direction, enabled, last_seen, created_at FROM peers WHERE id = ?').get(id);
  res.status(201).json(peer);
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM peers WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'Peer not found' });

  const { name, url, api_key, enabled } = req.body;
  db.prepare(`
    UPDATE peers SET name = ?, url = ?, api_key = ?, direction = 'both', enabled = ?
    WHERE id = ?
  `).run(
    typeof name    === 'string' ? name.trim()    : (existing.name    as string),
    typeof url     === 'string' ? url.trim()     : (existing.url     as string),
    typeof api_key === 'string' && api_key ? api_key.trim() : (existing.api_key as string),
    enabled ?? existing.enabled,
    req.params.id
  );

  const peer = db.prepare('SELECT id, name, url, direction, enabled, last_seen, created_at FROM peers WHERE id = ?').get(req.params.id);
  res.json(peer);
});

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM peers WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Peer not found' });
  res.status(204).send();
});

// Receive pushed measurements from a peer
router.post('/push', (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) return res.status(401).json({ error: 'X-API-Key header required' });

  const db = getDb();
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const key = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash) as Record<string, unknown> | undefined;
  if (!key || (key.permissions !== 'write' && key.permissions !== 'admin')) {
    return res.status(403).json({ error: 'Invalid or insufficient API key' });
  }

  const measurements = Array.isArray(req.body) ? req.body : [req.body];
  const peerId = req.headers['x-peer-id'] as string || 'unknown';

  const insert = db.prepare(`
    INSERT INTO measurements (target_id, peer_id, timestamp, latency_min, latency_avg, latency_max, jitter, loss_pct, probe_count, rtts, sla_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: Record<string, unknown>[]) => {
    for (const m of items) {
      insert.run(
        m.target_id, peerId, m.timestamp,
        m.latency_min, m.latency_avg, m.latency_max,
        m.jitter, m.loss_pct, m.probe_count,
        JSON.stringify(m.rtts), m.sla_score
      );
    }
  });

  insertMany(measurements);

  // Update peer last_seen
  db.prepare('UPDATE peers SET last_seen = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), peerId);

  res.json({ received: measurements.length });
});

export default router;

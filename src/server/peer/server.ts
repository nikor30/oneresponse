// Peer server functionality is handled via the peers API router (src/server/api/peers.ts).
// The POST /api/v1/peers/push endpoint accepts measurements from remote peers.
// This module is reserved for future pull-based peer synchronization.

import { getDb } from '../db/index.js';

interface Peer {
  id: string;
  name: string;
  url: string;
  api_key: string;
  direction: string;
  enabled: number;
}

export async function pullFromPeers(): Promise<void> {
  const db = getDb();
  const peers = db.prepare(
    "SELECT * FROM peers WHERE enabled = 1 AND (direction = 'pull' OR direction = 'both')"
  ).all() as Peer[];

  for (const peer of peers) {
    try {
      const targets = db.prepare('SELECT id FROM targets WHERE enabled = 1').all() as { id: string }[];

      for (const target of targets) {
        const lastTimestamp = db.prepare(
          'SELECT MAX(timestamp) as ts FROM measurements WHERE target_id = ? AND peer_id = ?'
        ).get(target.id, peer.id) as { ts: number | null } | undefined;

        const from = lastTimestamp?.ts || Math.floor(Date.now() / 1000) - 3600;
        const url = `${peer.url.replace(/\/$/, '')}/api/v1/measurements/${target.id}?from=${from}`;

        const response = await fetch(url, {
          headers: { 'X-API-Key': peer.api_key },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) continue;

        const measurements = await response.json() as Record<string, unknown>[];
        const insert = db.prepare(`
          INSERT OR IGNORE INTO measurements (target_id, peer_id, timestamp, latency_min, latency_avg, latency_max, jitter, loss_pct, probe_count, rtts, sla_score)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const m of measurements) {
          insert.run(
            target.id, peer.id, m.timestamp,
            m.latency_min, m.latency_avg, m.latency_max,
            m.jitter, m.loss_pct, m.probe_count,
            JSON.stringify(m.rtts || []), m.sla_score
          );
        }
      }

      db.prepare('UPDATE peers SET last_seen = ? WHERE id = ?').run(
        Math.floor(Date.now() / 1000),
        peer.id
      );
    } catch (err) {
      console.error(`Failed to pull from peer ${peer.name}:`, err);
    }
  }
}

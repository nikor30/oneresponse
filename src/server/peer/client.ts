import { getDb } from '../db/index.js';

interface MeasurementData {
  target_id: string;
  timestamp: number;
  latency_min: number;
  latency_avg: number;
  latency_max: number;
  jitter: number;
  loss_pct: number;
  probe_count: number;
  rtts: number[];
  sla_score: number;
  mos?: number | null;
  // Extended Cisco IP SLA (udp-jitter) datapoints — optional so older
  // peers keep working; the receiver stores whatever is present.
  ow_sd_min?: number | null;
  ow_sd_avg?: number | null;
  ow_sd_max?: number | null;
  ow_ds_min?: number | null;
  ow_ds_avg?: number | null;
  ow_ds_max?: number | null;
  jitter_sd?: number | null;
  jitter_ds?: number | null;
  loss_sd?: number | null;
  loss_ds?: number | null;
  pkt_oos?: number | null;
  pkt_mia?: number | null;
  pkt_late?: number | null;
  icpif?: number | null;
}

interface Peer {
  id: string;
  name: string;
  url: string;
  api_key: string;
  direction: string;
  enabled: number;
}

export async function pushToPeers(measurement: MeasurementData): Promise<void> {
  const db = getDb();
  const peers = db.prepare(
    "SELECT * FROM peers WHERE enabled = 1 AND (direction = 'push' OR direction = 'both')"
  ).all() as Peer[];

  for (const peer of peers) {
    try {
      const url = `${peer.url.replace(/\/$/, '')}/api/v1/peers/push`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': peer.api_key,
          'X-Peer-Id': peer.id,
        },
        body: JSON.stringify(measurement),
        signal: AbortSignal.timeout(10000),
      });

      db.prepare('UPDATE peers SET last_seen = ? WHERE id = ?').run(
        Math.floor(Date.now() / 1000),
        peer.id
      );
    } catch (err) {
      console.error(`Failed to push to peer ${peer.name} (${peer.url}):`, err);
    }
  }
}

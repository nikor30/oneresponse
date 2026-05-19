import { getDb } from '../db/index.js';
import { probe } from './prober.js';
import { calculateSlaScore } from './scoring.js';
import { v4 as uuidv4 } from 'uuid';
import { pushToPeers } from '../peer/client.js';
import { noteProbe } from '../syslog.js';

interface Target {
  id: string;
  group_id: string;
  name: string;
  host: string;
  site_code: string | null;
  probe_interval: number;
  probe_count: number;
  sla_latency_ms: number;
  sla_jitter_ms: number;
  sla_loss_pct: number;
}

const MAX_CONCURRENT = 10;
const timers = new Map<number, ReturnType<typeof setInterval>>();

async function probeTarget(target: Target): Promise<void> {
  try {
    const result = await probe(target.host, target.probe_count);
    const slaScore = calculateSlaScore(
      { latency_avg: result.latency_avg, jitter: result.jitter, loss_pct: result.loss_pct },
      { sla_latency_ms: target.sla_latency_ms, sla_jitter_ms: target.sla_jitter_ms, sla_loss_pct: target.sla_loss_pct }
    );

    const db = getDb();
    const timestamp = Math.floor(Date.now() / 1000);

    db.prepare(`
      INSERT INTO measurements (target_id, peer_id, timestamp, latency_min, latency_avg, latency_max, jitter, loss_pct, probe_count, rtts, sla_score)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      target.id,
      timestamp,
      result.latency_min,
      result.latency_avg,
      result.latency_max,
      result.jitter,
      result.loss_pct,
      result.probe_count,
      JSON.stringify(result.rtts),
      slaScore
    );

    // Push to peers if configured
    pushToPeers({
      target_id: target.id,
      timestamp,
      latency_min: result.latency_min,
      latency_avg: result.latency_avg,
      latency_max: result.latency_max,
      jitter: result.jitter,
      loss_pct: result.loss_pct,
      probe_count: result.probe_count,
      rtts: result.rtts,
      sla_score: slaScore,
    });

    // Emit syslog alarm on SLA state transitions (compliant ↔ breached).
    // Best-effort: never let syslog problems break probing.
    try {
      const groupRow = db.prepare('SELECT name FROM groups WHERE id = ?').get(target.group_id) as { name: string } | undefined;
      noteProbe({
        target_id: target.id,
        target_name: target.name,
        target_host: target.host,
        group_name: groupRow?.name || '',
        sla_score: slaScore,
        latency_avg: result.latency_avg,
        loss_pct: result.loss_pct,
      });
    } catch (e) {
      // swallow — syslog is non-essential to the probe itself
      void e;
    }
  } catch (err) {
    console.error(`Probe failed for ${target.host}:`, err);
  }
}

async function runBatch(targets: Target[]): Promise<void> {
  // Run in batches of MAX_CONCURRENT
  for (let i = 0; i < targets.length; i += MAX_CONCURRENT) {
    const batch = targets.slice(i, i + MAX_CONCURRENT);
    await Promise.allSettled(batch.map(t => probeTarget(t)));
  }
}

function loadTargets(): Target[] {
  const db = getDb();
  return db.prepare(`
    SELECT t.*, g.sla_latency_ms, g.sla_jitter_ms, g.sla_loss_pct
    FROM targets t
    JOIN groups g ON t.group_id = g.id
    WHERE t.enabled = 1
  `).all() as Target[];
}

export function startScheduler(): void {
  console.log('Starting monitoring scheduler...');

  // Clear existing timers
  for (const timer of timers.values()) {
    clearInterval(timer);
  }
  timers.clear();

  const targets = loadTargets();
  if (targets.length === 0) {
    console.log('No targets configured. Scheduler will check again in 60s.');
    setTimeout(startScheduler, 60000);
    return;
  }

  // Group targets by probe_interval
  const byInterval = new Map<number, Target[]>();
  for (const t of targets) {
    const existing = byInterval.get(t.probe_interval) || [];
    existing.push(t);
    byInterval.set(t.probe_interval, existing);
  }

  for (const [interval, intervalTargets] of byInterval) {
    console.log(`Scheduling ${intervalTargets.length} targets every ${interval}s`);

    // Run immediately on start
    runBatch(intervalTargets);

    // Then on interval
    const timer = setInterval(() => runBatch(intervalTargets), interval * 1000);
    timers.set(interval, timer);
  }

  // Periodically reload targets (every 60s) to pick up changes
  setTimeout(startScheduler, 60000);
}

export function stopScheduler(): void {
  for (const timer of timers.values()) {
    clearInterval(timer);
  }
  timers.clear();
}

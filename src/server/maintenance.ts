import { getDb } from './db/index.js';

// How often we refresh the per-target stats (lifetime drift bounds) and
// run retention cleanup. Short enough that new probes show up in the
// dashboard percentile band within a few minutes; long enough that the
// cost is negligible.
const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
let timer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------
// Per-target lifetime drift bounds (5th / 95th percentile of latency_avg)
//
// Recomputed periodically so the /dashboard query becomes a cheap JOIN
// with target_stats instead of an NTILE(20) scan over all measurements
// every render. With 90-day retention + 5-min probes, each target has
// ≤ 25,920 rows, so the NTILE here is fast (single-target scope).
// ---------------------------------------------------------------------
export function refreshAllTargetStats(): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Single transaction: collect bounds per target with NTILE(20)
  // partitioned by target_id, then upsert into target_stats.
  const computeAndUpsert = db.transaction(() => {
    const rows = db.prepare(`
      WITH ranked AS (
        SELECT
          target_id,
          latency_avg,
          NTILE(20) OVER (PARTITION BY target_id ORDER BY latency_avg ASC) AS tile,
          COUNT(*) OVER (PARTITION BY target_id) AS n
        FROM measurements
        WHERE peer_id IS NULL
          AND loss_pct < 100
          AND latency_avg > 0
      )
      SELECT
        target_id,
        CASE WHEN MAX(n) >= 20
          THEN MAX(CASE WHEN tile = 1 THEN latency_avg END)
          ELSE MIN(latency_avg)
        END AS p5_min,
        CASE WHEN MAX(n) >= 20
          THEN MIN(CASE WHEN tile = 20 THEN latency_avg END)
          ELSE MAX(latency_avg)
        END AS p95_max,
        MAX(n) AS sample_count
      FROM ranked
      GROUP BY target_id
    `).all() as Array<{ target_id: string; p5_min: number | null; p95_max: number | null; sample_count: number }>;

    const upsert = db.prepare(`
      INSERT INTO target_stats (target_id, latency_min_lifetime, latency_max_lifetime, sample_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(target_id) DO UPDATE SET
        latency_min_lifetime = excluded.latency_min_lifetime,
        latency_max_lifetime = excluded.latency_max_lifetime,
        sample_count         = excluded.sample_count,
        updated_at           = excluded.updated_at
    `);
    for (const r of rows) {
      upsert.run(r.target_id, r.p5_min, r.p95_max, r.sample_count, now);
    }

    // Drop stats rows for targets that no longer have any measurements
    db.prepare(`
      DELETE FROM target_stats
      WHERE target_id NOT IN (SELECT DISTINCT target_id FROM measurements)
    `).run();
  });
  computeAndUpsert();
}

// ---------------------------------------------------------------------
// Retention
//
// SQLite gets unwieldy past a few GB. With 100 targets × 5-min probes,
// raw rows accumulate at ~10 M / year. We:
//   1. NULL out the rtts JSON column after `retention_rtts_days` (we
//      only need per-ping samples for the recent SmokePing graph;
//      historic min/avg/max is enough for older charts).
//   2. Delete raw measurements older than `retention_raw_days`.
//
// Both windows are configurable via the settings table.
// ---------------------------------------------------------------------
export function runRetention(): { rttsCleared: number; rowsDeleted: number } {
  const db = getDb();
  const settings = db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?)').all(
    'retention_raw_days', 'retention_rtts_days',
  ) as Array<{ key: string; value: string | null }>;
  const get = (k: string, def: number) => {
    const r = settings.find(s => s.key === k);
    const v = r?.value ? parseInt(r.value, 10) : NaN;
    return Number.isFinite(v) && v > 0 ? v : def;
  };
  const retentionRawDays  = get('retention_raw_days', 90);
  const retentionRttsDays = get('retention_rtts_days', 7);

  const now = Math.floor(Date.now() / 1000);
  const rttsCutoff = now - retentionRttsDays * 86400;
  const rawCutoff  = now - retentionRawDays  * 86400;

  const rtts = db.prepare(`
    UPDATE measurements SET rtts = NULL
    WHERE rtts IS NOT NULL AND timestamp < ?
  `).run(rttsCutoff);

  const rows = db.prepare(`
    DELETE FROM measurements WHERE timestamp < ?
  `).run(rawCutoff);

  return { rttsCleared: rtts.changes, rowsDeleted: rows.changes };
}

// ---------------------------------------------------------------------
// Storage stats — surface DB row counts so the operator can see growth.
// ---------------------------------------------------------------------
export function getStorageStats(): {
  measurements: number;
  measurements_with_rtts: number;
  targets: number;
  groups: number;
  peers: number;
  oldest_measurement: number | null;
} {
  const db = getDb();
  const oneRow = <T>(sql: string): T => db.prepare(sql).get() as T;
  return {
    measurements:           oneRow<{ c: number }>('SELECT COUNT(*) AS c FROM measurements').c,
    measurements_with_rtts: oneRow<{ c: number }>('SELECT COUNT(*) AS c FROM measurements WHERE rtts IS NOT NULL').c,
    targets:                oneRow<{ c: number }>('SELECT COUNT(*) AS c FROM targets').c,
    groups:                 oneRow<{ c: number }>('SELECT COUNT(*) AS c FROM groups').c,
    peers:                  oneRow<{ c: number }>('SELECT COUNT(*) AS c FROM peers').c,
    oldest_measurement:     oneRow<{ ts: number | null }>('SELECT MIN(timestamp) AS ts FROM measurements').ts,
  };
}

export function startMaintenance(): void {
  if (timer) return;
  const tick = () => {
    try { refreshAllTargetStats(); } catch (e) { console.error('refreshAllTargetStats failed:', e); }
    try {
      const r = runRetention();
      if (r.rttsCleared > 0 || r.rowsDeleted > 0) {
        console.log(`retention: cleared rtts on ${r.rttsCleared} rows, deleted ${r.rowsDeleted} rows`);
      }
    } catch (e) { console.error('runRetention failed:', e); }
  };
  // Kick once on startup so the dashboard isn't empty for the first
  // 10 minutes after install.
  tick();
  timer = setInterval(tick, MAINTENANCE_INTERVAL_MS);
}

export function stopMaintenance(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

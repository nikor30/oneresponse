import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { toCsv } from '../util/csv.js';

const router = Router();

interface MeasurementRow {
  id: number;
  target_id: string;
  peer_id: string | null;
  timestamp: number;
  latency_min: number | null;
  latency_avg: number | null;
  latency_max: number | null;
  jitter: number | null;
  loss_pct: number | null;
  probe_count: number | null;
  sla_score: number | null;
  rtts: number[] | null;
}

interface TargetMetaRow {
  name: string;
  host: string;
  site_code: string | null;
  group_name: string;
}

function queryMeasurements(
  targetId: string,
  from: number,
  to: number,
  bucket: number,
  limit: number,
): MeasurementRow[] {
  const db = getDb();
  if (bucket > 0) {
    // Server-side downsampling: aggregate into time buckets so very long
    // ranges (7d/30d) stay performant and don't blow past the row limit.
    // We drop individual rtts in bucketed mode — the SmokePing-style chart
    // falls back to min/max range for the smoke band.
    return db.prepare(`
      SELECT
        0 AS id,
        ? AS target_id,
        NULL AS peer_id,
        (CAST(timestamp / ? AS INTEGER) * ?) AS timestamp,
        MIN(latency_min) AS latency_min,
        AVG(latency_avg) AS latency_avg,
        MAX(latency_max) AS latency_max,
        AVG(jitter)      AS jitter,
        AVG(loss_pct)    AS loss_pct,
        SUM(probe_count) AS probe_count,
        AVG(sla_score)   AS sla_score,
        NULL             AS rtts
      FROM measurements
      WHERE target_id = ? AND timestamp >= ? AND timestamp <= ?
      GROUP BY CAST(timestamp / ? AS INTEGER)
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(targetId, bucket, bucket, targetId, from, to, bucket, limit) as MeasurementRow[];
  }
  const rows = db.prepare(`
    SELECT id, target_id, peer_id, timestamp, latency_min, latency_avg, latency_max,
           jitter, loss_pct, probe_count, sla_score, rtts
    FROM measurements
    WHERE target_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
    LIMIT ?
  `).all(targetId, from, to, limit) as Array<Omit<MeasurementRow, 'rtts'> & { rtts: string | null }>;
  // Parse rtts JSON into number[]
  return rows.map(r => ({
    ...r,
    rtts: r.rtts ? safeParseRtts(r.rtts) : null,
  }));
}

function safeParseRtts(s: string): number[] | null {
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'number') : null;
  } catch {
    return null;
  }
}

// Get measurements for a target (time series data)
router.get('/:targetId', (req: Request, res: Response) => {
  const db = getDb();
  const targetId = String(req.params.targetId);
  const from = parseInt(req.query.from as string) || Math.floor(Date.now() / 1000) - 86400;
  const to = parseInt(req.query.to as string) || Math.floor(Date.now() / 1000);
  const limit = Math.min(parseInt(req.query.limit as string) || 5000, 20000);
  const bucket = Math.max(0, parseInt(req.query.bucket as string) || 0);

  const target = db.prepare('SELECT id FROM targets WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Target not found' });

  res.json(queryMeasurements(targetId, from, to, bucket, limit));
});

const EXPORT_COLUMNS = [
  'target_id', 'target_name', 'host', 'site_code', 'group_name',
  'timestamp_iso', 'timestamp_unix',
  'latency_min_ms', 'latency_avg_ms', 'latency_max_ms',
  'jitter_ms', 'loss_pct', 'probe_count', 'sla_score',
];

function measurementRowToCsv(m: MeasurementRow, meta: TargetMetaRow): Record<string, unknown> {
  return {
    target_id: m.target_id,
    target_name: meta.name,
    host: meta.host,
    site_code: meta.site_code,
    group_name: meta.group_name,
    timestamp_iso: new Date(m.timestamp * 1000).toISOString(),
    timestamp_unix: m.timestamp,
    latency_min_ms: m.latency_min,
    latency_avg_ms: m.latency_avg,
    latency_max_ms: m.latency_max,
    jitter_ms: m.jitter,
    loss_pct: m.loss_pct,
    probe_count: m.probe_count,
    sla_score: m.sla_score,
  };
}

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// Export measurements for one target as CSV (Excel-compatible)
router.get('/:targetId/export.csv', (req: Request, res: Response) => {
  const db = getDb();
  const targetId = String(req.params.targetId);
  const from = parseInt(req.query.from as string) || 0;
  const to = parseInt(req.query.to as string) || Math.floor(Date.now() / 1000);
  const limit = Math.min(parseInt(req.query.limit as string) || 100000, 500000);

  const target = db.prepare(`
    SELECT t.name, t.host, t.site_code, g.name AS group_name
    FROM targets t JOIN groups g ON t.group_id = g.id
    WHERE t.id = ?
  `).get(targetId) as TargetMetaRow | undefined;
  if (!target) return res.status(404).json({ error: 'Target not found' });

  const measurements = queryMeasurements(targetId, from, to, 0, limit);
  const rows = measurements.map(m => measurementRowToCsv(m, target));
  const csv = toCsv(rows, EXPORT_COLUMNS);
  const safeName = target.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  sendCsv(res, `measurements_${safeName}.csv`, csv);
});

export default router;

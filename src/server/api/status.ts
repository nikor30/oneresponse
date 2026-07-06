import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { toCsv } from '../util/csv.js';

const router = Router();

// Client liveness view: every target with its latest local measurement and
// a computed alive/dead verdict. "Dead" means either the last probe saw
// 100% packet loss, or no measurement has arrived within the staleness
// window (3× the probe interval, min 90s) — e.g. the scheduler can't reach
// the client at all.
export type ClientStatusKind = 'alive' | 'dead' | 'no-data' | 'disabled';

interface StatusQueryRow {
  id: string;
  name: string;
  host: string;
  site_code: string | null;
  group_id: string;
  group_name: string;
  probe_type: string | null;
  enabled: number;
  probe_interval: number;
  timestamp: number | null;
  latency_avg: number | null;
  jitter: number | null;
  loss_pct: number | null;
  sla_score: number | null;
}

export interface ClientStatusEntry extends Omit<StatusQueryRow, 'probe_type'> {
  probe_type: string;
  status: ClientStatusKind;
  status_reason: string | null;
  checked_at: number;
}

function staleAfterSeconds(probeInterval: number): number {
  return Math.max((probeInterval || 300) * 3, 90);
}

export function computeStatus(
  row: Pick<StatusQueryRow, 'enabled' | 'timestamp' | 'loss_pct' | 'probe_interval'>,
  now: number,
): { status: ClientStatusKind; reason: string | null } {
  if (!row.enabled) return { status: 'disabled', reason: null };
  if (row.timestamp == null) return { status: 'no-data', reason: 'never measured' };
  const age = now - row.timestamp;
  if (age > staleAfterSeconds(row.probe_interval)) {
    const mins = Math.max(1, Math.round(age / 60));
    return { status: 'dead', reason: `no data for ${mins} min` };
  }
  if ((row.loss_pct ?? 0) >= 100) return { status: 'dead', reason: '100% packet loss' };
  return { status: 'alive', reason: null };
}

function queryStatus(): ClientStatusEntry[] {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const rows = db.prepare(`
    SELECT t.id, t.name, t.host, t.site_code, t.group_id, g.name AS group_name,
           t.probe_type, t.enabled, t.probe_interval,
           m.timestamp, m.latency_avg, m.jitter, m.loss_pct, m.sla_score
    FROM targets t
    JOIN groups g ON t.group_id = g.id
    LEFT JOIN measurements m ON m.id = (
      SELECT id FROM measurements
      WHERE target_id = t.id AND peer_id IS NULL
      ORDER BY timestamp DESC LIMIT 1
    )
    ORDER BY g.name, t.name
  `).all() as StatusQueryRow[];

  return rows.map(r => {
    const { status, reason } = computeStatus(r, now);
    return {
      ...r,
      probe_type: r.probe_type || 'icmp',
      status,
      status_reason: reason,
      checked_at: now,
    };
  });
}

router.get('/', (_req: Request, res: Response) => {
  res.json(queryStatus());
});

const STATUS_CSV_COLUMNS = [
  'id', 'name', 'host', 'site_code', 'group_name', 'probe_type',
  'status', 'status_reason', 'enabled',
  'last_seen_iso', 'last_seen_unix',
  'latency_avg_ms', 'jitter_ms', 'loss_pct', 'sla_score',
];

router.get('/export.csv', (_req: Request, res: Response) => {
  const rows = queryStatus().map(r => ({
    id: r.id,
    name: r.name,
    host: r.host,
    site_code: r.site_code,
    group_name: r.group_name,
    probe_type: r.probe_type,
    status: r.status,
    status_reason: r.status_reason,
    enabled: r.enabled,
    last_seen_iso: r.timestamp != null ? new Date(r.timestamp * 1000).toISOString() : null,
    last_seen_unix: r.timestamp,
    latency_avg_ms: r.latency_avg,
    jitter_ms: r.jitter,
    loss_pct: r.loss_pct,
    sla_score: r.sla_score,
  }));
  const csv = toCsv(rows, STATUS_CSV_COLUMNS);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="client_status.csv"');
  res.send(csv);
});

export default router;

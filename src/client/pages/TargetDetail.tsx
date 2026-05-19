import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Target, type Measurement } from '../api/client';
import SmokePingGraph from '../components/SmokePingGraph';

const TIME_RANGES = [
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
  { label: '24h', seconds: 86400 },
  { label: '7d', seconds: 604800 },
  { label: '30d', seconds: 2592000 },
];

// Bucket size (seconds) to keep transferred points <= ~500
function bucketForRange(rangeSec: number): number {
  if (rangeSec <= 86400) return 0;       // ≤ 24h → raw points
  if (rangeSec <= 604800) return 1800;   // 7d → 30-min buckets (≈ 336)
  return 7200;                            // 30d → 2-hour buckets (≈ 360)
}

function rangeLabel(seconds: number): string {
  const r = TIME_RANGES.find(x => x.seconds === seconds);
  if (!r) return '';
  switch (r.label) {
    case '1h': return 'Last 1 Hour';
    case '6h': return 'Last 6 Hours';
    case '24h': return 'Last 24 Hours';
    case '7d': return 'Last 7 Days';
    case '30d': return 'Last 30 Days';
    default: return `Last ${r.label}`;
  }
}

export default function TargetDetail() {
  const { id } = useParams<{ id: string }>();
  const [target, setTarget] = useState<Target | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [range, setRange] = useState(86400);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [loading, setLoading] = useState(true);

  const from = now - range;
  const to = now;

  useEffect(() => {
    if (!id) return;
    api.getTarget(id).then(setTarget).catch(console.error);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const t = Math.floor(Date.now() / 1000);
    setNow(t);
    const f = t - range;
    const bucket = bucketForRange(range);
    api.getMeasurements(id, f, t, bucket).then(m => {
      setMeasurements(m);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id, range]);

  const exportUrl = useMemo(
    () => id ? api.exportMeasurementsCsvUrl(id, from, to) : '',
    [id, from, to],
  );

  if (!target) return <div style={{ padding: 40, color: '#999' }}>Loading...</div>;

  return (
    <div>
      <Link to="/" style={{ color: '#e94560', textDecoration: 'none', fontSize: 13 }}>
        &larr; Back to Dashboard
      </Link>
      <h1 style={{ fontSize: 22, margin: '12px 0 4px' }}>{target.name}</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        {target.host} {target.site_code && `(${target.site_code})`} &mdash; every {target.probe_interval}s, {target.probe_count} pings
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {TIME_RANGES.map(r => (
          <button
            key={r.label}
            onClick={() => setRange(r.seconds)}
            style={{
              padding: '4px 14px',
              border: `1px solid ${range === r.seconds ? '#e94560' : '#ddd'}`,
              background: range === r.seconds ? '#e94560' : '#fff',
              color: range === r.seconds ? '#fff' : '#333',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {r.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <a
          href={exportUrl}
          style={{
            padding: '4px 14px',
            background: '#0f172a',
            color: '#fff',
            borderRadius: 4,
            fontSize: 13,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Export CSV
        </a>
      </div>

      <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', position: 'relative' }}>
        {loading && (
          <div style={{ position: 'absolute', top: 12, right: 16, color: '#94a3b8', fontSize: 12 }}>
            Loading…
          </div>
        )}
        <SmokePingGraph
          measurements={measurements}
          title={`${target.name} — ${rangeLabel(range)}`}
          from={from}
          to={to}
          probeCount={target.probe_count}
          probeIntervalSec={target.probe_interval}
        />
      </div>
    </div>
  );
}

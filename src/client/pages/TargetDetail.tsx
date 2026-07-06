import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Target, type Measurement } from '../api/client';
import SmokePingGraph from '../components/SmokePingGraph';
import IpSlaGraph from '../components/IpSlaGraph';

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
  const [range, setRange] = useState(21600); // 6h default
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

  if (!target) return <div style={{ padding: 40, color: 'var(--text-dim)' }}>Loading...</div>;

  const isIpsla = target.probe_type === 'cisco-ipsla';

  return (
    <div>
      <Link to="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 13 }}>
        &larr; Back to Dashboard
      </Link>
      <h1 style={{ fontSize: 22, margin: '12px 0 4px', color: 'var(--text)' }}>
        {target.name}
        {isIpsla && (
          <span style={{
            marginLeft: 10, fontSize: 11, fontWeight: 700, padding: '2px 8px',
            borderRadius: 4, verticalAlign: 'middle',
            background: 'rgba(6,182,212,0.14)', color: '#06b6d4', border: '1px solid #06b6d4',
          }}>IP SLA</span>
        )}
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
        {target.host} {target.site_code && `(${target.site_code})`} &mdash; every {target.probe_interval}s
        {isIpsla ? ` · Cisco IP SLA ${target.ipsla_oper_type} op #${target.ipsla_oper_index}` : `, ${target.probe_count} pings`}
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {TIME_RANGES.map(r => (
          <button
            key={r.label}
            onClick={() => setRange(r.seconds)}
            style={{
              padding: '4px 14px',
              border: `1px solid ${range === r.seconds ? 'var(--accent)' : 'var(--border)'}`,
              background: range === r.seconds ? 'var(--accent)' : 'var(--bg-card)',
              color: range === r.seconds ? 'var(--accent-fg)' : 'var(--text-muted)',
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
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            borderRadius: 4,
            fontSize: 13,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Export CSV
        </a>
      </div>

      <div style={cardStyle}>
        {loading && (
          <div style={{ position: 'absolute', top: 12, right: 16, color: 'var(--text-dim)', fontSize: 12 }}>
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

      {isIpsla && (
        <div style={{ ...cardStyle, marginTop: 20 }}>
          <h2 style={{ fontSize: 15, margin: '0 0 12px', color: 'var(--text)' }}>
            IP SLA metrics — {rangeLabel(range)}
          </h2>
          <IpSlaGraph measurements={measurements} from={from} to={to} />
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 20,
  boxShadow: 'var(--shadow)',
  position: 'relative',
};

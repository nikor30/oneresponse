import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Target, type Measurement } from '../api/client';
import TimeSeriesGraph from '../components/TimeSeriesGraph';

const TIME_RANGES = [
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
  { label: '24h', seconds: 86400 },
  { label: '7d', seconds: 604800 },
  { label: '30d', seconds: 2592000 },
];

export default function TargetDetail() {
  const { id } = useParams<{ id: string }>();
  const [target, setTarget] = useState<Target | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [range, setRange] = useState(86400);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.getTarget(id).then(setTarget).catch(console.error);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const from = Math.floor(Date.now() / 1000) - range;
    api.getMeasurements(id, from).then(m => {
      setMeasurements(m);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id, range]);

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

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
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
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading measurements...</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <TimeSeriesGraph measurements={measurements} title={`${target.name} — Latency`} />
        </div>
      )}
    </div>
  );
}

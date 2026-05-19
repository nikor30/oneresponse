import React, { useEffect, useMemo, useState } from 'react';
import { api, type Target, type Measurement } from '../api/client';
import SmokePingGraph from './SmokePingGraph';

const TIME_RANGES = [
  { label: '1h',  seconds: 3600 },
  { label: '6h',  seconds: 21600 },
  { label: '24h', seconds: 86400 },
  { label: '7d',  seconds: 604800 },
  { label: '30d', seconds: 2592000 },
];

function bucketForRange(rangeSec: number): number {
  if (rangeSec <= 86400) return 0;
  if (rangeSec <= 604800) return 1800;
  return 7200;
}

function rangeLabel(seconds: number): string {
  const r = TIME_RANGES.find(x => x.seconds === seconds);
  if (!r) return '';
  switch (r.label) {
    case '1h':  return 'Last 1 Hour';
    case '6h':  return 'Last 6 Hours';
    case '24h': return 'Last 24 Hours';
    case '7d':  return 'Last 7 Days';
    case '30d': return 'Last 30 Days';
    default: return `Last ${r.label}`;
  }
}

interface Props {
  targetId: string | null;
  onClose: () => void;
}

// Floating window for target detail. Slides up from the bottom of the
// screen, dims the dashboard, and shows the SmokePing graph with the same
// controls as the /targets/:id page. Closes on Escape, backdrop click,
// or the X button.
export default function TargetDetailModal({ targetId, onClose }: Props) {
  const [target, setTarget] = useState<Target | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [range, setRange] = useState(21600); // 6h default
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = now - range;
  const to = now;

  // Esc key closes
  useEffect(() => {
    if (!targetId) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [targetId, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!targetId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [targetId]);

  // Load the target metadata
  useEffect(() => {
    if (!targetId) { setTarget(null); return; }
    setError(null);
    api.getTarget(targetId).then(setTarget).catch(e => setError(e.message));
  }, [targetId]);

  // Load measurements when target/range changes
  useEffect(() => {
    if (!targetId) return;
    setLoading(true);
    const t = Math.floor(Date.now() / 1000);
    setNow(t);
    api.getMeasurements(targetId, t - range, t, bucketForRange(range))
      .then(m => { setMeasurements(m); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [targetId, range]);

  const exportUrl = useMemo(
    () => targetId ? api.exportMeasurementsCsvUrl(targetId, from, to) : '',
    [targetId, from, to],
  );

  const open = targetId != null;

  return (
    <>
      <div
        onClick={onClose}
        className="modal-backdrop"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15,23,42,0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
          zIndex: 200,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-modal-title"
        style={{
          position: 'fixed',
          left: '50%',
          bottom: open ? 24 : -40,
          transform: `translateX(-50%) translateY(${open ? '0' : '40px'})`,
          opacity: open ? 1 : 0,
          width: 'min(96vw, 1100px)',
          maxHeight: '90vh',
          background: 'var(--bg-card)',
          color: 'var(--text)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.45), 0 0 0 1px var(--border)',
          padding: 0,
          transition: 'opacity 0.22s ease, bottom 0.22s ease, transform 0.22s ease',
          pointerEvents: open ? 'auto' : 'none',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ minWidth: 0 }}>
            {target ? (
              <>
                <div id="target-modal-title" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                  {target.name}
                  {target.site_code && (
                    <span style={{ color: 'var(--accent)', fontWeight: 500, marginLeft: 8, fontSize: 14 }}>
                      ({target.site_code})
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {target.host} · every {target.probe_interval}s, {target.probe_count} pings
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{error ?? 'Loading…'}</div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 0,
              fontSize: 24,
              lineHeight: 1,
              cursor: 'pointer',
              padding: 4,
              color: 'var(--text-muted)',
            }}
          >×</button>
        </header>

        {target && (
          <div style={{ padding: 20, overflow: 'auto' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              {TIME_RANGES.map(r => (
                <button
                  key={r.label}
                  onClick={() => setRange(r.seconds)}
                  style={{
                    padding: '4px 14px',
                    border: `1px solid ${range === r.seconds ? 'var(--accent)' : 'var(--border)'}`,
                    background: range === r.seconds ? 'var(--accent)' : 'transparent',
                    color: range === r.seconds ? 'var(--accent-fg)' : 'var(--text)',
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
                  background: 'var(--text)',
                  color: 'var(--bg-card)',
                  borderRadius: 4,
                  fontSize: 13,
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                Export CSV
              </a>
              <a
                href={`/targets/${target.id}`}
                style={{
                  padding: '4px 14px',
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  fontSize: 13,
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Open full page →
              </a>
            </div>

            <div style={{ position: 'relative' }}>
              {loading && (
                <div style={{ position: 'absolute', top: 0, right: 0, color: 'var(--text-dim)', fontSize: 12 }}>
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
        )}
      </div>
    </>
  );
}

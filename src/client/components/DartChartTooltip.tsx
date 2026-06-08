import React from 'react';
import type { DashboardTarget } from '../api/client';

interface Props {
  target: DashboardTarget;
  groupName: string;
  x: number;
  y: number;
}

const styles = {
  container: (x: number, y: number) => ({
    position: 'absolute' as const,
    left: x + 15,
    top: y - 10,
    background: 'rgba(26, 26, 46, 0.95)',
    color: '#fff',
    padding: '12px 16px',
    borderRadius: 8,
    fontSize: 12,
    lineHeight: 1.6,
    pointerEvents: 'none' as const,
    zIndex: 100,
    minWidth: 220,
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  }),
  label: {
    color: '#aaa',
    marginRight: 8,
  } as React.CSSProperties,
  value: {
    fontWeight: 600,
  } as React.CSSProperties,
  title: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 8,
    borderBottom: '1px solid #444',
    paddingBottom: 6,
  } as React.CSSProperties,
  score: (score: number | null) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontWeight: 700,
    fontSize: 13,
    background: score == null ? '#666' : score >= 70 ? '#28a745' : '#dc3545',
    color: '#fff',
  }) as React.CSSProperties,
};

function fmt(val: number | null, unit: string = 'ms'): string {
  if (val == null) return 'N/A';
  return `${val.toFixed(2)} ${unit}`;
}

export default function DartChartTooltip({ target, groupName, x, y }: Props) {
  return (
    <div style={styles.container(x, y)}>
      <div style={styles.title}>
        {target.name} {target.site_code && <span style={{ color: '#e94560' }}>({target.site_code})</span>}
        {target.probe_type === 'cisco-ipsla' && (
          <span style={{
            marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px',
            borderRadius: 4, background: 'rgba(6,182,212,0.18)', color: '#22d3ee',
            border: '1px solid #06b6d4',
          }}>IP SLA</span>
        )}
      </div>
      <div><span style={styles.label}>Group:</span> <span style={styles.value}>{groupName}</span></div>
      <div><span style={styles.label}>Host:</span> <span style={styles.value}>{target.host}</span></div>
      <div><span style={styles.label}>Latency:</span> <span style={styles.value}>
        {fmt(target.latency_min)} / {fmt(target.latency_avg)} / {fmt(target.latency_max)}
      </span></div>
      <div style={{ color: '#999', fontSize: 10, marginLeft: 70 }}>min / avg / max</div>
      <div><span style={styles.label}>Jitter:</span> <span style={styles.value}>{fmt(target.jitter)}</span></div>
      <div><span style={styles.label}>Loss:</span> <span style={styles.value}>{fmt(target.loss_pct, '%')}</span></div>
      <div style={{ marginTop: 6 }}>
        <span style={styles.label}>SLA Score:</span>{' '}
        <span style={styles.score(target.sla_score)}>{target.sla_score != null ? target.sla_score.toFixed(1) : 'N/A'}</span>
      </div>
      {target.timestamp && (
        <div style={{ marginTop: 4, color: '#888', fontSize: 10 }}>
          Last probe: {new Date(target.timestamp * 1000).toLocaleString()}
        </div>
      )}
    </div>
  );
}

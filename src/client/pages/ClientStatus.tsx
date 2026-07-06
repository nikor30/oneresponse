import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { api, type ClientStatusEntry, type ClientStatusKind } from '../api/client';

type SourceFilter = 'all' | 'icmp' | 'cisco-ipsla';
type StatusFilter = 'all' | ClientStatusKind;

const STATUS_LABEL: Record<ClientStatusKind, string> = {
  alive: 'Alive',
  dead: 'Dead',
  'no-data': 'No data',
  disabled: 'Disabled',
};
const STATUS_BADGE: Record<ClientStatusKind, string> = {
  alive: 'ok',
  dead: 'crit',
  'no-data': 'warn',
  disabled: 'neutral',
};

export default function ClientStatus() {
  const [entries, setEntries] = useState<ClientStatusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    try {
      setEntries(await api.getClientStatus());
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const groups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) seen.set(e.group_id, e.group_name);
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter(e => {
      if (group !== 'all' && e.group_id !== group) return false;
      if (source !== 'all' && e.probe_type !== source) return false;
      if (status !== 'all' && e.status !== status) return false;
      if (needle) {
        const hay = `${e.name} ${e.host} ${e.site_code || ''} ${e.group_name}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [entries, q, group, source, status]);

  const counts = useMemo(() => {
    const c: Record<ClientStatusKind, number> = { alive: 0, dead: 0, 'no-data': 0, disabled: 0 };
    for (const e of entries) c[e.status]++;
    return c;
  }, [entries]);

  // Export exactly what's on screen (current filters applied).
  const exportFiltered = () => {
    const cols = ['name', 'host', 'site_code', 'group_name', 'probe_type', 'status', 'status_reason', 'last_seen', 'latency_avg_ms', 'loss_pct', 'sla_score'];
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    for (const e of filtered) {
      lines.push([
        e.name, e.host, e.site_code, e.group_name, e.probe_type,
        e.status, e.status_reason,
        e.timestamp != null ? new Date(e.timestamp * 1000).toISOString() : '',
        e.latency_avg, e.loss_pct, e.sla_score,
      ].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'client_status_filtered.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>Loading client status…</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0, color: 'var(--text)' }}>Client Status</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={exportFiltered} style={exportBtn}>⬇ Export view (CSV)</button>
          <a href={api.exportStatusCsvUrl()} download="client_status.csv" style={exportBtn}>⬇ Export all (CSV)</a>
        </div>
      </div>

      {/* Summary tiles — click to filter by that status */}
      <div style={summaryCard}>
        <SummaryTile label="Total clients" value={entries.length} active={status === 'all'} onClick={() => setStatus('all')} />
        <Divider />
        <SummaryTile label="Alive" value={counts.alive} color="var(--ok)" active={status === 'alive'} onClick={() => setStatus('alive')} />
        <Divider />
        <SummaryTile label="Dead" value={counts.dead} color="var(--crit)" active={status === 'dead'} onClick={() => setStatus('dead')} />
        <Divider />
        <SummaryTile label="No data" value={counts['no-data']} color="var(--warn)" active={status === 'no-data'} onClick={() => setStatus('no-data')} />
        <Divider />
        <SummaryTile label="Disabled" value={counts.disabled} color="var(--text-dim)" active={status === 'disabled'} onClick={() => setStatus('disabled')} />
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          style={{ ...input, maxWidth: 260 }}
          placeholder="Search name, host, site…"
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Search clients"
        />
        <select style={{ ...input, width: 'auto', minWidth: 140 }} value={group} onChange={e => setGroup(e.target.value)} aria-label="Filter by group">
          <option value="all">All groups</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <div className="or-seg" role="group" aria-label="Filter by probe source">
          <button className={source === 'all' ? 'active' : ''} onClick={() => setSource('all')}>All sources</button>
          <button className={source === 'icmp' ? 'active' : ''} onClick={() => setSource('icmp')}>Local ICMP</button>
          <button className={source === 'cisco-ipsla' ? 'active' : ''} onClick={() => setSource('cisco-ipsla')}>IP SLA</button>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 'auto' }}>
          {filtered.length} of {entries.length} shown · refreshes every 30s
        </span>
      </div>

      {error && (
        <div style={{ color: 'var(--crit)', background: 'var(--crit-bg)', border: '1px solid var(--crit)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="or-table-wrap" style={{ borderRadius: 8, boxShadow: 'var(--shadow)', border: '1px solid var(--border)' }}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={th}>Status</th>
              <th style={th}>Name</th>
              <th style={th}>Host</th>
              <th style={th}>Group</th>
              <th style={th}>Source</th>
              <th style={{ ...th, textAlign: 'right' }}>Last seen</th>
              <th style={{ ...th, textAlign: 'right' }}>Latency</th>
              <th style={{ ...th, textAlign: 'right' }}>Loss</th>
              <th style={{ ...th, textAlign: 'right' }}>SLA</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={td}>
                  <span className={`or-badge ${STATUS_BADGE[e.status]}`} title={e.status_reason || undefined}>
                    <span className="dot" aria-hidden="true" />
                    {STATUS_LABEL[e.status]}
                  </span>
                  {e.status_reason && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{e.status_reason}</div>
                  )}
                </td>
                <td style={{ ...td, fontWeight: 600 }}>
                  <a href={`/targets/${e.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{e.name}</a>
                  {e.site_code && <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 6, fontSize: 12 }}>{e.site_code}</span>}
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{e.host}</td>
                <td style={td}>{e.group_name}</td>
                <td style={td}>
                  {e.probe_type === 'cisco-ipsla'
                    ? <span style={{ color: '#06b6d4', fontWeight: 600, fontSize: 12 }}>IP SLA</span>
                    : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>ICMP</span>}
                </td>
                <td style={{ ...td, textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{ago(e.timestamp)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{e.latency_avg != null ? `${e.latency_avg.toFixed(1)} ms` : '—'}</td>
                <td style={{ ...td, textAlign: 'right', color: (e.loss_pct ?? 0) > 0 ? 'var(--crit)' : undefined }}>
                  {e.loss_pct != null ? `${e.loss_pct.toFixed(1)}%` : '—'}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: e.sla_score == null ? 'var(--text-dim)' : e.sla_score >= 70 ? 'var(--ok)' : 'var(--crit)' }}>
                  {e.sla_score != null ? e.sla_score.toFixed(0) : '—'}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
                {entries.length === 0 ? 'No targets configured yet.' : 'Nothing matches the current filters.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ago(ts: number | null): string {
  if (ts == null) return 'never';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function SummaryTile({ label, value, color, active, onClick }: {
  label: string; value: number; color?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: '1 1 110px',
        background: active ? 'var(--bg-hover)' : 'transparent',
        border: 'none',
        borderRadius: 8,
        padding: '10px 14px',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: color || 'var(--text)' }}>{value}</div>
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', margin: '6px 0' }} aria-hidden="true" />;
}

const summaryCard: React.CSSProperties = {
  display: 'flex', alignItems: 'stretch', gap: 4, flexWrap: 'wrap',
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
  boxShadow: 'var(--shadow)', padding: 8, marginBottom: 16,
};
const input: React.CSSProperties = {
  padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-card)', color: 'var(--text)', width: '100%', boxSizing: 'border-box',
};
const exportBtn: React.CSSProperties = {
  padding: '6px 14px', border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--bg-card)', color: 'var(--text)', cursor: 'pointer',
  fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
};
const th: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontSize: 13, color: 'var(--text)', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px 16px', color: 'var(--text)' };
const tableStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-card)', color: 'var(--text)',
  borderCollapse: 'collapse', minWidth: 760,
};

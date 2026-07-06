import React, { useEffect, useMemo, useState } from 'react';
import { api, type DashboardNode, type DashboardTarget } from '../api/client';
import TargetDetailModal from '../components/TargetDetailModal';

interface Row {
  nodeName: string;            // local instance or peer name
  nodeUrl: string | null;      // null for local
  isRemote: boolean;
  group: string;
  groupId: string;
  target: DashboardTarget;
}

export default function Top10Page() {
  const [nodes, setNodes] = useState<DashboardNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTargetId, setOpenTargetId] = useState<string | null>(null);

  const load = async () => {
    try {
      setNodes(await api.getDashboardAggregate());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const node of nodes) {
      for (const g of node.dashboard) {
        for (const t of g.targets) {
          if (t.sla_score == null) continue;
          out.push({
            nodeName: node.site_name,
            nodeUrl: node.url,
            isRemote: node.peer_id != null,
            group: g.group.name,
            groupId: g.group.id,
            target: t,
          });
        }
      }
    }
    return out;
  }, [nodes]);

  // Best: highest SLA score (compliant). Worst: lowest SLA score (breached).
  const best = useMemo(() =>
    [...rows].sort((a, b) => (b.target.sla_score ?? 0) - (a.target.sla_score ?? 0)).slice(0, 10),
    [rows]
  );
  const worst = useMemo(() =>
    [...rows].sort((a, b) => (a.target.sla_score ?? 0) - (b.target.sla_score ?? 0)).slice(0, 10),
    [rows]
  );

  const onRowClick = (row: Row) => {
    if (row.isRemote && row.nodeUrl) {
      window.open(`${row.nodeUrl.replace(/\/$/, '')}/targets/${row.target.id}`, '_blank', 'noopener,noreferrer');
    } else {
      setOpenTargetId(row.target.id);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>Loading…</div>;
  }

  if (rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <h2 style={{ color: 'var(--text-muted)', marginBottom: 16 }}>No data yet</h2>
        <p style={{ color: 'var(--text-dim)' }}>Once probes have run, the best and worst performers will show here.</p>
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, margin: 0, color: 'var(--text)' }}>Top 10 — Rankings</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Ranked by SLA score across {nodes.length === 1 ? 'this instance' : 'all reachable instances'}.
          Click a row to open the latency graph.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gap: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
      }}>
        <RankingTable
          title="Best performing"
          accent="var(--ok)"
          rows={best}
          onRowClick={onRowClick}
          showMultipleNodes={nodes.length > 1}
        />
        <RankingTable
          title="Worst performing"
          accent="var(--crit)"
          rows={worst}
          onRowClick={onRowClick}
          showMultipleNodes={nodes.length > 1}
        />
      </div>

      <TargetDetailModal
        targetId={openTargetId}
        onClose={() => setOpenTargetId(null)}
      />
    </>
  );
}

function RankingTable({
  title, accent, rows, onRowClick, showMultipleNodes,
}: {
  title: string;
  accent: string;
  rows: Row[];
  onRowClick: (r: Row) => void;
  showMultipleNodes: boolean;
}) {
  const th: React.CSSProperties = {
    padding: '8px 10px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    background: 'var(--bg-hover)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '8px 10px',
    fontSize: 13,
    color: 'var(--text)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };
  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 8,
      boxShadow: 'var(--shadow)',
      border: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: accent }} />
        <strong style={{ fontSize: 14, color: 'var(--text)' }}>{title}</strong>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'right', width: 36 }}>#</th>
              <th style={th}>Target</th>
              {showMultipleNodes && <th style={th}>Instance</th>}
              <th style={th}>Group</th>
              <th style={{ ...th, textAlign: 'right' }}>SLA</th>
              <th style={{ ...th, textAlign: 'right' }}>Avg ms</th>
              <th style={{ ...th, textAlign: 'right' }}>Jitter</th>
              <th style={{ ...th, textAlign: 'right' }}>Loss</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={`${r.nodeName}-${r.target.id}-${idx}`}
                onClick={() => onRowClick(r)}
                style={{
                  cursor: 'pointer',
                  background: idx % 2 === 0 ? 'transparent' : 'var(--bg-hover)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'var(--bg-hover)')}
              >
                <td style={{ ...td, textAlign: 'right', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>{idx + 1}</td>
                <td style={{ ...td, fontWeight: 600 }}>
                  {r.target.name}
                  {r.target.site_code && (
                    <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                      ({r.target.site_code})
                    </span>
                  )}
                </td>
                {showMultipleNodes && (
                  <td style={{ ...td, color: r.isRemote ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {r.nodeName}
                  </td>
                )}
                <td style={{ ...td, color: 'var(--text-muted)' }}>{r.group}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  <ScoreCell value={r.target.sla_score} />
                </td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {r.target.latency_avg != null ? r.target.latency_avg.toFixed(1) : '—'}
                </td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                  {r.target.jitter != null ? r.target.jitter.toFixed(2) : '—'}
                </td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (r.target.loss_pct ?? 0) > 0 ? 'var(--crit)' : 'var(--text-muted)' }}>
                  {r.target.loss_pct != null ? `${r.target.loss_pct.toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={showMultipleNodes ? 8 : 7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>No targets to rank.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScoreCell({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: 'var(--text-dim)' }}>—</span>;
  const color = value >= 70 ? 'var(--ok)' : 'var(--crit)';
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 8px',
      borderRadius: 4,
      background: `${color}22`,
      color,
      fontWeight: 700,
      minWidth: 50,
      textAlign: 'right',
    }}>
      {value.toFixed(1)}
    </span>
  );
}

import React, { useEffect, useState, useCallback } from 'react';
import { api, type DashboardNode } from '../api/client';
import DartChart from '../components/DartChart';
import GroupSelector from '../components/GroupSelector';
import TargetDetailModal from '../components/TargetDetailModal';

export default function Dashboard() {
  const [nodes, setNodes] = useState<DashboardNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [openTargetId, setOpenTargetId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [data, settings] = await Promise.all([
        api.getDashboardAggregate(),
        api.getSettings().catch(() => ({} as Record<string, string | null>)),
      ]);
      setNodes(data);
      setShowLabels(settings.show_target_labels !== 'false');
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [loadData]);

  // Settings drawer dispatches this when site_name or show_target_labels changes
  useEffect(() => {
    const onSettings = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, string | null>>).detail;
      if (detail && 'show_target_labels' in detail) {
        setShowLabels(detail.show_target_labels !== 'false');
      }
      loadData();
    };
    window.addEventListener('oneresponse:settings-changed', onSettings);
    return () => window.removeEventListener('oneresponse:settings-changed', onSettings);
  }, [loadData]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>Loading dashboard...</div>;
  }

  if (nodes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <h2 style={{ color: 'var(--text-muted)', marginBottom: 16 }}>No monitoring data yet</h2>
        <p style={{ color: 'var(--text-dim)' }}>
          Create <a href="/groups" style={{ color: 'var(--accent)' }}>groups</a> and{' '}
          <a href="/targets" style={{ color: 'var(--accent)' }}>targets</a> to start monitoring.
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{
        display: 'grid',
        gap: 24,
        gridTemplateColumns: nodes.length > 1
          ? 'repeat(auto-fit, minmax(640px, 1fr))'
          : 'minmax(0, 820px)',
        justifyContent: 'center',
        justifyItems: 'center',
      }}>
        {nodes.map(node => (
          <NodePane
            key={node.peer_id ?? 'local'}
            node={node}
            showLabels={showLabels}
            onTargetClick={(targetId) => {
              if (node.peer_id == null) {
                setOpenTargetId(targetId);
              } else if (node.url) {
                window.open(`${node.url.replace(/\/$/, '')}/targets/${targetId}`, '_blank', 'noopener,noreferrer');
              }
            }}
          />
        ))}
      </div>
      <TargetDetailModal
        targetId={openTargetId}
        onClose={() => setOpenTargetId(null)}
      />
    </>
  );
}

function NodePane({
  node,
  onTargetClick,
  showLabels,
}: {
  node: DashboardNode;
  onTargetClick: (targetId: string) => void;
  showLabels: boolean;
}) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const isRemote = node.peer_id != null;
  const data = node.dashboard;

  const totalTargets = data.reduce((n, g) => n + g.targets.length, 0);
  const breached = data.reduce(
    (n, g) => n + g.targets.filter(t => (t.sla_score ?? 100) < 70).length,
    0
  );
  const noData = data.reduce(
    (n, g) => n + g.targets.filter(t => t.sla_score == null).length,
    0
  );

  return (
    <div style={{ width: '100%', maxWidth: 820 }}>
      <div style={{
        textAlign: 'center',
        marginBottom: 8,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: isRemote ? 'var(--accent)' : 'var(--text-dim)',
      }}>
        {isRemote ? '🌐 remote peer' : 'this instance'}
      </div>
      <h2 style={{
        textAlign: 'center',
        fontSize: 26,
        margin: 0,
        marginBottom: 4,
        fontWeight: 800,
        letterSpacing: -0.4,
        color: 'var(--text)',
      }}>
        {node.site_name}
      </h2>
      <div style={{
        textAlign: 'center',
        fontSize: 13,
        color: 'var(--text-muted)',
        marginBottom: 16,
      }}>
        Real-Time SLA View
        {isRemote && node.last_seen != null && (
          <> &nbsp;·&nbsp; updated {new Date(node.last_seen * 1000).toLocaleTimeString()}</>
        )}
      </div>

      {node.error ? (
        <div style={{
          background: 'rgba(220,38,38,0.08)',
          border: '1px solid rgba(220,38,38,0.35)',
          color: '#dc2626',
          padding: '14px 18px',
          borderRadius: 8,
          fontSize: 13,
          textAlign: 'center',
        }}>
          Could not reach this peer: <code>{node.error}</code>
        </div>
      ) : data.length === 0 ? (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px dashed var(--border)',
          color: 'var(--text-muted)',
          padding: '20px 18px',
          borderRadius: 8,
          fontSize: 13,
          textAlign: 'center',
        }}>
          {isRemote ? 'Peer reachable but has no monitoring data yet.' : 'No monitoring data yet.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <GroupSelector
              groups={data.map(d => ({ id: d.group.id, name: d.group.name }))}
              selected={selectedGroup}
              onSelect={setSelectedGroup}
            />
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)' }}>
              <span><strong style={{ color: 'var(--text)' }}>{totalTargets}</strong> targets</span>
              <span><strong style={{ color: breached > 0 ? '#dc2626' : '#16a34a' }}>{breached}</strong> breached</span>
              {noData > 0 && <span><strong style={{ color: 'var(--text-dim)' }}>{noData}</strong> awaiting data</span>}
            </div>
          </div>
          <DartChart
            data={data}
            onTargetClick={onTargetClick}
            selectedGroup={selectedGroup}
            showLabels={showLabels}
          />
        </>
      )}
    </div>
  );
}

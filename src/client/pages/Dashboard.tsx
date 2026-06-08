import React, { useEffect, useState, useCallback } from 'react';
import { api, type DashboardNode, type DashboardPeerStub } from '../api/client';
import DartChart from '../components/DartChart';
import GroupSelector from '../components/GroupSelector';
import TargetDetailModal from '../components/TargetDetailModal';

export default function Dashboard() {
  const [local, setLocal] = useState<DashboardNode | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [peerStubs, setPeerStubs] = useState<DashboardPeerStub[]>([]);
  const [peerData, setPeerData] = useState<Record<string, DashboardNode>>({});
  const [peerLoading, setPeerLoading] = useState<Record<string, boolean>>({});
  const [showLabels, setShowLabels] = useState(() => {
    try {
      return localStorage.getItem('oneresponse.show_target_labels') !== 'false';
    } catch { return true; }
  });
  const [openTargetId, setOpenTargetId] = useState<string | null>(null);

  // Local radar is always a fast, network-free DB read — paint it first.
  const loadLocal = useCallback(async () => {
    try {
      setLocal(await api.getDashboardLocal());
    } catch (err) {
      console.error('Failed to load local dashboard:', err);
    } finally {
      setLocalLoading(false);
    }
  }, []);

  // Peers load independently so a single slow/unreachable peer only shows a
  // placeholder in its own pane instead of stalling the whole page.
  const loadPeers = useCallback(async () => {
    let stubs: DashboardPeerStub[] = [];
    try {
      stubs = await api.getDashboardPeers();
    } catch (err) {
      console.error('Failed to list peers:', err);
    }
    setPeerStubs(stubs);
    setPeerLoading(prev => {
      const next = { ...prev };
      for (const s of stubs) if (next[s.peer_id] == null) next[s.peer_id] = true;
      return next;
    });
    stubs.forEach(stub => {
      api.getDashboardPeer(stub.peer_id)
        .then(node => setPeerData(prev => ({ ...prev, [stub.peer_id]: node })))
        .catch(err => setPeerData(prev => ({
          ...prev,
          [stub.peer_id]: {
            peer_id: stub.peer_id, peer_name: stub.peer_name, url: stub.url,
            site_name: stub.peer_name, dashboard: [], last_seen: null,
            error: (err as Error).message,
          },
        })))
        .finally(() => setPeerLoading(prev => ({ ...prev, [stub.peer_id]: false })));
    });
  }, []);

  const loadAll = useCallback(() => { loadLocal(); loadPeers(); }, [loadLocal, loadPeers]);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [loadAll]);

  // Settings drawer dispatches these — site_name update or labels toggle.
  useEffect(() => {
    const onSettings = () => loadAll();
    const onLabels = (e: Event) => {
      const detail = (e as CustomEvent<{ show_target_labels?: boolean }>).detail;
      if (detail?.show_target_labels != null) setShowLabels(detail.show_target_labels);
    };
    window.addEventListener('oneresponse:settings-changed', onSettings);
    window.addEventListener('oneresponse:labels-changed', onLabels);
    return () => {
      window.removeEventListener('oneresponse:settings-changed', onSettings);
      window.removeEventListener('oneresponse:labels-changed', onLabels);
    };
  }, [loadAll]);

  if (localLoading && local == null) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>Loading dashboard…</div>;
  }

  const localHasData = local != null && local.dashboard.length > 0;
  const nothingAnywhere = !localHasData && peerStubs.length === 0;

  if (nothingAnywhere) {
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

  const paneCount = (local ? 1 : 0) + peerStubs.length;

  return (
    <>
      <div style={{
        display: 'grid',
        gap: 24,
        gridTemplateColumns: paneCount > 1
          ? 'repeat(auto-fit, minmax(min(100%, 540px), 1fr))'
          : 'minmax(0, 1000px)',
        justifyContent: 'center',
        justifyItems: 'center',
      }}>
        {local && (
          <NodePane
            key="local"
            node={local}
            loading={false}
            showLabels={showLabels}
            onTargetClick={(targetId) => setOpenTargetId(targetId)}
          />
        )}
        {peerStubs.map(stub => {
          const node: DashboardNode = peerData[stub.peer_id] ?? {
            peer_id: stub.peer_id, peer_name: stub.peer_name, url: stub.url,
            site_name: stub.peer_name, dashboard: [], last_seen: null, error: null,
          };
          const loading = peerLoading[stub.peer_id] ?? true;
          return (
            <NodePane
              key={stub.peer_id}
              node={node}
              loading={loading}
              showLabels={showLabels}
              onTargetClick={(targetId) => {
                if (node.url) {
                  window.open(`${node.url.replace(/\/$/, '')}/targets/${targetId}`, '_blank', 'noopener,noreferrer');
                }
              }}
            />
          );
        })}
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
  loading,
}: {
  node: DashboardNode;
  onTargetClick: (targetId: string) => void;
  showLabels: boolean;
  loading: boolean;
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
    <div style={{ width: '100%', maxWidth: 1000 }}>
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

      {loading ? (
        <PaneLoading isRemote={isRemote} />
      ) : node.error ? (
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

// Per-pane placeholder shown while a (possibly slow or unreachable) peer is
// still being fetched — keeps the rest of the dashboard interactive.
function PaneLoading({ isRemote }: { isRemote: boolean }) {
  return (
    <div style={{
      position: 'relative',
      width: '100%',
      aspectRatio: '1 / 1',
      maxWidth: 1000,
      margin: '0 auto',
      background: 'var(--chart-bg)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      boxShadow: 'var(--shadow-md)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    }}>
      <div className="or-skeleton-disc" />
      <div className="or-spinner" aria-hidden="true" />
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {isRemote ? 'Contacting peer…' : 'Loading…'}
      </div>
    </div>
  );
}

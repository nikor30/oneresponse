import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { api, type DashboardNode, type DashboardPeerStub, type DashboardGroup } from '../api/client';
import DartChart from '../components/DartChart';
import GroupSelector from '../components/GroupSelector';
import TargetDetailModal from '../components/TargetDetailModal';

type SourceFilter = 'all' | 'icmp' | 'cisco-ipsla';

// Peers running an older version don't send probe_type — treat those
// targets as local ICMP so filtering stays predictable.
function probeTypeOf(t: { probe_type?: string }): 'icmp' | 'cisco-ipsla' {
  return t.probe_type === 'cisco-ipsla' ? 'cisco-ipsla' : 'icmp';
}

function filterBySource(data: DashboardGroup[], source: SourceFilter): DashboardGroup[] {
  if (source === 'all') return data;
  return data
    .map(g => ({ ...g, targets: g.targets.filter(t => probeTypeOf(t) === source) }))
    .filter(g => g.targets.length > 0);
}

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
      {local && (
        <SummaryBar
          local={local}
          peers={peerStubs.map(s => peerData[s.peer_id]).filter(Boolean)}
          peerCount={peerStubs.length}
        />
      )}
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
  const [source, setSource] = useState<SourceFilter>('all');
  const isRemote = node.peer_id != null;

  const hasIpsla = useMemo(
    () => node.dashboard.some(g => g.targets.some(t => probeTypeOf(t) === 'cisco-ipsla')),
    [node.dashboard]
  );
  const data = useMemo(
    () => filterBySource(node.dashboard, source),
    [node.dashboard, source]
  );

  // Switching source can remove the currently selected group from view —
  // fall back to "All groups" so the chart never renders empty.
  useEffect(() => {
    if (selectedGroup && !data.some(g => g.group.id === selectedGroup)) {
      setSelectedGroup(null);
    }
  }, [data, selectedGroup]);

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
          color: 'var(--crit)',
          padding: '14px 18px',
          borderRadius: 8,
          fontSize: 13,
          textAlign: 'center',
        }}>
          Could not reach this peer: <code>{node.error}</code>
        </div>
      ) : node.dashboard.length === 0 ? (
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {hasIpsla && (
                <div className="or-seg" role="group" aria-label="Filter by probe source">
                  <button className={source === 'all' ? 'active' : ''} onClick={() => setSource('all')}>All sources</button>
                  <button className={source === 'icmp' ? 'active' : ''} onClick={() => setSource('icmp')}>Local ICMP</button>
                  <button className={source === 'cisco-ipsla' ? 'active' : ''} onClick={() => setSource('cisco-ipsla')}>IP SLA</button>
                </div>
              )}
              <GroupSelector
                groups={data.map(d => ({ id: d.group.id, name: d.group.name }))}
                selected={selectedGroup}
                onSelect={setSelectedGroup}
              />
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)' }}>
              <span><strong style={{ color: 'var(--text)' }}>{totalTargets}</strong> targets</span>
              <span><strong style={{ color: breached > 0 ? 'var(--crit)' : 'var(--ok)' }}>{breached}</strong> breached</span>
              {noData > 0 && <span><strong style={{ color: 'var(--text-dim)' }}>{noData}</strong> awaiting data</span>}
            </div>
          </div>
          {data.length === 0 ? (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px dashed var(--border)',
              color: 'var(--text-muted)',
              padding: '20px 18px',
              borderRadius: 8,
              fontSize: 13,
              textAlign: 'center',
            }}>
              No {source === 'cisco-ipsla' ? 'Cisco IP SLA' : 'local ICMP'} targets on this node.
            </div>
          ) : (
            <DartChart
              data={data}
              onTargetClick={onTargetClick}
              selectedGroup={selectedGroup}
              showLabels={showLabels}
            />
          )}
        </>
      )}
    </div>
  );
}

// vRNI-style summary strip: entity counts with red "unhealthy" chips.
// Numbers come from the local node plus whatever peer panes have loaded.
function SummaryBar({ local, peers, peerCount }: {
  local: DashboardNode;
  peers: DashboardNode[];
  peerCount: number;
}) {
  const allTargets = local.dashboard.flatMap(g => g.targets);
  const icmp = allTargets.filter(t => probeTypeOf(t) === 'icmp');
  const ipsla = allTargets.filter(t => probeTypeOf(t) === 'cisco-ipsla');
  const breachedOf = (ts: { sla_score: number | null }[]) =>
    ts.filter(t => t.sla_score != null && t.sla_score < 70).length;
  const awaiting = allTargets.filter(t => t.sla_score == null).length;
  const peersDown = peers.filter(p => p.error != null).length;

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', gap: 4, flexWrap: 'wrap',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
      boxShadow: 'var(--shadow)', padding: 8, marginBottom: 20,
    }}>
      <SummaryStat label="Targets" value={allTargets.length} bad={breachedOf(allTargets)} badLabel="Breached" />
      <SummaryDivider />
      <SummaryStat label="Local ICMP" value={icmp.length} bad={breachedOf(icmp)} badLabel="Breached" />
      <SummaryDivider />
      <SummaryStat label="Cisco IP SLA" value={ipsla.length} bad={breachedOf(ipsla)} badLabel="Breached" />
      <SummaryDivider />
      <SummaryStat label="Peers" value={peerCount} bad={peersDown} badLabel="Unreachable" />
      {awaiting > 0 && (
        <>
          <SummaryDivider />
          <SummaryStat label="Awaiting data" value={awaiting} bad={0} badLabel="" />
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, value, bad, badLabel }: {
  label: string; value: number; bad: number; badLabel: string;
}) {
  return (
    <div style={{ flex: '1 1 130px', padding: '10px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: 'var(--text)' }}>{value}</span>
        {bad > 0 && (
          <span className="or-badge crit">{bad} {badLabel}</span>
        )}
      </div>
    </div>
  );
}

function SummaryDivider() {
  return <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', margin: '6px 0' }} aria-hidden="true" />;
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

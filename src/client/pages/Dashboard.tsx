import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type DashboardGroup } from '../api/client';
import DartChart from '../components/DartChart';
import GroupSelector from '../components/GroupSelector';

export default function Dashboard() {
  const [data, setData] = useState<DashboardGroup[]>([]);
  const [siteName, setSiteName] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    try {
      const [dashboard, settings] = await Promise.all([
        api.getDashboard(),
        api.getSettings().catch(() => ({} as Record<string, string | null>)),
      ]);
      setData(dashboard);
      setSiteName(settings.site_name || 'oneresponse');
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

  // Re-read the site name when the user updates it from the settings drawer
  useEffect(() => {
    const onSettings = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, string | null>>).detail;
      if (detail && typeof detail.site_name === 'string') {
        setSiteName(detail.site_name || 'oneresponse');
      }
    };
    window.addEventListener('oneresponse:settings-changed', onSettings);
    return () => window.removeEventListener('oneresponse:settings-changed', onSettings);
  }, []);

  const handleTargetClick = useCallback((targetId: string) => {
    navigate(`/targets/${targetId}`);
  }, [navigate]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>Loading dashboard...</div>;
  }

  if (data.length === 0) {
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
    <div>
      {/* Instance/site name — identifies which oneresponse node you're viewing */}
      <div style={{
        textAlign: 'center',
        marginBottom: 8,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: 'var(--text-dim)',
      }}>
        oneresponse instance
      </div>
      <h1 style={{
        textAlign: 'center',
        fontSize: 30,
        margin: 0,
        marginBottom: 4,
        fontWeight: 800,
        letterSpacing: -0.5,
        color: 'var(--text)',
      }}>
        {siteName}
      </h1>
      <div style={{
        textAlign: 'center',
        fontSize: 13,
        color: 'var(--text-muted)',
        marginBottom: 20,
      }}>
        Real-Time SLA View
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <GroupSelector
          groups={data.map(d => ({ id: d.group.id, name: d.group.name }))}
          selected={selectedGroup}
          onSelect={setSelectedGroup}
        />
        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-muted)' }}>
          <span><strong style={{ color: 'var(--text)' }}>{totalTargets}</strong> targets</span>
          <span><strong style={{ color: breached > 0 ? '#dc2626' : '#16a34a' }}>{breached}</strong> breached</span>
          {noData > 0 && <span><strong style={{ color: 'var(--text-dim)' }}>{noData}</strong> awaiting data</span>}
        </div>
      </div>
      <DartChart data={data} onTargetClick={handleTargetClick} selectedGroup={selectedGroup} />
    </div>
  );
}

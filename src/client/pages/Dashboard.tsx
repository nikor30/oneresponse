import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type DashboardGroup } from '../api/client';
import DartChart from '../components/DartChart';
import GroupSelector from '../components/GroupSelector';

export default function Dashboard() {
  const [data, setData] = useState<DashboardGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    try {
      const dashboard = await api.getDashboard();
      setData(dashboard);
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

  const handleTargetClick = useCallback((targetId: string) => {
    navigate(`/targets/${targetId}`);
  }, [navigate]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Loading dashboard...</div>;
  }

  if (data.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <h2 style={{ color: '#666', marginBottom: 16 }}>No monitoring data yet</h2>
        <p style={{ color: '#999' }}>
          Create <a href="/groups" style={{ color: '#e94560' }}>groups</a> and{' '}
          <a href="/targets" style={{ color: '#e94560' }}>targets</a> to start monitoring.
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
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 26, margin: 0, fontWeight: 700, letterSpacing: -0.3 }}>Real-Time SLA View</h1>
        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#475569' }}>
          <span><strong style={{ color: '#0f172a' }}>{totalTargets}</strong> targets</span>
          <span><strong style={{ color: breached > 0 ? '#dc2626' : '#16a34a' }}>{breached}</strong> breached</span>
          {noData > 0 && <span><strong style={{ color: '#6b7280' }}>{noData}</strong> awaiting data</span>}
        </div>
      </div>
      <GroupSelector
        groups={data.map(d => ({ id: d.group.id, name: d.group.name }))}
        selected={selectedGroup}
        onSelect={setSelectedGroup}
      />
      <DartChart data={data} onTargetClick={handleTargetClick} selectedGroup={selectedGroup} />
    </div>
  );
}

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

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Real-Time SLA View</h1>
      <GroupSelector
        groups={data.map(d => ({ id: d.group.id, name: d.group.name }))}
        selected={selectedGroup}
        onSelect={setSelectedGroup}
      />
      <DartChart data={data} onTargetClick={handleTargetClick} selectedGroup={selectedGroup} />
    </div>
  );
}

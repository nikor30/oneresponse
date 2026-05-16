import React, { useEffect, useState } from 'react';
import { api, type Group } from '../api/client';
import CsvIO from '../components/CsvIO';

const emptyForm = { name: '', description: '', sla_latency_ms: 100, sla_jitter_ms: 30, sla_loss_pct: 1 };

export default function GroupManager() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => api.getGroups().then(setGroups).catch(e => setError(e.message));

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.updateGroup(editingId, form);
      } else {
        await api.createGroup(form);
      }
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleEdit = (g: Group) => {
    setEditingId(g.id);
    setForm({ name: g.name, description: g.description || '', sla_latency_ms: g.sla_latency_ms, sla_jitter_ms: g.sla_jitter_ms, sla_loss_pct: g.sla_loss_pct });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this group and all its targets?')) return;
    await api.deleteGroup(id);
    load();
  };

  const inputStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 };
  const btnStyle: React.CSSProperties = { padding: '6px 16px', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Groups / Regions</h1>
        <CsvIO
          exportUrl={api.exportGroupsCsvUrl()}
          exportFilename="groups.csv"
          onImport={api.importGroupsCsv}
          onImported={load}
        />
      </div>

      <form onSubmit={handleSubmit} style={{ background: '#fff', padding: 20, borderRadius: 8, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px 100px 100px', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Name</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Description</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>SLA Latency (ms)</label>
            <input type="number" style={{ ...inputStyle, width: '100%' }} value={form.sla_latency_ms} onChange={e => setForm({ ...form, sla_latency_ms: +e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>SLA Jitter (ms)</label>
            <input type="number" style={{ ...inputStyle, width: '100%' }} value={form.sla_jitter_ms} onChange={e => setForm({ ...form, sla_jitter_ms: +e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>SLA Loss (%)</label>
            <input type="number" step="0.1" style={{ ...inputStyle, width: '100%' }} value={form.sla_loss_pct} onChange={e => setForm({ ...form, sla_loss_pct: +e.target.value })} />
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="submit" style={{ ...btnStyle, background: '#e94560', color: '#fff' }}>
            {editingId ? 'Update' : 'Add Group'}
          </button>
          {editingId && (
            <button type="button" style={{ ...btnStyle, background: '#eee' }} onClick={() => { setEditingId(null); setForm(emptyForm); }}>
              Cancel
            </button>
          )}
        </div>
        {error && <div style={{ color: '#dc3545', marginTop: 8, fontSize: 13 }}>{error}</div>}
      </form>

      <table style={{ width: '100%', background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #eee' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13 }}>Name</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13 }}>Description</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>SLA Latency</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>SLA Jitter</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>SLA Loss</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '10px 16px', fontWeight: 600 }}>{g.name}</td>
              <td style={{ padding: '10px 16px', color: '#666' }}>{g.description || '—'}</td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>{g.sla_latency_ms} ms</td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>{g.sla_jitter_ms} ms</td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>{g.sla_loss_pct}%</td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                <a
                  href={api.exportGroupMeasurementsCsvUrl(g.id)}
                  download={`measurements_group_${g.name.replace(/[^a-zA-Z0-9._-]+/g, '_')}.csv`}
                  style={{ ...btnStyle, background: '#eef2ff', color: '#0f172a', marginRight: 4, fontSize: 12, textDecoration: 'none' } as React.CSSProperties}
                >
                  Export data
                </a>
                <button onClick={() => handleEdit(g)} style={{ ...btnStyle, background: '#eee', marginRight: 4, fontSize: 12 }}>Edit</button>
                <button onClick={() => handleDelete(g.id)} style={{ ...btnStyle, background: '#fee', color: '#dc3545', fontSize: 12 }}>Delete</button>
              </td>
            </tr>
          ))}
          {groups.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#999' }}>No groups yet. Create one above.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

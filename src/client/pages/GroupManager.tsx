import React, { useEffect, useState } from 'react';
import { api, type Group } from '../api/client';
import CsvIO from '../components/CsvIO';

const emptyForm = {
  name: '',
  description: '',
  sla_latency_ms: 100,
  sla_jitter_ms: 30,
  sla_loss_pct: 1,
  viz_latency_min: '' as string | number,
  viz_latency_max: '' as string | number,
};

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
      const payload = {
        name: form.name,
        description: form.description,
        sla_latency_ms: form.sla_latency_ms,
        sla_jitter_ms: form.sla_jitter_ms,
        sla_loss_pct: form.sla_loss_pct,
        viz_latency_min: form.viz_latency_min === '' ? null : Number(form.viz_latency_min),
        viz_latency_max: form.viz_latency_max === '' ? null : Number(form.viz_latency_max),
      };
      if (editingId) {
        await api.updateGroup(editingId, payload);
      } else {
        await api.createGroup(payload);
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
    setForm({
      name: g.name,
      description: g.description || '',
      sla_latency_ms: g.sla_latency_ms,
      sla_jitter_ms: g.sla_jitter_ms,
      sla_loss_pct: g.sla_loss_pct,
      viz_latency_min: g.viz_latency_min ?? '',
      viz_latency_max: g.viz_latency_max ?? '',
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this group and all its targets?')) return;
    await api.deleteGroup(id);
    load();
  };

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    border: '1px solid var(--border)',
    borderRadius: 4,
    fontSize: 13,
    background: 'var(--bg-card)',
    color: 'var(--text)',
  };
  const btnStyle: React.CSSProperties = {
    padding: '6px 16px',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  };
  const fieldLabel: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    color: 'var(--text)',
    padding: 20,
    borderRadius: 8,
    marginBottom: 24,
    boxShadow: 'var(--shadow)',
    border: '1px solid var(--border)',
  };
  const th: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontSize: 13, color: 'var(--text)', fontWeight: 600 };
  const td: React.CSSProperties = { padding: '10px 16px', color: 'var(--text)' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0, color: 'var(--text)' }}>Groups / Regions</h1>
        <CsvIO
          exportUrl={api.exportGroupsCsvUrl()}
          exportFilename="groups.csv"
          onImport={api.importGroupsCsv}
          onImported={load}
        />
      </div>

      <form onSubmit={handleSubmit} style={cardStyle}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
          {editingId ? 'Edit group' : 'Add a group'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={fieldLabel}>Name</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label style={fieldLabel}>Description</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label style={fieldLabel}>SLA Latency (ms)</label>
            <input type="number" style={{ ...inputStyle, width: '100%' }} value={form.sla_latency_ms} onChange={e => setForm({ ...form, sla_latency_ms: +e.target.value })} />
          </div>
          <div>
            <label style={fieldLabel}>SLA Jitter (ms)</label>
            <input type="number" style={{ ...inputStyle, width: '100%' }} value={form.sla_jitter_ms} onChange={e => setForm({ ...form, sla_jitter_ms: +e.target.value })} />
          </div>
          <div>
            <label style={fieldLabel}>SLA Loss (%)</label>
            <input type="number" step="0.1" style={{ ...inputStyle, width: '100%' }} value={form.sla_loss_pct} onChange={e => setForm({ ...form, sla_loss_pct: +e.target.value })} />
          </div>
        </div>

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 8 }}>
            Chart range (visualization only — leave blank for default)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'end' }}>
            <div>
              <label style={fieldLabel}>Center value (ms)</label>
              <input
                type="number"
                style={{ ...inputStyle, width: '100%' }}
                placeholder="0"
                value={form.viz_latency_min}
                onChange={e => setForm({ ...form, viz_latency_min: e.target.value })}
              />
            </div>
            <div>
              <label style={fieldLabel}>Edge value (ms)</label>
              <input
                type="number"
                style={{ ...inputStyle, width: '100%' }}
                placeholder={`${form.sla_latency_ms * 3}`}
                value={form.viz_latency_max}
                onChange={e => setForm({ ...form, viz_latency_max: e.target.value })}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', alignSelf: 'center' }}>
              Default: 0 → 3× SLA latency. SLA threshold always sits on the
              70% ring regardless of these values.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button type="submit" style={{ ...btnStyle, background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            {editingId ? 'Update' : 'Add Group'}
          </button>
          {editingId && (
            <button
              type="button"
              style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)' }}
              onClick={() => { setEditingId(null); setForm(emptyForm); }}
            >
              Cancel
            </button>
          )}
        </div>
        {error && <div style={{ color: '#dc2626', marginTop: 8, fontSize: 13 }}>{error}</div>}
      </form>

      <table style={{
        width: '100%',
        background: 'var(--bg-card)',
        color: 'var(--text)',
        borderRadius: 8,
        boxShadow: 'var(--shadow)',
        border: '1px solid var(--border)',
        borderCollapse: 'collapse',
      }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={th}>Name</th>
            <th style={th}>Description</th>
            <th style={{ ...th, textAlign: 'right' }}>SLA Latency</th>
            <th style={{ ...th, textAlign: 'right' }}>SLA Jitter</th>
            <th style={{ ...th, textAlign: 'right' }}>SLA Loss</th>
            <th style={{ ...th, textAlign: 'right' }}>Chart range</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ ...td, fontWeight: 600 }}>{g.name}</td>
              <td style={{ ...td, color: 'var(--text-muted)' }}>{g.description || '—'}</td>
              <td style={{ ...td, textAlign: 'right' }}>{g.sla_latency_ms} ms</td>
              <td style={{ ...td, textAlign: 'right' }}>{g.sla_jitter_ms} ms</td>
              <td style={{ ...td, textAlign: 'right' }}>{g.sla_loss_pct}%</td>
              <td style={{ ...td, textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {g.viz_latency_min == null && g.viz_latency_max == null
                  ? '—'
                  : `${g.viz_latency_min ?? 0} → ${g.viz_latency_max ?? g.sla_latency_ms * 3} ms`}
              </td>
              <td style={{ ...td, textAlign: 'right' }}>
                <a
                  href={api.exportGroupMeasurementsCsvUrl(g.id)}
                  download={`measurements_group_${g.name.replace(/[^a-zA-Z0-9._-]+/g, '_')}.csv`}
                  style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)', marginRight: 4, fontSize: 12, textDecoration: 'none' } as React.CSSProperties}
                >
                  Export data
                </a>
                <button
                  onClick={() => handleEdit(g)}
                  style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)', marginRight: 4, fontSize: 12 }}
                >Edit</button>
                <button
                  onClick={() => handleDelete(g.id)}
                  style={{ ...btnStyle, background: '#fee', color: '#dc2626', fontSize: 12 }}
                >Delete</button>
              </td>
            </tr>
          ))}
          {groups.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>No groups yet. Create one above.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

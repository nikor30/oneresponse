import React, { useEffect, useState } from 'react';
import { api, type Target, type Group } from '../api/client';

const emptyForm = { group_id: '', name: '', host: '', site_code: '', probe_interval: 300, probe_count: 20, enabled: 1 };

export default function TargetManager() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const [t, g] = await Promise.all([api.getTargets(), api.getGroups()]);
    setTargets(t);
    setGroups(g);
    if (g.length > 0 && !form.group_id) setForm(f => ({ ...f, group_id: g[0].id }));
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.updateTarget(editingId, form);
      } else {
        await api.createTarget(form);
      }
      setForm({ ...emptyForm, group_id: form.group_id });
      setEditingId(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleEdit = (t: Target) => {
    setEditingId(t.id);
    setForm({ group_id: t.group_id, name: t.name, host: t.host, site_code: t.site_code || '', probe_interval: t.probe_interval, probe_count: t.probe_count, enabled: t.enabled });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this target and all its measurements?')) return;
    await api.deleteTarget(id);
    load();
  };

  const groupMap = new Map(groups.map(g => [g.id, g.name]));
  const inputStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 };
  const btnStyle: React.CSSProperties = { padding: '6px 16px', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 };

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Targets</h1>

      {groups.length === 0 && (
        <div style={{ padding: 16, background: '#fff3cd', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          Please <a href="/groups" style={{ color: '#e94560' }}>create a group</a> first before adding targets.
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ background: '#fff', padding: 20, borderRadius: 8, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr 100px 80px 80px', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Group</label>
            <select style={{ ...inputStyle, width: '100%' }} value={form.group_id} onChange={e => setForm({ ...form, group_id: e.target.value })} required>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Name</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Host (IP/Hostname)</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} required placeholder="8.8.8.8" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Site Code</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.site_code} onChange={e => setForm({ ...form, site_code: e.target.value })} placeholder="DUB01" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Interval (s)</label>
            <input type="number" style={{ ...inputStyle, width: '100%' }} value={form.probe_interval} onChange={e => setForm({ ...form, probe_interval: +e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Pings</label>
            <input type="number" style={{ ...inputStyle, width: '100%' }} value={form.probe_count} onChange={e => setForm({ ...form, probe_count: +e.target.value })} />
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="submit" style={{ ...btnStyle, background: '#e94560', color: '#fff' }}>
            {editingId ? 'Update' : 'Add Target'}
          </button>
          {editingId && (
            <button type="button" style={{ ...btnStyle, background: '#eee' }} onClick={() => { setEditingId(null); setForm({ ...emptyForm, group_id: form.group_id }); }}>
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
            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13 }}>Host</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13 }}>Site Code</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13 }}>Group</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>Interval</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>Pings</th>
            <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 13 }}>Enabled</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {targets.map(t => (
            <tr key={t.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '10px 16px', fontWeight: 600 }}>
                <a href={`/targets/${t.id}`} style={{ color: '#e94560', textDecoration: 'none' }}>{t.name}</a>
              </td>
              <td style={{ padding: '10px 16px', fontFamily: 'monospace' }}>{t.host}</td>
              <td style={{ padding: '10px 16px' }}>{t.site_code || '—'}</td>
              <td style={{ padding: '10px 16px' }}>{groupMap.get(t.group_id) || '?'}</td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>{t.probe_interval}s</td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>{t.probe_count}</td>
              <td style={{ padding: '10px 16px', textAlign: 'center' }}>{t.enabled ? 'Yes' : 'No'}</td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                <button onClick={() => handleEdit(t)} style={{ ...btnStyle, background: '#eee', marginRight: 4, fontSize: 12 }}>Edit</button>
                <button onClick={() => handleDelete(t.id)} style={{ ...btnStyle, background: '#fee', color: '#dc3545', fontSize: 12 }}>Delete</button>
              </td>
            </tr>
          ))}
          {targets.length === 0 && (
            <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#999' }}>No targets yet. Add one above.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

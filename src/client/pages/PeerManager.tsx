import React, { useEffect, useState } from 'react';
import { api, type Peer } from '../api/client';

const emptyForm = { name: '', url: '', api_key: '', direction: 'both' };

export default function PeerManager() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => api.getPeers().then(setPeers).catch(e => setError(e.message));

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.updatePeer(editingId, form);
      } else {
        await api.createPeer(form);
      }
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleEdit = (p: Peer) => {
    setEditingId(p.id);
    setForm({ name: p.name, url: p.url, api_key: '', direction: p.direction });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this peer?')) return;
    await api.deletePeer(id);
    load();
  };

  const inputStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 };
  const btnStyle: React.CSSProperties = { padding: '6px 16px', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 };

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Peers</h1>
      <p style={{ color: '#666', marginBottom: 16, fontSize: 13 }}>
        Connect to other oneresponse instances to measure from multiple locations.
      </p>

      <form onSubmit={handleSubmit} style={{ background: '#fff', padding: 20, borderRadius: 8, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 120px', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Name</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Remote Probe 1" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>URL</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} required placeholder="https://probe1.example.com" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>API Key</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} required={!editingId} placeholder="shared-secret-key" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666' }}>Direction</label>
            <select style={{ ...inputStyle, width: '100%' }} value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}>
              <option value="both">Both</option>
              <option value="push">Push</option>
              <option value="pull">Pull</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="submit" style={{ ...btnStyle, background: '#e94560', color: '#fff' }}>
            {editingId ? 'Update' : 'Add Peer'}
          </button>
          {editingId && (
            <button type="button" style={{ ...btnStyle, background: '#eee' }} onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</button>
          )}
        </div>
        {error && <div style={{ color: '#dc3545', marginTop: 8, fontSize: 13 }}>{error}</div>}
      </form>

      <table style={{ width: '100%', background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #eee' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13 }}>Name</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13 }}>URL</th>
            <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 13 }}>Direction</th>
            <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 13 }}>Enabled</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13 }}>Last Seen</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {peers.map(p => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '10px 16px', fontWeight: 600 }}>{p.name}</td>
              <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12 }}>{p.url}</td>
              <td style={{ padding: '10px 16px', textAlign: 'center' }}>{p.direction}</td>
              <td style={{ padding: '10px 16px', textAlign: 'center' }}>{p.enabled ? 'Yes' : 'No'}</td>
              <td style={{ padding: '10px 16px', color: '#666' }}>
                {p.last_seen ? new Date(p.last_seen * 1000).toLocaleString() : 'Never'}
              </td>
              <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                <button onClick={() => handleEdit(p)} style={{ ...btnStyle, background: '#eee', marginRight: 4, fontSize: 12 }}>Edit</button>
                <button onClick={() => handleDelete(p.id)} style={{ ...btnStyle, background: '#fee', color: '#dc3545', fontSize: 12 }}>Delete</button>
              </td>
            </tr>
          ))}
          {peers.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#999' }}>No peers configured.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { api, type Peer, type ApiKey, type ApiKeyWithSecret, type PeerTestResult } from '../api/client';

const emptyForm = { name: '', url: '', api_key: '' };

export default function PeerManager() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<ApiKeyWithSecret | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [keyErr, setKeyErr] = useState('');
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, PeerTestResult>>({});

  const testPeer = async (id: string) => {
    setTesting(t => ({ ...t, [id]: true }));
    try {
      const result = await api.testPeer(id);
      setTestResults(r => ({ ...r, [id]: result }));
      // Refresh peers so the table reflects last_error / last_seen
      loadPeers();
    } catch (err) {
      setTestResults(r => ({
        ...r,
        [id]: { ok: false, elapsed_ms: 0, url: '', error: (err as Error).message },
      }));
    } finally {
      setTesting(t => ({ ...t, [id]: false }));
    }
  };

  const loadPeers = () => api.getPeers().then(setPeers).catch(e => setError(e.message));
  const loadKeys  = () => api.getApiKeys().then(setKeys).catch(e => setKeyErr(e.message));

  useEffect(() => { loadPeers(); loadKeys(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.updatePeer(editingId, form);
      } else {
        await api.createPeer({ ...form, direction: 'both' });
      }
      setForm(emptyForm);
      setEditingId(null);
      loadPeers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleEdit = (p: Peer) => {
    setEditingId(p.id);
    setForm({ name: p.name, url: p.url, api_key: '' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this peer?')) return;
    await api.deletePeer(id);
    loadPeers();
  };

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeyErr('');
    if (!newKeyName.trim()) { setKeyErr('Name is required'); return; }
    try {
      const created = await api.createApiKey(newKeyName.trim());
      setNewKey(created);
      setNewKeyName('');
      loadKeys();
    } catch (err) {
      setKeyErr((err as Error).message);
    }
  };

  const deleteKey = async (id: string) => {
    if (!confirm('Revoke this API key? Any peer using it will lose access.')) return;
    await api.deleteApiKey(id);
    loadKeys();
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    border: '1px solid var(--border)',
    borderRadius: 4,
    fontSize: 13,
    background: 'var(--bg-card)',
    color: 'var(--text)',
  };
  const btnStyle: React.CSSProperties = { padding: '6px 16px', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 };
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    color: 'var(--text)',
    padding: 20,
    borderRadius: 8,
    marginBottom: 24,
    boxShadow: 'var(--shadow)',
    border: '1px solid var(--border)',
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://this-node:3000';

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 16, color: 'var(--text)' }}>Peers</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 13 }}>
        Connect to other oneresponse instances to see them as additional panes on the dashboard.
      </p>

      {/* ------------- HOW TO ------------- */}
      <details open style={{ ...cardStyle, padding: 0 }}>
        <summary style={{
          padding: '14px 20px',
          fontWeight: 600,
          fontSize: 14,
          cursor: 'pointer',
          color: 'var(--text)',
        }}>
          How to add a second node
        </summary>
        <div style={{ padding: '0 20px 18px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>
          <ol style={{ paddingLeft: 20 }}>
            <li>
              <strong>Run oneresponse on the second machine</strong> &mdash; clone the repo and{' '}
              <code style={inlineCode}>docker compose up -d</code>, or build from source. It will listen on port 3000.
            </li>
            <li>
              <strong>Make sure both nodes can reach each other over HTTPS</strong> (recommended) or HTTP.
              Note the remote node's URL, e.g. <code style={inlineCode}>https://probe2.example.com</code>.
            </li>
            <li>
              <strong>Create an API key on the <em>remote</em> node</strong> &mdash; open its
              {' '}<code style={inlineCode}>/peers</code> page and use the <em>API keys</em> section
              below to create one. Copy the raw key value (shown only once).
            </li>
            <li>
              <strong>Add the peer here</strong> &mdash; fill in the form below with the remote URL
              and the API key you just created on the other side.
            </li>
            <li>
              <strong>Repeat on the remote node</strong> &mdash; create an API key on <em>this</em> node and add this one as a peer there too.
              This node's URL is <code style={inlineCode}>{origin}</code>.
              Once both sides are paired, every dashboard, modal and ranking shows both nodes.
            </li>
          </ol>
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
            The peer link is authenticated via the <code style={inlineCode}>X-API-Key</code> HTTP header.
            Treat keys like passwords &mdash; revoke them below if exposed.
          </p>
        </div>
      </details>

      {/* ------------- PEER FORM ------------- */}
      <form onSubmit={handleSubmit} style={cardStyle}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
          {editingId ? 'Edit peer' : 'Add a peer'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={fieldLabel}>Name</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Remote Probe 1" />
          </div>
          <div>
            <label style={fieldLabel}>URL</label>
            <input style={{ ...inputStyle, width: '100%' }} value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} required placeholder="https://probe1.example.com" />
          </div>
          <div>
            <label style={fieldLabel}>API key (from the remote node)</label>
            <input type="password" style={{ ...inputStyle, width: '100%' }} value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} required={!editingId} placeholder="paste here" />
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="submit" style={{ ...btnStyle, background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            {editingId ? 'Update' : 'Add Peer'}
          </button>
          {editingId && (
            <button type="button" style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)' }} onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</button>
          )}
        </div>
        {error && <div style={{ color: 'var(--crit)', marginTop: 8, fontSize: 13 }}>{error}</div>}
      </form>

      {/* ------------- PEERS TABLE ------------- */}
      <h2 style={{ fontSize: 16, marginBottom: 10, color: 'var(--text)' }}>Configured peers</h2>
      <table style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text)', borderRadius: 8, boxShadow: 'var(--shadow)', border: '1px solid var(--border)', borderCollapse: 'collapse', marginBottom: 24 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={th}>Name</th>
            <th style={th}>URL</th>
            <th style={{ ...th, textAlign: 'center' }}>Status</th>
            <th style={th}>Last Seen</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {peers.map(p => {
            const result = testResults[p.id];
            const hasError = !!p.last_error || (result && !result.ok);
            return (
              <React.Fragment key={p.id}>
                <tr style={{ borderBottom: (result || p.last_error) ? 'none' : '1px solid var(--border)' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{p.url}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {p.enabled ? (hasError ? (
                      <span style={{ color: 'var(--crit)' }}>⚠ Error</span>
                    ) : p.last_seen ? (
                      <span style={{ color: 'var(--ok)' }}>✓ OK</span>
                    ) : (
                      <span style={{ color: 'var(--text-dim)' }}>Never tried</span>
                    )) : (
                      <span style={{ color: 'var(--text-dim)' }}>Disabled</span>
                    )}
                  </td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>
                    {p.last_seen ? new Date(p.last_seen * 1000).toLocaleString() : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      onClick={() => testPeer(p.id)}
                      disabled={!!testing[p.id]}
                      style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)', marginRight: 4, fontSize: 12, opacity: testing[p.id] ? 0.5 : 1 }}
                    >
                      {testing[p.id] ? 'Testing…' : 'Test'}
                    </button>
                    <button onClick={() => handleEdit(p)} style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)', marginRight: 4, fontSize: 12 }}>Edit</button>
                    <button onClick={() => handleDelete(p.id)} style={{ ...btnStyle, background: 'var(--crit-bg)', color: 'var(--crit)', fontSize: 12 }}>Delete</button>
                  </td>
                </tr>
                {(result || p.last_error) && (
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td colSpan={5} style={{ padding: '0 16px 12px 16px' }}>
                      <div style={{
                        background: hasError ? 'rgba(220,38,38,0.08)' : 'rgba(34,197,94,0.08)',
                        border: `1px solid ${hasError ? 'rgba(220,38,38,0.35)' : 'rgba(34,197,94,0.35)'}`,
                        color: hasError ? 'var(--crit)' : 'var(--text)',
                        padding: '8px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        lineHeight: 1.5,
                      }}>
                        {result ? (
                          result.ok ? (
                            <>
                              <strong>Test OK</strong> — reached <code style={inlineCode}>{result.url}</code> in {result.elapsed_ms} ms.
                              {result.site_name && <> Peer reports site name: <strong>{result.site_name}</strong>.</>}
                            </>
                          ) : (
                            <>
                              <strong>Test failed{result.status ? ` (HTTP ${result.status})` : ''}</strong> — {result.error}
                              {result.status === 401 && (
                                <div style={{ marginTop: 4 }}>
                                  This usually means the API key in this peer record was created on the wrong side.
                                  The key must be generated on the <em>remote</em> node (the side being called) and pasted here.
                                </div>
                              )}
                            </>
                          )
                        ) : (
                          <><strong>Last dashboard refresh error:</strong> {p.last_error}</>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {peers.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>No peers configured.</td></tr>
          )}
        </tbody>
      </table>

      {/* ------------- API KEYS ------------- */}
      <h2 style={{ fontSize: 16, marginBottom: 10, color: 'var(--text)' }}>API keys</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Each key grants another oneresponse node access to this one (both read and write). Share the raw key value (shown once at creation) with the remote node's operator.
      </p>

      <form onSubmit={createKey} style={{ ...cardStyle, padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={fieldLabel}>Key name (e.g. "probe2-dub")</label>
            <input style={{ ...inputStyle, width: '100%' }} value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="descriptive name" />
          </div>
          <button type="submit" style={{ ...btnStyle, background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            Create key
          </button>
        </div>
        {keyErr && <div style={{ color: 'var(--crit)', marginTop: 8, fontSize: 13 }}>{keyErr}</div>}

        {newKey && (
          <div style={{
            marginTop: 12,
            padding: 12,
            background: 'rgba(34,197,94,0.08)',
            border: '1px dashed var(--ok)',
            borderRadius: 6,
            fontSize: 13,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>
              New key created — copy it now, you won't see it again.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ ...inlineCode, flex: 1, padding: '6px 10px', overflowWrap: 'anywhere', userSelect: 'all' }}>
                {newKey.key}
              </code>
              <button
                type="button"
                onClick={() => copy(newKey.key)}
                style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)', fontSize: 12 }}
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setNewKey(null)}
                style={{ ...btnStyle, background: 'transparent', color: 'var(--text-muted)', fontSize: 12 }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </form>

      <table style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text)', borderRadius: 8, boxShadow: 'var(--shadow)', border: '1px solid var(--border)', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={th}>Name</th>
            <th style={th}>Created</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(k => (
            <tr key={k.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ ...td, fontWeight: 600 }}>{k.name}</td>
              <td style={{ ...td, color: 'var(--text-muted)' }}>{new Date(k.created_at * 1000).toLocaleString()}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                <button onClick={() => deleteKey(k.id)} style={{ ...btnStyle, background: 'var(--crit-bg)', color: 'var(--crit)', fontSize: 12 }}>Revoke</button>
              </td>
            </tr>
          ))}
          {keys.length === 0 && (
            <tr><td colSpan={3} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>No API keys yet. Create one above.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const fieldLabel: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };
const th: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontSize: 13, color: 'var(--text)', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px 16px', color: 'var(--text)' };
const inlineCode: React.CSSProperties = {
  background: 'var(--bg-hover)',
  color: 'var(--text)',
  padding: '1px 5px',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 12,
};

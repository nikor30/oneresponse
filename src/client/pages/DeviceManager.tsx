import React, { useEffect, useState } from 'react';
import { api, type CiscoDevice, type DiscoveredOperation, type Group, type DeviceTestResult } from '../api/client';

const emptyForm = {
  name: '',
  host: '',
  snmp_port: 161,
  snmp_version: '2c' as '2c' | '3',
  community: '',
  v3_username: '',
  v3_auth_protocol: 'SHA',
  v3_auth_password: '',
  v3_priv_protocol: 'AES',
  v3_priv_password: '',
  poll_interval_seconds: 60,
};

export default function DeviceManager() {
  const [devices, setDevices] = useState<CiscoDevice[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, DeviceTestResult>>({});
  const [opsFor, setOpsFor] = useState<string | null>(null);
  const [ops, setOps] = useState<DiscoveredOperation[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsErr, setOpsErr] = useState<string | null>(null);
  const [opsChecked, setOpsChecked] = useState<Record<number, boolean>>({});
  const [importGroup, setImportGroup] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const load = async () => {
    setError('');
    try {
      const [d, g] = await Promise.all([api.getDevices(), api.getGroups()]);
      setDevices(d);
      setGroups(g);
      if (g.length && !importGroup) setImportGroup(g[0].id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...form };
      if (form.snmp_version === '2c') {
        // Avoid sending the v3 fields at all so we don't blank them on the server side
        delete (payload as Record<string, unknown>).v3_username;
        delete (payload as Record<string, unknown>).v3_auth_protocol;
        delete (payload as Record<string, unknown>).v3_auth_password;
        delete (payload as Record<string, unknown>).v3_priv_protocol;
        delete (payload as Record<string, unknown>).v3_priv_password;
      } else {
        delete (payload as Record<string, unknown>).community;
      }
      if (editingId) {
        // Don't blank secrets on edit unless the user typed something
        if (form.snmp_version === '2c' && !form.community) delete (payload as Record<string, unknown>).community;
        if (form.snmp_version === '3' && !form.v3_auth_password) delete (payload as Record<string, unknown>).v3_auth_password;
        if (form.snmp_version === '3' && !form.v3_priv_password) delete (payload as Record<string, unknown>).v3_priv_password;
        await api.updateDevice(editingId, payload);
      } else {
        await api.createDevice(payload);
      }
      setEditingId(null);
      setForm(emptyForm);
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onEdit = (d: CiscoDevice) => {
    setEditingId(d.id);
    setForm({
      ...emptyForm,
      name: d.name,
      host: d.host,
      snmp_port: d.snmp_port,
      snmp_version: d.snmp_version,
      v3_username: d.v3_username || '',
      v3_auth_protocol: d.v3_auth_protocol || 'SHA',
      v3_priv_protocol: d.v3_priv_protocol || 'AES',
      poll_interval_seconds: d.poll_interval_seconds,
    });
  };

  const onDelete = async (id: string) => {
    if (!confirm('Delete this device and unbind its targets?')) return;
    await api.deleteDevice(id);
    void load();
  };

  const onTest = async (d: CiscoDevice) => {
    setTesting(t => ({ ...t, [d.id]: true }));
    try {
      const r = await api.testDevice(d.id);
      setTestResults(prev => ({ ...prev, [d.id]: r }));
      void load();
    } catch (e) {
      setTestResults(prev => ({ ...prev, [d.id]: { ok: false, error: (e as Error).message } }));
    } finally {
      setTesting(t => ({ ...t, [d.id]: false }));
    }
  };

  const onDiscover = async (d: CiscoDevice) => {
    setOpsFor(d.id);
    setOps([]);
    setOpsChecked({});
    setOpsErr(null);
    setOpsLoading(true);
    setImportMsg(null);
    try {
      const list = await api.discoverOperations(d.id);
      setOps(list);
    } catch (e) {
      setOpsErr((e as Error).message);
    } finally {
      setOpsLoading(false);
    }
  };

  const onImport = async () => {
    if (!opsFor || !importGroup) return;
    const selected = ops.filter(o => opsChecked[o.index] && o.kind !== 'unsupported');
    if (selected.length === 0) { setImportMsg('Select at least one supported operation.'); return; }
    setImporting(true);
    setImportMsg(null);
    try {
      const r = await api.importDeviceOperations(opsFor, importGroup, selected.map(o => ({
        index: o.index, type: o.kind, target: o.target, name: o.tag || `op-${o.index}`,
      })));
      setImportMsg(`Imported ${r.created.length}${r.errors.length ? `, ${r.errors.length} errors` : ''}`);
      setOpsChecked({});
    } catch (e) {
      setImportMsg('Import failed: ' + (e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 8, color: 'var(--text)' }}>Cisco devices</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 13 }}>
        Read on-device IP SLA operation results over SNMP and feed them into oneresponse alongside the local ICMP probes.
        Operations must already be configured on the Cisco side — this integration only reads results.
        Prefer SNMPv3.
      </p>

      <form onSubmit={onSubmit} style={card}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
          {editingId ? 'Edit device' : 'Add a device'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px 110px 120px', gap: 10, alignItems: 'end' }}>
          <Field label="Name">
            <input style={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Host / IP">
            <input style={input} value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} required placeholder="10.0.0.1" />
          </Field>
          <Field label="SNMP port">
            <input type="number" style={input} value={form.snmp_port} onChange={e => setForm({ ...form, snmp_port: +e.target.value })} />
          </Field>
          <Field label="Version">
            <select style={input} value={form.snmp_version} onChange={e => setForm({ ...form, snmp_version: e.target.value as '2c' | '3' })}>
              <option value="2c">v2c</option>
              <option value="3">v3</option>
            </select>
          </Field>
          <Field label="Poll interval (s)">
            <input type="number" style={input} value={form.poll_interval_seconds} onChange={e => setForm({ ...form, poll_interval_seconds: +e.target.value })} />
          </Field>
        </div>

        {form.snmp_version === '2c' ? (
          <div style={{ marginTop: 10 }}>
            <Field label="Community string" hint={editingId ? 'Leave blank to keep current' : undefined}>
              <input type="password" style={input} value={form.community} onChange={e => setForm({ ...form, community: e.target.value })} placeholder={editingId ? 'unchanged' : 'public'} />
            </Field>
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 100px 1fr 100px 1fr', gap: 10 }}>
            <Field label="Username"><input style={input} value={form.v3_username} onChange={e => setForm({ ...form, v3_username: e.target.value })} /></Field>
            <Field label="Auth proto">
              <select style={input} value={form.v3_auth_protocol} onChange={e => setForm({ ...form, v3_auth_protocol: e.target.value })}>
                <option value="SHA">SHA</option>
                <option value="MD5">MD5</option>
              </select>
            </Field>
            <Field label="Auth password" hint={editingId ? 'Leave blank to keep current' : undefined}>
              <input type="password" style={input} value={form.v3_auth_password} onChange={e => setForm({ ...form, v3_auth_password: e.target.value })} placeholder={editingId ? 'unchanged' : ''} />
            </Field>
            <Field label="Priv proto">
              <select style={input} value={form.v3_priv_protocol} onChange={e => setForm({ ...form, v3_priv_protocol: e.target.value })}>
                <option value="AES">AES</option>
                <option value="DES">DES</option>
              </select>
            </Field>
            <Field label="Priv password" hint={editingId ? 'Leave blank to keep current' : undefined}>
              <input type="password" style={input} value={form.v3_priv_password} onChange={e => setForm({ ...form, v3_priv_password: e.target.value })} placeholder={editingId ? 'unchanged' : ''} />
            </Field>
          </div>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="submit" style={primaryBtn}>{editingId ? 'Update' : 'Add device'}</button>
          {editingId && (
            <button type="button" style={secondaryBtn} onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</button>
          )}
        </div>
        {error && <div style={{ color: '#dc2626', marginTop: 8, fontSize: 13 }}>{error}</div>}
      </form>

      <h2 style={{ fontSize: 16, margin: '0 0 10px', color: 'var(--text)' }}>Configured devices</h2>
      <table style={tableStyle}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={th}>Name</th>
            <th style={th}>Host</th>
            <th style={{ ...th, textAlign: 'center' }}>SNMP</th>
            <th style={{ ...th, textAlign: 'center' }}>Status</th>
            <th style={th}>Last seen</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.map(d => {
            const result = testResults[d.id];
            const hasErr = !!d.last_error || (result && !result.ok);
            return (
              <React.Fragment key={d.id}>
                <tr style={{ borderBottom: (result || d.last_error) ? 'none' : '1px solid var(--border)' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{d.host}:{d.snmp_port}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{d.snmp_version}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {!d.enabled ? <span style={{ color: 'var(--text-dim)' }}>Disabled</span>
                     : hasErr ? <span style={{ color: '#dc2626' }}>⚠ Error</span>
                     : d.last_seen ? <span style={{ color: '#16a34a' }}>✓ OK</span>
                     : <span style={{ color: 'var(--text-dim)' }}>Never tried</span>}
                  </td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>
                    {d.last_seen ? new Date(d.last_seen * 1000).toLocaleString() : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => onTest(d)} disabled={!!testing[d.id]} style={smallBtn}>{testing[d.id] ? 'Testing…' : 'Test'}</button>{' '}
                    <button onClick={() => onDiscover(d)} style={smallBtn}>Discover</button>{' '}
                    <button onClick={() => onEdit(d)} style={smallBtn}>Edit</button>{' '}
                    <button onClick={() => onDelete(d.id)} style={{ ...smallBtn, background: '#fee', color: '#dc2626' }}>Delete</button>
                  </td>
                </tr>
                {(result || d.last_error) && (
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td colSpan={6} style={{ padding: '0 16px 12px' }}>
                      <div style={{
                        background: hasErr ? 'rgba(220,38,38,0.08)' : 'rgba(34,197,94,0.08)',
                        border: `1px solid ${hasErr ? 'rgba(220,38,38,0.35)' : 'rgba(34,197,94,0.35)'}`,
                        color: hasErr ? '#dc2626' : 'var(--text)',
                        padding: '8px 12px', borderRadius: 6, fontSize: 12, lineHeight: 1.5,
                      }}>
                        {result ? (result.ok
                          ? <><strong>Connection OK</strong>{result.sysName ? <> — sysName: <code style={code}>{result.sysName}</code></> : null}{result.sysObjectID ? <> · sysObjectID: <code style={code}>{result.sysObjectID}</code></> : null}</>
                          : <><strong>Connection failed</strong> — {result.error}</>
                        ) : (<><strong>Last poll error:</strong> {d.last_error}</>)}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {devices.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>No devices yet.</td></tr>
          )}
        </tbody>
      </table>

      {opsFor && (
        <div style={{ ...card, marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>Discovered operations on {devices.find(d => d.id === opsFor)?.name}</strong>
            <button onClick={() => { setOpsFor(null); setOps([]); }} style={smallBtn}>Close</button>
          </div>
          {opsLoading && <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Walking rttMonCtrlAdminTable…</div>}
          {opsErr && <div style={{ color: '#dc2626', fontSize: 13 }}>{opsErr}</div>}
          {ops.length > 0 && (
            <>
              <table style={{ ...tableStyle, marginTop: 10, marginBottom: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th style={{ ...th, width: 36 }}><input type="checkbox" onChange={e => {
                      const all = e.target.checked;
                      const next: Record<number, boolean> = {};
                      for (const o of ops) if (o.kind !== 'unsupported') next[o.index] = all;
                      setOpsChecked(next);
                    }} /></th>
                    <th style={{ ...th, textAlign: 'right' }}>Index</th>
                    <th style={th}>Tag</th>
                    <th style={th}>Type</th>
                    <th style={th}>Destination</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map(o => (
                    <tr key={o.index} style={{ borderBottom: '1px solid var(--border)', opacity: o.kind === 'unsupported' ? 0.55 : 1 }}>
                      <td style={td}>
                        <input
                          type="checkbox"
                          disabled={o.kind === 'unsupported'}
                          checked={!!opsChecked[o.index]}
                          onChange={e => setOpsChecked(prev => ({ ...prev, [o.index]: e.target.checked }))}
                        />
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{o.index}</td>
                      <td style={td}>{o.tag || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                      <td style={td}>{o.kind}{o.kind === 'unsupported' ? <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>(rttType={o.rttType})</span> : null}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{o.target || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Import into group</span>
                <select style={{ ...input, width: 220 }} value={importGroup} onChange={e => setImportGroup(e.target.value)}>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <button onClick={onImport} disabled={importing || groups.length === 0} style={primaryBtn}>
                  {importing ? 'Importing…' : 'Import selected as targets'}
                </button>
                {importMsg && <span style={{ fontSize: 12, color: importMsg.startsWith('Import failed') ? '#dc2626' : '#16a34a' }}>{importMsg}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Subset of the Group shape we need
interface Group { id: string; name: string }

const card: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text)', padding: 20, borderRadius: 8,
  marginBottom: 24, boxShadow: 'var(--shadow)', border: '1px solid var(--border)',
};
const tableStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-card)', color: 'var(--text)',
  borderRadius: 8, boxShadow: 'var(--shadow)', border: '1px solid var(--border)',
  borderCollapse: 'collapse',
};
const th: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontSize: 13, color: 'var(--text)', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px 16px', color: 'var(--text)' };
const input: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13,
  background: 'var(--bg-card)', color: 'var(--text)', width: '100%', boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = { padding: '6px 16px', border: 0, borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-fg)' };
const secondaryBtn: React.CSSProperties = { padding: '6px 16px', border: 0, borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: 'var(--bg-hover)', color: 'var(--text)' };
const smallBtn: React.CSSProperties = { padding: '4px 10px', border: 0, borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: 'var(--bg-hover)', color: 'var(--text)' };
const code: React.CSSProperties = { background: 'var(--bg-hover)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

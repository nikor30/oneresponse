import React, { useEffect, useState } from 'react';
import { api, type Target, type Group, type CiscoDevice, type DiscoveredOperation } from '../api/client';
import CsvIO from '../components/CsvIO';

type ProbeType = 'icmp' | 'cisco-ipsla';

interface Form {
  group_id: string;
  name: string;
  host: string;
  site_code: string;
  probe_interval: number;
  probe_count: number;
  enabled: number;
  probe_type: ProbeType;
  device_id: string | null;
  ipsla_oper_index: number | null;
  ipsla_oper_type: string | null;
}

const emptyForm: Form = {
  group_id: '', name: '', host: '', site_code: '',
  probe_interval: 300, probe_count: 20, enabled: 1,
  probe_type: 'icmp',
  device_id: null, ipsla_oper_index: null, ipsla_oper_type: null,
};

export default function TargetManager() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [devices, setDevices] = useState<CiscoDevice[]>([]);
  const [opsByDevice, setOpsByDevice] = useState<Record<string, DiscoveredOperation[]>>({});
  const [opsLoading, setOpsLoading] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const [t, g, d] = await Promise.all([api.getTargets(), api.getGroups(), api.getDevices().catch(() => [] as CiscoDevice[])]);
    setTargets(t);
    setGroups(g);
    setDevices(d);
    if (g.length > 0 && !form.group_id) setForm(f => ({ ...f, group_id: g[0].id }));
  };

  useEffect(() => { void load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  // When the user picks a Cisco device, pull its operation list once so
  // the "operation" dropdown has something to choose from.
  useEffect(() => {
    if (form.probe_type !== 'cisco-ipsla' || !form.device_id) return;
    if (opsByDevice[form.device_id]) return;
    setOpsLoading(true);
    api.discoverOperations(form.device_id)
      .then(ops => setOpsByDevice(prev => ({ ...prev, [form.device_id!]: ops })))
      .catch(err => setError((err as Error).message))
      .finally(() => setOpsLoading(false));
  }, [form.probe_type, form.device_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...form };
      if (payload.probe_type === 'icmp') {
        payload.device_id = null;
        payload.ipsla_oper_index = null;
        payload.ipsla_oper_type = null;
      }
      if (editingId) {
        await api.updateTarget(editingId, payload);
      } else {
        await api.createTarget(payload);
      }
      setForm({ ...emptyForm, group_id: form.group_id });
      setEditingId(null);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleEdit = (t: Target) => {
    setEditingId(t.id);
    setForm({
      group_id: t.group_id, name: t.name, host: t.host, site_code: t.site_code || '',
      probe_interval: t.probe_interval, probe_count: t.probe_count, enabled: t.enabled,
      probe_type: t.probe_type || 'icmp',
      device_id: t.device_id,
      ipsla_oper_index: t.ipsla_oper_index,
      ipsla_oper_type: t.ipsla_oper_type,
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this target and all its measurements?')) return;
    await api.deleteTarget(id);
    void load();
  };

  const groupMap = new Map(groups.map(g => [g.id, g.name]));
  const deviceMap = new Map(devices.map(d => [d.id, d.name]));

  const isCisco = form.probe_type === 'cisco-ipsla';
  const opsForDevice = (form.device_id ? opsByDevice[form.device_id] : null) || [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0, color: 'var(--text)' }}>Targets</h1>
        <CsvIO
          exportUrl={api.exportTargetsCsvUrl()}
          exportFilename="targets.csv"
          onImport={api.importTargetsCsv}
          onImported={load}
        />
      </div>

      {groups.length === 0 && (
        <div style={{
          padding: 16, background: 'rgba(234,179,8,0.12)',
          border: '1px solid rgba(234,179,8,0.4)', color: 'var(--text)',
          borderRadius: 8, marginBottom: 16, fontSize: 13,
        }}>
          Please <a href="/groups" style={{ color: 'var(--accent)' }}>create a group</a> first before adding targets.
        </div>
      )}

      <form onSubmit={handleSubmit} style={cardStyle}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
          {editingId ? 'Edit target' : 'Add a target'}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 150px 80px 80px', gap: 10, alignItems: 'end' }}>
          <Field label="Group">
            <select style={input} value={form.group_id} onChange={e => setForm({ ...form, group_id: e.target.value })} required>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="Name">
            <input style={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Site Code">
            <input style={input} value={form.site_code} onChange={e => setForm({ ...form, site_code: e.target.value })} placeholder="DUB01" />
          </Field>
          <Field label="Interval (s)">
            <input type="number" style={input} value={form.probe_interval} onChange={e => setForm({ ...form, probe_interval: +e.target.value })} />
          </Field>
          <Field label="Pings">
            <input type="number" style={input} value={form.probe_count} onChange={e => setForm({ ...form, probe_count: +e.target.value })} />
          </Field>
        </div>

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)', display: 'grid', gridTemplateColumns: '180px 1fr 220px 160px', gap: 10, alignItems: 'end' }}>
          <Field label="Probe source">
            <select
              style={input}
              value={form.probe_type}
              onChange={e => setForm({
                ...form,
                probe_type: e.target.value as ProbeType,
                device_id: e.target.value === 'cisco-ipsla' ? (devices[0]?.id ?? null) : null,
                ipsla_oper_index: null,
                ipsla_oper_type: null,
              })}
            >
              <option value="icmp">ICMP (local probe)</option>
              <option value="cisco-ipsla">Cisco IP SLA (device)</option>
            </select>
          </Field>

          {!isCisco ? (
            <>
              <Field label="Host (IP / hostname)">
                <input style={input} value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} required placeholder="8.8.8.8" />
              </Field>
              <div /><div />
            </>
          ) : (
            <>
              <Field label="Cisco device" hint={devices.length === 0 ? 'Add a device on the Cisco devices page first' : undefined}>
                <select
                  style={input}
                  value={form.device_id || ''}
                  required
                  onChange={e => setForm({ ...form, device_id: e.target.value, ipsla_oper_index: null, ipsla_oper_type: null })}
                >
                  <option value="" disabled>Select…</option>
                  {devices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.host})</option>)}
                </select>
              </Field>
              <Field label="Operation" hint={opsLoading ? 'Discovering…' : undefined}>
                <select
                  style={input}
                  value={form.ipsla_oper_index != null ? String(form.ipsla_oper_index) : ''}
                  required
                  onChange={e => {
                    const idx = parseInt(e.target.value, 10);
                    const op = opsForDevice.find(o => o.index === idx);
                    setForm({
                      ...form,
                      ipsla_oper_index: Number.isFinite(idx) ? idx : null,
                      ipsla_oper_type: op?.kind && op.kind !== 'unsupported' ? op.kind : null,
                      host: op?.target || form.host || 'cisco-ipsla',
                      name: form.name || op?.tag || (op ? `op-${op.index}` : ''),
                    });
                  }}
                >
                  <option value="" disabled>Select…</option>
                  {opsForDevice.map(o => (
                    <option key={o.index} value={o.index} disabled={o.kind === 'unsupported'}>
                      #{o.index} · {o.tag || '(no tag)'} · {o.kind}{o.target ? ` → ${o.target}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <div /></>
          )}
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="submit" style={{ ...btnStyle, background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            {editingId ? 'Update' : 'Add Target'}
          </button>
          {editingId && (
            <button type="button" style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)' }}
              onClick={() => { setEditingId(null); setForm({ ...emptyForm, group_id: form.group_id }); }}>
              Cancel
            </button>
          )}
        </div>
        {error && <div style={{ color: '#dc2626', marginTop: 8, fontSize: 13 }}>{error}</div>}
      </form>

      <table style={tableStyle}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={th}>Name</th>
            <th style={th}>Source</th>
            <th style={th}>Host / Operation</th>
            <th style={th}>Group</th>
            <th style={{ ...th, textAlign: 'right' }}>Interval</th>
            <th style={{ ...th, textAlign: 'center' }}>Enabled</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {targets.map(t => (
            <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ ...td, fontWeight: 600 }}>
                <a href={`/targets/${t.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{t.name}</a>
              </td>
              <td style={td}>
                {t.probe_type === 'cisco-ipsla' ? (
                  <span title="Cisco IP SLA via SNMP" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0ea5e9' }} />
                    cisco-ipsla
                  </span>
                ) : 'icmp'}
              </td>
              <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                {t.probe_type === 'cisco-ipsla'
                  ? `${deviceMap.get(t.device_id || '') || '?'} · op #${t.ipsla_oper_index} (${t.ipsla_oper_type})`
                  : t.host}
              </td>
              <td style={td}>{groupMap.get(t.group_id) || '?'}</td>
              <td style={{ ...td, textAlign: 'right' }}>{t.probe_interval}s</td>
              <td style={{ ...td, textAlign: 'center' }}>{t.enabled ? 'Yes' : 'No'}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                <button onClick={() => handleEdit(t)} style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)', marginRight: 4, fontSize: 12 }}>Edit</button>
                <button onClick={() => handleDelete(t.id)} style={{ ...btnStyle, background: '#fee', color: '#dc2626', fontSize: 12 }}>Delete</button>
              </td>
            </tr>
          ))}
          {targets.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>No targets yet. Add one above.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const input: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13,
  background: 'var(--bg-card)', color: 'var(--text)', width: '100%', boxSizing: 'border-box',
};
const btnStyle: React.CSSProperties = { padding: '6px 16px', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 };
const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text)', padding: 20, borderRadius: 8,
  marginBottom: 24, boxShadow: 'var(--shadow)', border: '1px solid var(--border)',
};
const th: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontSize: 13, color: 'var(--text)', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px 16px', color: 'var(--text)' };
const tableStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-card)', color: 'var(--text)',
  borderRadius: 8, boxShadow: 'var(--shadow)', border: '1px solid var(--border)', borderCollapse: 'collapse',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

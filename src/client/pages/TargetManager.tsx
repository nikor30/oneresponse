import React, { useEffect, useMemo, useState } from 'react';
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
  const [tab, setTab] = useState<ProbeType>('icmp');
  const [targets, setTargets] = useState<Target[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [devices, setDevices] = useState<CiscoDevice[]>([]);
  const [opsByDevice, setOpsByDevice] = useState<Record<string, DiscoveredOperation[]>>({});
  const [opsLoading, setOpsLoading] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Multi-select state — set of target ids ticked in the current tab's table.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkGroup, setBulkGroup] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // Free-text filter across name / host / site code / group name.
  const [q, setQ] = useState('');

  // Targets visible in the active tab (search filter applied).
  const visibleTargets = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const nameOf = new Map(groups.map(g => [g.id, g.name]));
    return targets.filter(t => {
      if ((t.probe_type || 'icmp') !== tab) return false;
      if (!needle) return true;
      const hay = `${t.name} ${t.host} ${t.site_code || ''} ${nameOf.get(t.group_id) || ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [targets, tab, q, groups]);

  const isCisco = tab === 'cisco-ipsla';

  const resetForm = (nextTab: ProbeType = tab) => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      group_id: form.group_id || (groups[0]?.id ?? ''),
      probe_type: nextTab,
      device_id: nextTab === 'cisco-ipsla' ? (devices[0]?.id ?? null) : null,
    });
  };

  const switchTab = (next: ProbeType) => {
    if (next === tab) return;
    setTab(next);
    setSelected(new Set());
    setError('');
    resetForm(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...form, probe_type: tab };
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
      resetForm();
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleEdit = (t: Target) => {
    const tType = (t.probe_type || 'icmp') as ProbeType;
    if (tType !== tab) setTab(tType);
    setEditingId(t.id);
    setForm({
      group_id: t.group_id, name: t.name, host: t.host, site_code: t.site_code || '',
      probe_interval: t.probe_interval, probe_count: t.probe_count, enabled: t.enabled,
      probe_type: tType,
      device_id: t.device_id,
      ipsla_oper_index: t.ipsla_oper_index,
      ipsla_oper_type: t.ipsla_oper_type,
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this target and all its measurements?')) return;
    await api.deleteTarget(id);
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    void load();
  };

  // --- multi-select helpers ---------------------------------------------
  const allVisibleSelected = visibleTargets.length > 0 && visibleTargets.every(t => selected.has(t.id));
  const toggleOne = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleAll = () => setSelected(prev => {
    if (visibleTargets.every(t => prev.has(t.id))) return new Set();
    return new Set(visibleTargets.map(t => t.id));
  });

  const selectedIds = useMemo(
    () => visibleTargets.filter(t => selected.has(t.id)).map(t => t.id),
    [visibleTargets, selected]
  );

  const runBulk = async (fn: () => Promise<unknown>) => {
    setBulkBusy(true);
    setError('');
    try {
      await fn();
      setSelected(new Set());
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkEnable = (enabled: number) => runBulk(() => api.bulkUpdateTargets(selectedIds, { enabled }));
  const bulkMove = () => {
    if (!bulkGroup) return;
    return runBulk(() => api.bulkUpdateTargets(selectedIds, { group_id: bulkGroup }));
  };
  const bulkDelete = () => {
    if (!confirm(`Delete ${selectedIds.length} target(s) and all their measurements?`)) return;
    return runBulk(() => api.bulkDeleteTargets(selectedIds));
  };

  const groupMap = new Map(groups.map(g => [g.id, g.name]));
  const deviceMap = new Map(devices.map(d => [d.id, d.name]));
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

      {/* Tabs: local ICMP probes vs Cisco IP SLA device operations */}
      <div role="tablist" style={tabBar}>
        <TabButton active={tab === 'icmp'} onClick={() => switchTab('icmp')}>
          Local (ICMP) <Count n={targets.filter(t => (t.probe_type || 'icmp') === 'icmp').length} />
        </TabButton>
        <TabButton active={tab === 'cisco-ipsla'} onClick={() => switchTab('cisco-ipsla')} accent="#06b6d4">
          IP SLA (Cisco) <Count n={targets.filter(t => t.probe_type === 'cisco-ipsla').length} />
        </TabButton>
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

      {isCisco && devices.length === 0 && (
        <div style={{
          padding: 16, background: 'rgba(6,182,212,0.10)',
          border: '1px solid rgba(6,182,212,0.4)', color: 'var(--text)',
          borderRadius: 8, marginBottom: 16, fontSize: 13,
        }}>
          Add a <a href="/devices" style={{ color: 'var(--accent)' }}>Cisco device</a> first, then its IP SLA operations can be added here.
        </div>
      )}

      <form onSubmit={handleSubmit} style={cardStyle}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
          {editingId ? 'Edit target' : isCisco ? 'Add an IP SLA target' : 'Add a local target'}
        </div>

        <div style={formGrid}>
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

          {!isCisco ? (
            <Field label="Host (IP / hostname)">
              <input style={input} value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} required placeholder="8.8.8.8" />
            </Field>
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
            </>
          )}
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="submit" style={{ ...btnStyle, background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            {editingId ? 'Update' : isCisco ? 'Add IP SLA Target' : 'Add Target'}
          </button>
          {editingId && (
            <button type="button" style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)' }}
              onClick={() => resetForm()}>
              Cancel
            </button>
          )}
        </div>
        {error && <div style={{ color: 'var(--crit)', marginTop: 8, fontSize: 13 }}>{error}</div>}
      </form>

      {/* Search filter for the table below */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          style={{ ...input, maxWidth: 280 }}
          placeholder="Filter by name, host, site, group…"
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Filter targets"
        />
        {q && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {visibleTargets.length} match{visibleTargets.length === 1 ? '' : 'es'}
          </span>
        )}
      </div>

      {/* Bulk action bar — only visible when rows are selected */}
      {selectedIds.length > 0 && (
        <div style={bulkBar}>
          <strong style={{ fontSize: 13 }}>{selectedIds.length} selected</strong>
          <button disabled={bulkBusy} style={bulkBtn} onClick={() => bulkEnable(1)}>Enable</button>
          <button disabled={bulkBusy} style={bulkBtn} onClick={() => bulkEnable(0)}>Disable</button>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <select style={{ ...input, width: 'auto', minWidth: 130 }} value={bulkGroup} onChange={e => setBulkGroup(e.target.value)}>
              <option value="">Move to group…</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button disabled={bulkBusy || !bulkGroup} style={bulkBtn} onClick={bulkMove}>Apply</button>
          </span>
          <button disabled={bulkBusy} style={{ ...bulkBtn, background: 'var(--crit-bg)', color: 'var(--crit)', borderColor: 'rgba(220,38,38,0.3)' }} onClick={bulkDelete}>
            Delete selected
          </button>
          <button disabled={bulkBusy} style={{ ...bulkBtn, marginLeft: 'auto' }} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="or-table-wrap" style={{ borderRadius: 8, boxShadow: 'var(--shadow)', border: '1px solid var(--border)' }}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ ...th, width: 36 }}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th style={th}>Name</th>
              <th style={th}>{isCisco ? 'Device / Operation' : 'Host'}</th>
              <th style={th}>Group</th>
              <th style={{ ...th, textAlign: 'right' }}>Interval</th>
              <th style={{ ...th, textAlign: 'center' }}>Enabled</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleTargets.map(t => {
              const checked = selected.has(t.id);
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', background: checked ? 'var(--bg-hover)' : undefined }}>
                  <td style={td}>
                    <input type="checkbox" checked={checked} onChange={() => toggleOne(t.id)} aria-label={`Select ${t.name}`} />
                  </td>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <a href={`/targets/${t.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{t.name}</a>
                    {t.site_code && <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 6, fontSize: 12 }}>{t.site_code}</span>}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                    {isCisco
                      ? `${deviceMap.get(t.device_id || '') || '?'} · op #${t.ipsla_oper_index} (${t.ipsla_oper_type})`
                      : t.host}
                  </td>
                  <td style={td}>{groupMap.get(t.group_id) || '?'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{t.probe_interval}s</td>
                  <td style={{ ...td, textAlign: 'center' }}>{t.enabled ? 'Yes' : 'No'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => handleEdit(t)} style={{ ...btnStyle, background: 'var(--bg-hover)', color: 'var(--text)', marginRight: 4, fontSize: 12 }}>Edit</button>
                    <button onClick={() => handleDelete(t.id)} style={{ ...btnStyle, background: 'var(--crit-bg)', color: 'var(--crit)', fontSize: 12 }}>Delete</button>
                  </td>
                </tr>
              );
            })}
            {visibleTargets.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>
                No {isCisco ? 'IP SLA' : 'local'} targets yet. Add one above.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
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
  borderCollapse: 'collapse', minWidth: 640,
};
// Responsive form grid — columns flow and wrap instead of fixed px widths,
// so the form stays usable from phone to widescreen.
const formGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 10,
  alignItems: 'end',
};
const tabBar: React.CSSProperties = {
  display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)',
  flexWrap: 'wrap',
};
const bulkBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '10px 14px', marginBottom: 12, boxShadow: 'var(--shadow)',
};
const bulkBtn: React.CSSProperties = {
  padding: '5px 12px', border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--bg-hover)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
};

function TabButton({ active, accent, onClick, children }: { active: boolean; accent?: string; onClick: () => void; children: React.ReactNode }) {
  const color = accent || 'var(--accent)';
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '10px 18px',
        border: 'none',
        borderBottom: `3px solid ${active ? color : 'transparent'}`,
        background: 'transparent',
        color: active ? 'var(--text)' : 'var(--text-muted)',
        fontSize: 14,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span style={{
      marginLeft: 6, fontSize: 11, fontWeight: 700, padding: '1px 7px',
      borderRadius: 10, background: 'var(--bg-hover)', color: 'var(--text-muted)',
    }}>{n}</span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

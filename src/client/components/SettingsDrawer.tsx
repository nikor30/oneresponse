import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../theme/ThemeContext';
import { api, type Group } from '../api/client';

interface Props {
  open: boolean;
  onClose: () => void;
}

const NAV = [
  { path: '/targets', label: 'Targets', icon: '🎯' },
  { path: '/groups',  label: 'Groups',  icon: '🗂' },
  { path: '/peers',   label: 'Peers',   icon: '🌐' },
];

export default function SettingsDrawer({ open, onClose }: Props) {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Group>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string>('');
  const [siteNameSaved, setSiteNameSaved] = useState<string>('');
  const [siteSaving, setSiteSaving] = useState(false);
  const [showLabels, setShowLabels] = useState(true);

  useEffect(() => {
    if (!open) return;
    api.getGroups().then(setGroups).catch(e => setErr(e.message));
    api.getSettings()
      .then(s => {
        const v = s.site_name || 'oneresponse';
        setSiteName(v);
        setSiteNameSaved(v);
        setShowLabels(s.show_target_labels !== 'false');
      })
      .catch(() => { /* ignore */ });
  }, [open]);

  const saveSiteName = async () => {
    const v = siteName.trim() || 'oneresponse';
    setSiteSaving(true);
    try {
      const updated = await api.updateSettings({ site_name: v });
      setSiteNameSaved(updated.site_name || v);
      setSiteName(updated.site_name || v);
      // Notify the dashboard so the heading updates without a reload
      window.dispatchEvent(new CustomEvent('oneresponse:settings-changed', { detail: updated }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSiteSaving(false);
    }
  };

  const toggleShowLabels = async () => {
    const next = !showLabels;
    setShowLabels(next);
    try {
      const updated = await api.updateSettings({ show_target_labels: next ? 'true' : 'false' });
      window.dispatchEvent(new CustomEvent('oneresponse:settings-changed', { detail: updated }));
    } catch (e) {
      setErr((e as Error).message);
      // Roll back optimistic state
      setShowLabels(!next);
    }
  };

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const updateEdit = (gid: string, patch: Partial<Group>) => {
    setEdits(prev => ({ ...prev, [gid]: { ...prev[gid], ...patch } }));
  };

  // Number value with fallback. Treats undefined/null as "use group's
  // current value" so the user can clear an override by typing empty.
  const valueFor = (g: Group, key: keyof Group): number | null => {
    const edit = edits[g.id];
    if (edit && key in edit) return (edit[key] as number | null) ?? null;
    return (g[key] as number | null) ?? null;
  };

  const isDirty = (g: Group): boolean => {
    const edit = edits[g.id];
    if (!edit) return false;
    return (['sla_latency_ms', 'sla_jitter_ms', 'sla_loss_pct', 'viz_latency_min', 'viz_latency_max'] as const).some(
      k => k in edit && edit[k] !== g[k]
    );
  };

  const saveGroup = async (g: Group) => {
    const edit = edits[g.id];
    if (!edit) return;
    setSavingId(g.id);
    setErr(null);
    try {
      const updated = await api.updateGroup(g.id, edit);
      setGroups(gs => gs.map(x => x.id === g.id ? updated : x));
      setEdits(prev => { const c = { ...prev }; delete c[g.id]; return c; });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const cardBg = 'var(--bg-card)';
  const border = 'var(--border)';
  const muted = 'var(--text-muted)';

  return (
    <>
      <div
        className={`drawer-backdrop ${open ? 'open' : ''}`}
        onClick={onClose}
      />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: `1px solid ${border}`,
          position: 'sticky',
          top: 0,
          background: cardBg,
          zIndex: 1,
        }}>
          <strong style={{ fontSize: 15 }}>Menu</strong>
          <button
            onClick={onClose}
            aria-label="Close menu"
            style={{
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
              fontSize: 22,
              color: muted,
              lineHeight: 1,
              padding: 4,
            }}
          >×</button>
        </header>

        <div style={{ padding: '14px 18px' }}>
          <SectionTitle>Navigation</SectionTitle>
          {NAV.map(n => (
            <NavRow key={n.path} onClick={() => { navigate(n.path); onClose(); }}>
              <span style={{ marginRight: 10 }}>{n.icon}</span> {n.label}
            </NavRow>
          ))}

          <SectionTitle style={{ marginTop: 20 }}>This instance</SectionTitle>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: muted, marginBottom: 4 }}>
              Name shown above the dashboard
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={siteName}
                onChange={e => setSiteName(e.target.value)}
                placeholder="e.g. Europe Peer"
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  background: 'var(--bg-page)',
                  color: 'var(--text)',
                  border: `1px solid ${border}`,
                  borderRadius: 4,
                  fontSize: 13,
                }}
              />
              <button
                onClick={saveSiteName}
                disabled={siteSaving || siteName.trim() === siteNameSaved}
                style={{
                  padding: '4px 12px',
                  background: 'var(--accent)',
                  color: 'var(--accent-fg)',
                  border: 0,
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: siteName.trim() === siteNameSaved ? 'default' : 'pointer',
                  opacity: siteName.trim() === siteNameSaved ? 0.5 : 1,
                }}
              >
                {siteSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
              Use a name that distinguishes this node when you have multiple peers.
            </div>
          </div>

          <SectionTitle style={{ marginTop: 20 }}>Appearance</SectionTitle>
          <div style={{ display: 'flex', gap: 6 }}>
            <ThemeChip active={theme === 'light'} onClick={() => setTheme('light')}>☀ Light</ThemeChip>
            <ThemeChip active={theme === 'dark'}  onClick={() => setTheme('dark')}>🌙 Dark</ThemeChip>
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>Show target labels</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Floating name + ms pills next to each dot</div>
            </div>
            <Toggle checked={showLabels} onChange={toggleShowLabels} />
          </div>

          <SectionTitle style={{ marginTop: 20 }}>
            Per-group thresholds & chart range
            <Link to="/groups" onClick={onClose} style={{ float: 'right', fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
              Manage all →
            </Link>
          </SectionTitle>

          {err && (
            <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{err}</div>
          )}
          {groups.length === 0 && (
            <div style={{ color: muted, fontSize: 12 }}>No groups yet.</div>
          )}
          {groups.map(g => (
            <div key={g.id} style={{
              border: `1px solid ${border}`,
              borderRadius: 8,
              padding: 10,
              marginBottom: 8,
              background: cardBg,
            }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{g.name}</div>
              <Field label="Latency (ms)">
                <NumInput
                  value={valueFor(g, 'sla_latency_ms')}
                  onChange={v => updateEdit(g.id, { sla_latency_ms: v })}
                />
              </Field>
              <Field label="Jitter (ms)">
                <NumInput
                  value={valueFor(g, 'sla_jitter_ms')}
                  onChange={v => updateEdit(g.id, { sla_jitter_ms: v })}
                />
              </Field>
              <Field label="Loss (%)">
                <NumInput
                  step={0.1}
                  value={valueFor(g, 'sla_loss_pct')}
                  onChange={v => updateEdit(g.id, { sla_loss_pct: v })}
                />
              </Field>

              <div style={{
                marginTop: 8, paddingTop: 6,
                borderTop: `1px dashed ${border}`,
                fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700,
              }}>
                Chart range (visualization only)
              </div>
              <Field label="Center value (ms)">
                <NumInput
                  value={valueFor(g, 'viz_latency_min')}
                  placeholder="0"
                  allowClear
                  onChange={v => updateEdit(g.id, { viz_latency_min: v })}
                />
              </Field>
              <Field label="Edge value (ms)">
                <NumInput
                  value={valueFor(g, 'viz_latency_max')}
                  placeholder={`${(g.sla_latency_ms ?? 100) * 3}`}
                  allowClear
                  onChange={v => updateEdit(g.id, { viz_latency_max: v })}
                />
              </Field>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                Empty = default (0 → 3× SLA latency)
              </div>

              {isDirty(g) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    onClick={() => saveGroup(g)}
                    disabled={savingId === g.id}
                    style={{
                      padding: '4px 12px',
                      background: 'var(--accent)',
                      color: 'var(--accent-fg)',
                      border: 0,
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {savingId === g.id ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEdits(p => { const c = { ...p }; delete c[g.id]; return c; })}
                    style={{
                      padding: '4px 12px',
                      background: 'transparent',
                      color: muted,
                      border: `1px solid ${border}`,
                      borderRadius: 4,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

function SectionTitle({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: 'var(--text-dim)',
      marginBottom: 8,
      ...style,
    }}>
      {children}
    </div>
  );
}

function NavRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        padding: '8px 10px',
        background: 'transparent',
        border: 0,
        color: 'var(--text)',
        fontSize: 14,
        cursor: 'pointer',
        borderRadius: 6,
        textAlign: 'left',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  );
}

function ThemeChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '6px 10px',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--accent-fg)' : 'var(--text)',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >{children}</button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <span>{children}</span>
    </label>
  );
}

function NumInput({
  value, onChange, step, placeholder, allowClear,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  placeholder?: string;
  // When true, empty string emits null (clearing the override).
  // When false, empty becomes 0.
  allowClear?: boolean;
}) {
  return (
    <input
      type="number"
      step={step}
      placeholder={placeholder}
      value={value == null || !Number.isFinite(value) ? '' : value}
      onChange={e => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(allowClear ? null : 0);
        } else {
          const parsed = parseFloat(raw);
          onChange(Number.isFinite(parsed) ? parsed : (allowClear ? null : 0));
        }
      }}
      style={{
        width: 80,
        padding: '4px 8px',
        background: 'var(--bg-page)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        fontSize: 12,
        textAlign: 'right',
      }}
    />
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        width: 38,
        height: 22,
        borderRadius: 999,
        border: 0,
        padding: 2,
        background: checked ? 'var(--accent)' : 'var(--border)',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.15s ease',
        flexShrink: 0,
      }}
    >
      <span style={{
        display: 'block',
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: '#fff',
        transform: `translateX(${checked ? 16 : 0}px)`,
        transition: 'transform 0.15s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      }} />
    </button>
  );
}

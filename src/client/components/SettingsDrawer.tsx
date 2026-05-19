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

  useEffect(() => {
    if (!open) return;
    api.getGroups().then(setGroups).catch(e => setErr(e.message));
  }, [open]);

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

  const valueFor = (g: Group, key: keyof Group): number => {
    const edit = edits[g.id];
    if (edit && edit[key] != null) return edit[key] as number;
    return g[key] as number;
  };

  const isDirty = (g: Group): boolean => {
    const edit = edits[g.id];
    if (!edit) return false;
    return (['sla_latency_ms', 'sla_jitter_ms', 'sla_loss_pct'] as const).some(
      k => edit[k] != null && edit[k] !== g[k]
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

          <SectionTitle style={{ marginTop: 20 }}>Appearance</SectionTitle>
          <div style={{ display: 'flex', gap: 6 }}>
            <ThemeChip active={theme === 'light'} onClick={() => setTheme('light')}>☀ Light</ThemeChip>
            <ThemeChip active={theme === 'dark'}  onClick={() => setTheme('dark')}>🌙 Dark</ThemeChip>
          </div>

          <SectionTitle style={{ marginTop: 20 }}>
            SLA thresholds
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
  value, onChange, step,
}: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
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

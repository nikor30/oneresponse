import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../theme/ThemeContext';
import { api } from '../api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  // Whether the viewer is allowed to edit admin-only pages. Guests get
  // a stripped-down menu without targets/groups/peers/settings.
  canEdit: boolean;
}

const NAV_PUBLIC = [
  { path: '/',    label: 'Dashboard', icon: '◎' },
  { path: '/top', label: 'Top 10',    icon: '★' },
];
const NAV_ADMIN = [
  { path: '/targets',  label: 'Targets',      icon: '🎯' },
  { path: '/groups',   label: 'Groups & SLA', icon: '🗂' },
  { path: '/peers',    label: 'Peers',        icon: '🌐' },
  { path: '/settings', label: 'Settings',     icon: '⚙' },
];

export default function SettingsDrawer({ open, onClose, canEdit }: Props) {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string>('');
  const [siteNameSaved, setSiteNameSaved] = useState<string>('');
  const [siteSaving, setSiteSaving] = useState(false);
  const [showLabels, setShowLabels] = useState(() => {
    try {
      const v = localStorage.getItem('oneresponse.show_target_labels');
      if (v === 'false') return false;
    } catch { /* ignore */ }
    return true;
  });

  useEffect(() => {
    if (!open) return;
    api.getSettings()
      .then(s => {
        const v = s.site_name || 'oneresponse';
        setSiteName(v);
        setSiteNameSaved(v);
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
      window.dispatchEvent(new CustomEvent('oneresponse:settings-changed', { detail: updated }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSiteSaving(false);
    }
  };

  // show_target_labels is per-browser (localStorage) so guests and
  // admins alike can toggle it without affecting other viewers and
  // without needing edit rights on the server.
  const toggleShowLabels = () => {
    const next = !showLabels;
    setShowLabels(next);
    try { localStorage.setItem('oneresponse.show_target_labels', next ? 'true' : 'false'); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('oneresponse:labels-changed', { detail: { show_target_labels: next } }));
  };

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

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
          background: 'var(--bg-card)',
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
          {NAV_PUBLIC.map(n => (
            <NavRow key={n.path} onClick={() => { navigate(n.path); onClose(); }}>
              <span style={{ marginRight: 10 }}>{n.icon}</span> {n.label}
            </NavRow>
          ))}
          {canEdit && NAV_ADMIN.map(n => (
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

          <SectionTitle style={{ marginTop: 24 }}>SLA & chart range</SectionTitle>
          <div style={{
            fontSize: 12,
            color: muted,
            background: 'var(--bg-page)',
            border: `1px solid ${border}`,
            borderRadius: 6,
            padding: '10px 12px',
            lineHeight: 1.5,
          }}>
            Per-group SLA thresholds and the chart's visualization range
            (center / edge values) are edited inline on the{' '}
            <button
              onClick={() => { navigate('/groups'); onClose(); }}
              style={{
                background: 'transparent',
                border: 0,
                padding: 0,
                color: 'var(--accent)',
                cursor: 'pointer',
                textDecoration: 'underline',
                fontSize: 12,
                fontWeight: 600,
              }}
            >Groups page</button>
            {' '}so each group can be tuned alongside its other settings.
          </div>

          {err && (
            <div style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{err}</div>
          )}
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

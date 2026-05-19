import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface Props {
  open: boolean;
  onClose: () => void;
  // When the system is in pre-setup state we render the modal as a
  // first-run wizard instead of a login form.
  setupMode?: boolean;
}

export default function LoginModal({ open, onClose, setupMode }: Props) {
  const { login, refresh } = useAuth();
  const [username, setUsername] = useState(setupMode ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUsername(setupMode ? 'admin' : '');
      setPassword('');
      setConfirm('');
      setError(null);
    }
  }, [open, setupMode]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (setupMode) {
        if (password.length < 8) throw new Error('Password must be at least 8 characters');
        if (password !== confirm) throw new Error('Passwords do not match');
        await api.setupAdmin(username.trim(), password);
        await refresh();
      } else {
        await login(username.trim(), password);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15,23,42,0.55)',
          backdropFilter: 'blur(4px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
          zIndex: 200,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${open ? 1 : 0.96})`,
          opacity: open ? 1 : 0,
          width: 'min(94vw, 380px)',
          background: 'var(--bg-card)',
          color: 'var(--text)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.45), 0 0 0 1px var(--border)',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
          pointerEvents: open ? 'auto' : 'none',
          zIndex: 201,
          padding: 24,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          {setupMode ? 'Create admin account' : 'Sign in'}
        </h2>
        <p style={{ margin: 0, marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          {setupMode
            ? 'Set up the single admin user. Without this, anyone can edit targets and peers.'
            : 'Admin login is required to edit targets, groups, peers and settings.'}
        </p>

        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            Username
          </label>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            required
            style={inputStyle}
          />

          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 4 }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={setupMode ? 'new-password' : 'current-password'}
            required
            style={inputStyle}
          />

          {setupMode && (
            <>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 4 }}>
                Confirm password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                style={inputStyle}
              />
            </>
          )}

          {error && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 10 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="submit"
              disabled={busy}
              style={{
                flex: 1,
                padding: '8px 14px',
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                border: 0,
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? (setupMode ? 'Creating…' : 'Signing in…') : (setupMode ? 'Create' : 'Sign in')}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-page)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
};

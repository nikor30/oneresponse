import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import LoginModal from './LoginModal';

// Wraps an admin-only page. Renders a friendly "Sign in to manage…"
// panel for guests instead of the protected UI.
export default function AdminGate({ what, children }: { what: string; children: React.ReactNode }) {
  const { canEdit, status, loading } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>Loading…</div>;
  }

  if (canEdit) return <>{children}</>;

  return (
    <>
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 28,
        textAlign: 'center',
        maxWidth: 540,
        margin: '60px auto',
        color: 'var(--text)',
        boxShadow: 'var(--shadow)',
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Admin sign-in required</h2>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0 16px', fontSize: 13, lineHeight: 1.5 }}>
          Sign in as an admin to manage {what}.
          Guests can still view the dashboard, target graphs, and the Top 10 rankings.
        </p>
        <button
          onClick={() => setLoginOpen(true)}
          style={{
            padding: '8px 18px',
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            border: 0,
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sign in
        </button>
      </div>
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        setupMode={!status.admin_required}
      />
    </>
  );
}

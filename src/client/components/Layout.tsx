import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SettingsDrawer from './SettingsDrawer';

const styles = {
  header: {
    background: 'var(--bg-header)',
    color: '#fff',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 56,
    gap: 32,
  } as React.CSSProperties,
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
  } as React.CSSProperties,
  logo: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--accent)',
    textDecoration: 'none',
  } as React.CSSProperties,
  dashLink: (active: boolean) => ({
    color: active ? 'var(--accent)' : '#ccc',
    textDecoration: 'none',
    padding: '8px 14px',
    borderRadius: 4,
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    background: active ? 'rgba(233,69,96,0.12)' : 'transparent',
  }) as React.CSSProperties,
  burger: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)',
    color: '#fff',
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 18,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as React.CSSProperties,
  main: {
    padding: 24,
    maxWidth: 1400,
    margin: '0 auto',
  } as React.CSSProperties,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <header style={styles.header}>
        <div style={styles.left}>
          <Link to="/" style={styles.logo}>oneresponse</Link>
          <Link to="/" style={styles.dashLink(location.pathname === '/')}>
            Dashboard
          </Link>
        </div>
        <button
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
          style={styles.burger}
        >
          <BurgerIcon />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Menu</span>
        </button>
      </header>
      <main style={styles.main}>{children}</main>
      <SettingsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}

function BurgerIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
      <rect x="0" y="0" width="18" height="2" rx="1" fill="currentColor" />
      <rect x="0" y="6" width="18" height="2" rx="1" fill="currentColor" />
      <rect x="0" y="12" width="18" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

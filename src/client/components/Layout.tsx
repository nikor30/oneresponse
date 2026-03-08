import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/targets', label: 'Targets' },
  { path: '/groups', label: 'Groups' },
  { path: '/peers', label: 'Peers' },
];

const styles = {
  header: {
    background: '#1a1a2e',
    color: '#fff',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    height: 56,
    gap: 32,
  } as React.CSSProperties,
  logo: {
    fontSize: 20,
    fontWeight: 700,
    color: '#e94560',
    textDecoration: 'none',
  } as React.CSSProperties,
  nav: {
    display: 'flex',
    gap: 4,
  } as React.CSSProperties,
  navLink: (active: boolean) => ({
    color: active ? '#e94560' : '#ccc',
    textDecoration: 'none',
    padding: '8px 16px',
    borderRadius: 4,
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    background: active ? 'rgba(233,69,96,0.1)' : 'transparent',
  }) as React.CSSProperties,
  main: {
    padding: 24,
    maxWidth: 1400,
    margin: '0 auto',
  } as React.CSSProperties,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <>
      <header style={styles.header}>
        <Link to="/" style={styles.logo}>oneresponse</Link>
        <nav style={styles.nav}>
          {NAV_ITEMS.map(item => (
            <Link key={item.path} to={item.path} style={styles.navLink(location.pathname === item.path)}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main style={styles.main}>{children}</main>
    </>
  );
}

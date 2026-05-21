import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

// Admin-only settings page (gated in App.tsx via AdminGate).
// Three sections: admin account, host (DNS / domain / NTP), syslog.

export default function SettingsPage() {
  const { status, refresh } = useAuth();
  const [settings, setSettings] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = async () => {
    try {
      setSettings(await api.getSettings());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const flash = (msg: string) => {
    setOk(msg);
    window.clearTimeout((flash as unknown as { t?: number }).t);
    (flash as unknown as { t?: number }).t = window.setTimeout(() => setOk(null), 2200);
  };

  const save = async (patch: Record<string, string | null>) => {
    setErr(null);
    try {
      const updated = await api.updateSettings(patch);
      setSettings(updated);
      window.dispatchEvent(new CustomEvent('oneresponse:settings-changed', { detail: updated }));
      flash('Saved');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0, color: 'var(--text)' }}>Settings</h1>
        {ok && <span style={{ fontSize: 12, color: '#16a34a' }}>✓ {ok}</span>}
      </div>

      {err && <div style={cardError}>{err}</div>}

      <AdminSection
        loggedInUser={status.username}
        onChanged={refresh}
      />

      <HostSection settings={settings} save={save} />

      <BuildSection settings={settings} />

      <SyslogSection settings={settings} save={save} />

      <RetentionSection settings={settings} save={save} />
    </div>
  );
}

// ----------- Admin account -----------

function AdminSection({ loggedInUser, onChanged }: { loggedInUser: string | null; onChanged: () => void }) {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setOk(false);
    if (newPw.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (newPw !== confirm) { setErr('Passwords do not match'); return; }
    setBusy(true);
    try {
      await api.changePassword(currentPw, newPw);
      setOk(true);
      setCurrentPw(''); setNewPw(''); setConfirm('');
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Admin account">
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Signed in as <strong style={{ color: 'var(--text)' }}>{loggedInUser || '—'}</strong>.
        Change the admin password below. Guests (visitors without a session)
        can only view the dashboard and graphs and toggle the theme.
      </div>
      <form onSubmit={submit}>
        <Field label="Current password">
          <input type="password" autoComplete="current-password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} style={input} />
        </Field>
        <Field label="New password">
          <input type="password" autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)} style={input} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} style={input} />
        </Field>
        {err && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{err}</div>}
        {ok && <div style={{ color: '#16a34a', fontSize: 12, marginTop: 6 }}>✓ Password updated</div>}
        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy} style={primaryBtn(busy)}>
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </div>
      </form>
    </Section>
  );
}

// ----------- Host config -----------

function HostSection({ settings, save }: { settings: Record<string, string | null>; save: (p: Record<string, string | null>) => void }) {
  const [dnsServer, setDnsServer] = useState(settings.dns_server || '');
  const [domain, setDomain] = useState(settings.search_domain || '');
  const [ntp, setNtp] = useState(settings.ntp_server || '');
  const [defaultSnmpCommunity, setDefaultSnmpCommunity] = useState(settings.default_snmp_community || 'public');

  useEffect(() => {
    setDnsServer(settings.dns_server || '');
    setDomain(settings.search_domain || '');
    setNtp(settings.ntp_server || '');
    setDefaultSnmpCommunity(settings.default_snmp_community || 'public');
  }, [settings]);

  return (
    <Section
      title="Host"
      subtitle="DNS resolver and search domain are applied to hostname targets before they're handed to ping. NTP is informational — system clocks must be synced on the host running the container."
    >
      <Field label="DNS server" hint="IP of an external resolver, e.g. 192.168.1.1 or 1.1.1.1. Leave blank for the container's default.">
        <input value={dnsServer} onChange={e => setDnsServer(e.target.value)} placeholder="1.1.1.1" style={input} />
      </Field>
      <Field label="Search domain" hint="Appended to short hostnames (no dot). e.g. 'example.com' turns 'web1' into 'web1.example.com'.">
        <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="example.com" style={input} />
      </Field>
      <Field label="NTP server" hint="Stored for reference. Configure NTP on the host so all instances agree on time — the dashboard surfaces a drift warning when peers disagree.">
        <input value={ntp} onChange={e => setNtp(e.target.value)} placeholder="pool.ntp.org" style={input} />
      </Field>
      <Field label="Default SNMP community" hint="Used as fallback when adding SNMPv2c Cisco devices and no community is entered on the device form.">
        <input value={defaultSnmpCommunity} onChange={e => setDefaultSnmpCommunity(e.target.value)} placeholder="public" style={input} />
      </Field>

      <div style={{ marginTop: 10 }}>
        <button
          onClick={() => save({
            dns_server:    dnsServer.trim() || null,
            search_domain: domain.trim() || null,
            ntp_server:    ntp.trim() || null,
            default_snmp_community: defaultSnmpCommunity.trim() || null,
          })}
          style={primaryBtn(false)}
        >Save host settings</button>
      </div>
    </Section>
  );
}


function BuildSection({ settings }: { settings: Record<string, string | null> }) {
  return (
    <Section
      title="Build"
      subtitle="Runtime build information from the backend process."
    >
      <Field label="Version">
        <input value={settings.build_version || 'unknown'} readOnly style={{ ...input, opacity: 0.85 }} />
      </Field>
      <Field label="Commit" hint="Set APP_COMMIT (or GIT_COMMIT) env var during deployment to populate this field.">
        <input value={settings.build_commit || 'not set'} readOnly style={{ ...input, opacity: 0.85 }} />
      </Field>
    </Section>
  );
}

// ----------- Syslog -----------

function SyslogSection({ settings, save }: { settings: Record<string, string | null>; save: (p: Record<string, string | null>) => void }) {
  const [enabled, setEnabled] = useState(settings.syslog_enabled === 'true');
  const [host, setHost] = useState(settings.syslog_host || '');
  const [port, setPort] = useState(settings.syslog_port || '514');
  const [protocol, setProtocol] = useState(settings.syslog_protocol === 'tcp' ? 'tcp' : 'udp');
  const [facility, setFacility] = useState(settings.syslog_facility || '16');

  useEffect(() => {
    setEnabled(settings.syslog_enabled === 'true');
    setHost(settings.syslog_host || '');
    setPort(settings.syslog_port || '514');
    setProtocol(settings.syslog_protocol === 'tcp' ? 'tcp' : 'udp');
    setFacility(settings.syslog_facility || '16');
  }, [settings]);

  return (
    <Section
      title="SLA alarms via syslog"
      subtitle="Forward SLA breach and recovery events to a remote syslog server. Only state transitions emit (no spam every probe), so a long-running breach generates one alert."
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13 }}>
          Forwarding {enabled ? <span style={{ color: '#16a34a' }}>enabled</span> : <span style={{ color: 'var(--text-dim)' }}>disabled</span>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(v => !v)}
          style={{
            width: 38, height: 22, borderRadius: 999, border: 0, padding: 2,
            background: enabled ? 'var(--accent)' : 'var(--border)', cursor: 'pointer',
          }}
        >
          <span style={{
            display: 'block', width: 18, height: 18, borderRadius: '50%', background: '#fff',
            transform: `translateX(${enabled ? 16 : 0}px)`, transition: 'transform 0.15s ease',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          }} />
        </button>
      </div>

      <Field label="Server host" hint="Hostname or IP of your syslog collector (Splunk, Graylog, rsyslog, etc.)">
        <input value={host} onChange={e => setHost(e.target.value)} placeholder="logs.example.com" style={input} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="Port">
          <input value={port} onChange={e => setPort(e.target.value)} placeholder="514" style={input} />
        </Field>
        <Field label="Protocol">
          <select value={protocol} onChange={e => setProtocol(e.target.value)} style={input}>
            <option value="udp">UDP</option>
            <option value="tcp">TCP</option>
          </select>
        </Field>
        <Field label="Facility (0-23)" hint="16=local0">
          <input value={facility} onChange={e => setFacility(e.target.value)} placeholder="16" style={input} />
        </Field>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button
          onClick={() => save({
            syslog_enabled:  enabled ? 'true' : 'false',
            syslog_host:     host.trim() || null,
            syslog_port:     port.trim() || '514',
            syslog_protocol: protocol === 'tcp' ? 'tcp' : 'udp',
            syslog_facility: facility.trim() || '16',
          })}
          style={primaryBtn(false)}
        >Save syslog settings</button>
      </div>
    </Section>
  );
}

// ----------- Retention -----------

function RetentionSection({ settings, save }: { settings: Record<string, string | null>; save: (p: Record<string, string | null>) => void }) {
  const [rawDays, setRawDays] = useState(settings.retention_raw_days || '90');
  const [rttsDays, setRttsDays] = useState(settings.retention_rtts_days || '7');

  useEffect(() => {
    setRawDays(settings.retention_raw_days || '90');
    setRttsDays(settings.retention_rtts_days || '7');
  }, [settings]);

  return (
    <Section
      title="Data retention"
      subtitle="Older measurements are pruned automatically so the SQLite database stays bounded. Individual ping samples (rtts JSON) take ~50% of the row size and are only needed for fresh SmokePing graphs."
    >
      <Field label="Keep raw measurements for (days)">
        <input value={rawDays} onChange={e => setRawDays(e.target.value)} style={input} />
      </Field>
      <Field label="Keep individual ping samples for (days)" hint="Aggregated min/avg/max remain. Must be ≤ raw retention.">
        <input value={rttsDays} onChange={e => setRttsDays(e.target.value)} style={input} />
      </Field>
      <div style={{ marginTop: 10 }}>
        <button
          onClick={() => save({ retention_raw_days: rawDays || '90', retention_rtts_days: rttsDays || '7' })}
          style={primaryBtn(false)}
        >Save retention</button>
      </div>
    </Section>
  );
}

// ----------- Helpers -----------

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 20,
      marginBottom: 16,
      boxShadow: 'var(--shadow)',
      color: 'var(--text)',
    }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h2>
      {subtitle && (
        <p style={{ margin: '4px 0 14px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>{subtitle}</p>
      )}
      {!subtitle && <div style={{ height: 14 }} />}
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--bg-page)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 13,
  boxSizing: 'border-box',
};

const primaryBtn = (busy: boolean): React.CSSProperties => ({
  padding: '6px 16px',
  background: 'var(--accent)',
  color: 'var(--accent-fg)',
  border: 0,
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 600,
  cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.6 : 1,
});

const cardError: React.CSSProperties = {
  background: 'rgba(220,38,38,0.08)',
  border: '1px solid rgba(220,38,38,0.35)',
  color: '#dc2626',
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: 13,
  marginBottom: 16,
};

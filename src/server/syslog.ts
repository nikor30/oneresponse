// Minimal RFC 5424 syslog sender. UDP by default; TCP optional.
// Configured via settings: syslog_enabled, syslog_host, syslog_port,
// syslog_protocol (udp|tcp), syslog_facility (0-23).
//
// Used to forward SLA breach / recovery alerts as alarms to a remote
// syslog server. We track each target's last known compliance state so
// only state transitions emit (no spam every probe interval).

import dgram from 'dgram';
import net from 'net';
import os from 'os';
import { getDb } from './db/index.js';

export interface SyslogConfig {
  enabled: boolean;
  host: string | null;
  port: number;
  protocol: 'udp' | 'tcp';
  facility: number; // 0-23, default 16 (local0)
}

function readSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function getSyslogConfig(): SyslogConfig {
  const enabled = readSetting('syslog_enabled') === 'true';
  const host = readSetting('syslog_host');
  const portStr = readSetting('syslog_port');
  const protocolStr = readSetting('syslog_protocol');
  const facilityStr = readSetting('syslog_facility');
  const port = portStr ? parseInt(portStr, 10) : 514;
  const facility = facilityStr ? parseInt(facilityStr, 10) : 16;
  const protocol: 'udp' | 'tcp' = protocolStr === 'tcp' ? 'tcp' : 'udp';
  return {
    enabled: enabled && !!host,
    host,
    port: Number.isFinite(port) ? port : 514,
    protocol,
    facility: Number.isFinite(facility) && facility >= 0 && facility <= 23 ? facility : 16,
  };
}

// RFC 5424 message
function formatMessage(cfg: SyslogConfig, severity: number, msg: string): string {
  const pri = cfg.facility * 8 + severity;
  const timestamp = new Date().toISOString();
  const hostname = os.hostname() || '-';
  const appName = 'oneresponse';
  const procId = process.pid;
  const msgId = '-';
  const structuredData = '-';
  return `<${pri}>1 ${timestamp} ${hostname} ${appName} ${procId} ${msgId} ${structuredData} ${msg}`;
}

export async function sendSyslog(severity: number, msg: string, cfg?: SyslogConfig): Promise<void> {
  const config = cfg ?? getSyslogConfig();
  if (!config.enabled || !config.host) return;
  const line = formatMessage(config, severity, msg);

  if (config.protocol === 'tcp') {
    await new Promise<void>((resolve) => {
      const sock = net.createConnection({ host: config.host!, port: config.port }, () => {
        sock.write(line + '\n', () => {
          sock.end();
        });
      });
      sock.on('close', () => resolve());
      sock.on('error', (err) => {
        console.error('syslog tcp send failed:', err.message);
        resolve();
      });
      sock.setTimeout(3000, () => {
        sock.destroy();
        resolve();
      });
    });
  } else {
    await new Promise<void>((resolve) => {
      const sock = dgram.createSocket('udp4');
      const buf = Buffer.from(line + '\n', 'utf8');
      sock.send(buf, 0, buf.length, config.port, config.host!, (err) => {
        if (err) console.error('syslog udp send failed:', err.message);
        sock.close();
        resolve();
      });
    });
  }
}

// ---------------------------------------------------------------------
// SLA state transition tracker
//
// For each target we remember the last reported compliance state
// (compliant / breached). Only state transitions emit alerts so a
// continuously-bad target generates one alert, not 288 per day.
// ---------------------------------------------------------------------

type ComplianceState = 'compliant' | 'breached';
const lastState = new Map<string, ComplianceState>();

const SLA_THRESHOLD = 70; // matches isSlaCompliant in scoring.ts

export interface ProbeAlertInput {
  target_id: string;
  target_name: string;
  target_host: string;
  group_name: string;
  sla_score: number | null;
  latency_avg: number | null;
  loss_pct: number | null;
}

export function noteProbe(p: ProbeAlertInput): void {
  if (p.sla_score == null) return;
  const newState: ComplianceState = p.sla_score >= SLA_THRESHOLD ? 'compliant' : 'breached';
  const prev = lastState.get(p.target_id);
  lastState.set(p.target_id, newState);

  // First sample after boot: just record state, don't alert
  if (prev == null) return;
  if (prev === newState) return;

  const cfg = getSyslogConfig();
  if (!cfg.enabled) return;

  if (newState === 'breached') {
    // severity 3 = Error
    const msg = `SLA BREACH target=${quote(p.target_name)} host=${quote(p.target_host)} group=${quote(p.group_name)} sla_score=${p.sla_score.toFixed(1)} latency_avg=${fmtNum(p.latency_avg)}ms loss_pct=${fmtNum(p.loss_pct)}`;
    void sendSyslog(3, msg, cfg);
  } else {
    // severity 5 = Notice — recovery
    const msg = `SLA RECOVERED target=${quote(p.target_name)} host=${quote(p.target_host)} group=${quote(p.group_name)} sla_score=${p.sla_score.toFixed(1)} latency_avg=${fmtNum(p.latency_avg)}ms loss_pct=${fmtNum(p.loss_pct)}`;
    void sendSyslog(5, msg, cfg);
  }
}

function quote(s: string | null | undefined): string {
  if (!s) return '""';
  return '"' + s.replace(/"/g, '\\"') + '"';
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '-';
  return n.toFixed(2);
}

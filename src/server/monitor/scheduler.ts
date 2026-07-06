import { getDb } from '../db/index.js';
import { probe, type ProbeResult } from './prober.js';
import { calculateSlaScore } from './scoring.js';
import { pushToPeers } from '../peer/client.js';
import { noteProbe } from '../syslog.js';
import { pollAllOperations, type DeviceTarget, type CiscoProbeResult } from './cisco/collector.js';
import { decryptSecret } from './cisco/secret.js';
import type { CiscoDeviceConn } from './cisco/snmp.js';
import type { OperKind } from './cisco/mibConstants.js';
import { cdbg } from './cisco/debug.js';

// A row from `targets` joined with the group's SLA thresholds, plus the
// new cisco-ipsla columns. probe_type discriminates between the ICMP
// path (existing) and the cisco-ipsla path (new). ICMP targets keep
// their behaviour exactly as before.
interface Target {
  id: string;
  group_id: string;
  name: string;
  host: string;
  site_code: string | null;
  probe_interval: number;
  probe_count: number;
  sla_latency_ms: number;
  sla_jitter_ms: number;
  sla_loss_pct: number;
  probe_type: string;
  device_id: string | null;
  ipsla_oper_index: number | null;
  ipsla_oper_type: string | null;
}

interface DeviceRow {
  id: string;
  name: string;
  host: string;
  snmp_port: number;
  snmp_version: string;
  community: string | null;
  v3_username: string | null;
  v3_auth_protocol: string | null;
  v3_auth_password: string | null;
  v3_priv_protocol: string | null;
  v3_priv_password: string | null;
  poll_interval_seconds: number;
  enabled: number;
}

const MAX_CONCURRENT_ICMP = 10;
const timers: ReturnType<typeof setInterval>[] = [];

// ── Common path: write a measurement, push to peers, fire syslog ──
function recordMeasurement(
  target: Target,
  result: CiscoProbeResult,
  source: 'local' | 'cisco',
): void {
  const slaScore = calculateSlaScore(
    { latency_avg: result.latency_avg, jitter: result.jitter, loss_pct: result.loss_pct },
    { sla_latency_ms: target.sla_latency_ms, sla_jitter_ms: target.sla_jitter_ms, sla_loss_pct: target.sla_loss_pct },
  );

  const db = getDb();
  const timestamp = Math.floor(Date.now() / 1000);
  const x = result.ipsla ?? null; // extended udp-jitter datapoints (null for ICMP/echo)

  const insertResult = db.prepare(`
    INSERT INTO measurements (target_id, peer_id, timestamp, latency_min, latency_avg, latency_max,
                              jitter, loss_pct, probe_count, rtts, sla_score, mos, source,
                              ow_sd_min, ow_sd_avg, ow_sd_max, ow_ds_min, ow_ds_avg, ow_ds_max,
                              jitter_sd, jitter_ds, loss_sd, loss_ds, pkt_oos, pkt_mia, pkt_late, icpif)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    target.id,
    timestamp,
    result.latency_min,
    result.latency_avg,
    result.latency_max,
    result.jitter,
    result.loss_pct,
    result.probe_count,
    JSON.stringify(result.rtts ?? []),
    slaScore,
    result.mos ?? null,
    source,
    x?.ow_sd_min ?? null, x?.ow_sd_avg ?? null, x?.ow_sd_max ?? null,
    x?.ow_ds_min ?? null, x?.ow_ds_avg ?? null, x?.ow_ds_max ?? null,
    x?.jitter_sd ?? null, x?.jitter_ds ?? null,
    x?.loss_sd ?? null, x?.loss_ds ?? null,
    x?.pkt_oos ?? null, x?.pkt_mia ?? null, x?.pkt_late ?? null,
    x?.icpif ?? null,
  );

  if (source === 'cisco') {
    cdbg('measurement.insert', {
      target_id: target.id,
      target_name: target.name,
      source,
      timestamp,
      changes: insertResult.changes,
      lastInsertRowid: Number(insertResult.lastInsertRowid),
      latency_avg: result.latency_avg,
      loss_pct: result.loss_pct,
      jitter: result.jitter,
      sla_score: slaScore,
    });
  }

  pushToPeers({
    target_id: target.id,
    timestamp,
    latency_min: result.latency_min,
    latency_avg: result.latency_avg,
    latency_max: result.latency_max,
    jitter: result.jitter,
    loss_pct: result.loss_pct,
    probe_count: result.probe_count,
    rtts: result.rtts,
    sla_score: slaScore,
    mos: result.mos ?? null,
    ...(x ?? {}),
  });

  try {
    const groupRow = db.prepare('SELECT name FROM groups WHERE id = ?').get(target.group_id) as { name: string } | undefined;
    noteProbe({
      target_id: target.id,
      target_name: target.name,
      target_host: target.host,
      group_name: groupRow?.name || '',
      sla_score: slaScore,
      latency_avg: result.latency_avg,
      loss_pct: result.loss_pct,
    });
  } catch (e) { void e; }
}

// ── ICMP path (existing) ─────────────────────────────────────────
async function probeIcmpTarget(target: Target): Promise<void> {
  try {
    const result = await probe(target.host, target.probe_count);
    recordMeasurement(target, result, 'local');
  } catch (err) {
    console.error(`Probe failed for ${target.host}:`, err);
  }
}
async function runIcmpBatch(targets: Target[]): Promise<void> {
  for (let i = 0; i < targets.length; i += MAX_CONCURRENT_ICMP) {
    const batch = targets.slice(i, i + MAX_CONCURRENT_ICMP);
    await Promise.allSettled(batch.map(t => probeIcmpTarget(t)));
  }
}

// ── Cisco IP SLA path (new) ──────────────────────────────────────
function deviceToConn(d: DeviceRow): CiscoDeviceConn {
  return {
    host: d.host,
    snmp_port: d.snmp_port,
    snmp_version: d.snmp_version === '3' ? '3' : '2c',
    community: decryptSecret(d.community),
    v3_username: d.v3_username,
    v3_auth_protocol: d.v3_auth_protocol,
    v3_auth_password: decryptSecret(d.v3_auth_password),
    v3_priv_protocol: d.v3_priv_protocol,
    v3_priv_password: decryptSecret(d.v3_priv_password),
  };
}

async function pollCiscoDevice(d: DeviceRow, targets: Target[]): Promise<void> {
  const conn = deviceToConn(d);
  const ops: DeviceTarget[] = targets.flatMap(t =>
    t.ipsla_oper_index != null && t.ipsla_oper_type
      ? [{ target_id: t.id, oper_index: t.ipsla_oper_index, kind: t.ipsla_oper_type as OperKind }]
      : []
  );
  cdbg('pollCiscoDevice.start', {
    device_id: d.id,
    device_name: d.name,
    host: d.host,
    targets: targets.length,
    ops: ops.length,
    opSummary: ops.map(o => ({ target_id: o.target_id, oper_index: o.oper_index, kind: o.kind })),
  });
  if (ops.length === 0) {
    cdbg('pollCiscoDevice.noOps', { device_id: d.id });
    return;
  }

  let results;
  const db = getDb();
  try {
    results = await pollAllOperations(conn, ops);
    db.prepare('UPDATE cisco_devices SET last_seen = ?, last_error = NULL WHERE id = ?')
      .run(Math.floor(Date.now() / 1000), d.id);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`Cisco device ${d.name} (${d.host}) poll failed:`, message);
    db.prepare('UPDATE cisco_devices SET last_error = ? WHERE id = ?').run(message, d.id);
    return;
  }

  const byId = new Map(targets.map(t => [t.id, t] as const));
  for (const r of results) {
    const target = byId.get(r.target_id);
    if (!target) continue;
    recordMeasurement(target, r.result, 'cisco');
  }
}

// ── Scheduling ──────────────────────────────────────────────────
function loadIcmpTargets(): Target[] {
  const db = getDb();
  return db.prepare(`
    SELECT t.*, g.sla_latency_ms, g.sla_jitter_ms, g.sla_loss_pct
    FROM targets t
    JOIN groups g ON t.group_id = g.id
    WHERE t.enabled = 1
      AND (t.probe_type IS NULL OR t.probe_type = 'icmp')
  `).all() as Target[];
}

function loadCiscoDeviceWithTargets(): { device: DeviceRow; targets: Target[] }[] {
  const db = getDb();
  const devices = db.prepare(`
    SELECT id, name, host, snmp_port, snmp_version,
           community, v3_username, v3_auth_protocol, v3_auth_password,
           v3_priv_protocol, v3_priv_password,
           poll_interval_seconds, enabled
    FROM cisco_devices
    WHERE enabled = 1
  `).all() as DeviceRow[];

  return devices.map(d => {
    const targets = db.prepare(`
      SELECT t.*, g.sla_latency_ms, g.sla_jitter_ms, g.sla_loss_pct
      FROM targets t
      JOIN groups g ON t.group_id = g.id
      WHERE t.enabled = 1 AND t.probe_type = 'cisco-ipsla' AND t.device_id = ?
    `).all(d.id) as Target[];
    return { device: d, targets };
  });
}

export function startScheduler(): void {
  console.log('Starting monitoring scheduler...');

  // Reset any existing timers
  for (const t of timers) clearInterval(t);
  timers.length = 0;

  // ICMP — group targets by their own probe_interval (existing behaviour)
  const icmpTargets = loadIcmpTargets();
  if (icmpTargets.length === 0) {
    console.log('No ICMP targets configured.');
  } else {
    const byInterval = new Map<number, Target[]>();
    for (const t of icmpTargets) {
      const arr = byInterval.get(t.probe_interval) || [];
      arr.push(t);
      byInterval.set(t.probe_interval, arr);
    }
    for (const [interval, batch] of byInterval) {
      console.log(`Scheduling ${batch.length} ICMP targets every ${interval}s`);
      runIcmpBatch(batch);
      timers.push(setInterval(() => runIcmpBatch(batch), interval * 1000));
    }
  }

  // Cisco — group by device, poll each device on its own interval. One
  // SNMP session per device per cycle covers all of that device's ops.
  const deviceBundles = loadCiscoDeviceWithTargets();
  for (const { device, targets } of deviceBundles) {
    if (targets.length === 0) continue;
    const interval = Math.max(15, device.poll_interval_seconds || 60);
    console.log(`Scheduling Cisco device ${device.name} (${targets.length} ops) every ${interval}s`);
    pollCiscoDevice(device, targets);
    timers.push(setInterval(() => pollCiscoDevice(device, targets), interval * 1000));
  }

  // Reload every 60s to pick up CRUD changes
  setTimeout(startScheduler, 60000);
}

export function stopScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}

// Cisco IP SLA collector. Talks to a device over SNMP and returns
// measurements normalised into the same shape the ICMP prober already
// emits, so the rest of oneresponse (scheduler insert, SLA score, dart
// chart, time-series graph) doesn't need to care about the source.
//
// Public API:
//   testConnection(device)   — quick sysName GET, returns ok/error
//   discoverOperations(d)    — walks rttMonCtrlAdminTable etc.
//   pollOperation(d, idx, k) — single operation
//   pollAllOperations(d, ts) — one SNMP session per device per cycle,
//                              poll every target bound to it
//
// The normalization fns at the bottom are exported separately so they
// can be unit-tested without SNMP.

import type { ProbeResult } from '../prober.js';
import { snmpGet, snmpTableColumns, type CiscoDeviceConn } from './snmp.js';
import { cdbg } from './debug.js';
import {
  RTT_MON_CTRL_ADMIN_TAG,
  RTT_MON_CTRL_ADMIN_RTT_TYPE,
  RTT_MON_ECHO_ADMIN_TARGET_ADDRESS,
  RTT_MON_LATEST_RTT_OPER_COMPLETION_TIME,
  RTT_MON_LATEST_RTT_OPER_SENSE,
  RTT_MON_LATEST_JITTER_NUM_RTT,
  RTT_MON_LATEST_JITTER_RTT_SUM,
  RTT_MON_LATEST_JITTER_RTT_MIN,
  RTT_MON_LATEST_JITTER_RTT_MAX,
  RTT_MON_LATEST_JITTER_NUM_POS_SD,
  RTT_MON_LATEST_JITTER_SUM_POS_SD,
  RTT_MON_LATEST_JITTER_NUM_NEG_SD,
  RTT_MON_LATEST_JITTER_SUM_NEG_SD,
  RTT_MON_LATEST_JITTER_NUM_POS_DS,
  RTT_MON_LATEST_JITTER_SUM_POS_DS,
  RTT_MON_LATEST_JITTER_NUM_NEG_DS,
  RTT_MON_LATEST_JITTER_SUM_NEG_DS,
  RTT_MON_LATEST_JITTER_LOSS_SD,
  RTT_MON_LATEST_JITTER_LOSS_DS,
  RTT_MON_LATEST_JITTER_MIA,
  RTT_MON_LATEST_JITTER_OOS,
  RTT_MON_LATEST_JITTER_SENSE,
  RTT_MON_LATEST_JITTER_MOS,
  isSenseOk,
  rttTypeToOperKind,
  type OperKind,
} from './mibConstants.js';

// ── Connectivity test ─────────────────────────────────────────────
export async function testConnection(d: CiscoDeviceConn): Promise<{ ok: boolean; sysName?: string; sysObjectID?: string; error?: string }> {
  try {
    // sysName.0 = 1.3.6.1.2.1.1.5.0, sysObjectID.0 = 1.3.6.1.2.1.1.2.0
    const vbs = await snmpGet(d, ['1.3.6.1.2.1.1.5.0', '1.3.6.1.2.1.1.2.0']);
    const sysName = vbs[0]?.value != null ? String(vbs[0].value) : undefined;
    const sysObjectID = vbs[1]?.value != null ? String(vbs[1].value) : undefined;
    return { ok: true, sysName, sysObjectID };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Discovery ─────────────────────────────────────────────────────
export interface DiscoveredOperation {
  index: number;
  tag: string;
  rttType: number;       // raw enum from the device
  kind: OperKind;        // our normalised label
  target: string | null; // decoded target address if available
}

export async function discoverOperations(d: CiscoDeviceConn): Promise<DiscoveredOperation[]> {
  const rows = await snmpTableColumns(d, [
    { name: 'tag',     oid: RTT_MON_CTRL_ADMIN_TAG },
    { name: 'type',    oid: RTT_MON_CTRL_ADMIN_RTT_TYPE },
    { name: 'target',  oid: RTT_MON_ECHO_ADMIN_TARGET_ADDRESS },
  ]);
  const out: DiscoveredOperation[] = [];
  for (const [idx, vals] of Object.entries(rows)) {
    const index = parseInt(idx, 10);
    if (!Number.isFinite(index)) continue;
    const rttType = typeof vals.type === 'number' ? vals.type : 0;
    out.push({
      index,
      tag: String(vals.tag ?? ''),
      rttType,
      kind: rttTypeToOperKind(rttType),
      target: decodeTargetAddress(vals.target),
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

// rttMonEchoAdminTargetAddress is an OCTET STRING. For ipIcmpEcho it's
// a 4-byte IPv4 address; we present it as dotted quad. Anything else
// we leave as a hex blob (and fall back to "?") because the meaning
// depends on the protocol.
export function decodeTargetAddress(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  // Hex strings produced by the SNMP layer for non-printable octet strings
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 8) {
    const b = Buffer.from(raw, 'hex');
    return `${b[0]}.${b[1]}.${b[2]}.${b[3]}`;
  }
  // Already printable (e.g. URL for http op, hostname for dns)
  return raw;
}

// ── Polling — a single operation ─────────────────────────────────
export async function pollOperation(
  d: CiscoDeviceConn,
  operIndex: number,
  kind: OperKind,
): Promise<ProbeResult> {
  cdbg('pollOperation.start', { host: d.host, operIndex, kind });
  if (kind === 'udp-jitter') {
    const oids = [
      `${RTT_MON_LATEST_JITTER_NUM_RTT}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_RTT_SUM}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_RTT_MIN}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_RTT_MAX}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_NUM_POS_SD}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_SUM_POS_SD}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_NUM_NEG_SD}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_SUM_NEG_SD}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_NUM_POS_DS}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_SUM_POS_DS}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_NUM_NEG_DS}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_SUM_NEG_DS}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_LOSS_SD}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_LOSS_DS}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_MIA}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_OOS}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_SENSE}.${operIndex}`,
      `${RTT_MON_LATEST_JITTER_MOS}.${operIndex}`,
    ];
    const vbs = await snmpGet(d, oids);
    const nums = vbs.map(asNum);
    const result = normaliseJitter(nums);
    cdbg('pollOperation.end', { host: d.host, operIndex, kind, raw: nums, result });
    return result;
  }

  // All other supported kinds use the latest-RTT-oper table.
  if (kind === 'unsupported') {
    cdbg('pollOperation.end', { host: d.host, operIndex, kind, note: 'unsupported kind, returning down sample' });
    return downSample();
  }
  const oids = [
    `${RTT_MON_LATEST_RTT_OPER_COMPLETION_TIME}.${operIndex}`,
    `${RTT_MON_LATEST_RTT_OPER_SENSE}.${operIndex}`,
  ];
  const vbs = await snmpGet(d, oids);
  const ct = asNum(vbs[0]);
  const se = asNum(vbs[1]);
  const result = normaliseEcho(ct, se);
  cdbg('pollOperation.end', { host: d.host, operIndex, kind, raw: { completionTime: ct, sense: se }, result });
  return result;
}

// ── Polling — every operation on a device in one session ──────────
export interface DeviceTarget {
  target_id: string;
  oper_index: number;
  kind: OperKind;
}
export interface BatchProbeResult {
  target_id: string;
  result: ProbeResult & { mos?: number | null };
  error?: string;
}
export async function pollAllOperations(d: CiscoDeviceConn, ops: DeviceTarget[]): Promise<BatchProbeResult[]> {
  // We could in principle assemble one big GET request, but mixing
  // operations means uneven response sizes; one GET per operation
  // through a fresh session each isn't dramatic in practice (Cisco
  // devices return SNMP in single-digit ms on healthy management
  // planes). Doing it sequentially per device avoids overwhelming
  // older platforms — the scheduler already shards by device.
  const out: BatchProbeResult[] = [];
  for (const op of ops) {
    try {
      const result = await pollOperation(d, op.oper_index, op.kind);
      out.push({ target_id: op.target_id, result });
    } catch (err) {
      const message = (err as Error).message;
      cdbg('pollOperation.failed', { host: d.host, operIndex: op.oper_index, kind: op.kind, error: message });
      // Stop swallowing this — log at warn so the operator sees SNMP
      // failures in the regular server log even without DEBUG_CISCO.
      console.warn(`[cisco] poll failed host=${d.host} operIndex=${op.oper_index} kind=${op.kind}: ${message}`);
      out.push({ target_id: op.target_id, result: downSample(), error: message });
    }
  }
  return out;
}

// ── Normalisation (pure — unit-tested) ────────────────────────────

export function normaliseEcho(completionTimeMs: number | null, sense: number | null): ProbeResult {
  const ok = isSenseOk(sense);
  if (!ok || completionTimeMs == null || completionTimeMs < 0) {
    cdbg('normaliseEcho.downSample', {
      reason: !ok ? `sense=${sense} (expected 1 or 2)` : `completionTimeMs=${completionTimeMs}`,
      sense, completionTimeMs,
    });
    return downSample();
  }
  return {
    rtts: [completionTimeMs],
    latency_min: completionTimeMs,
    latency_avg: completionTimeMs,
    latency_max: completionTimeMs,
    jitter: 0,
    loss_pct: 0,
    probe_count: 1,
  };
}

// Layout of jitter() input (in this order, all nullable numbers):
//   [numRtt, rttSum, rttMin, rttMax,
//    numPosSd, sumPosSd, numNegSd, sumNegSd,
//    numPosDs, sumPosDs, numNegDs, sumNegDs,
//    lossSd, lossDs, mia, oos, sense, mos]
export function normaliseJitter(v: (number | null)[]): ProbeResult & { mos?: number | null } {
  const [
    numRtt, rttSum, rttMin, rttMax,
    numPosSd, sumPosSd, numNegSd, sumNegSd,
    numPosDs, sumPosDs, numNegDs, sumNegDs,
    lossSd, lossDs, mia, oos, sense, mosRaw,
  ] = v;

  // Reason-trace when we drop the sample. Surfaced via DEBUG_CISCO=1
  // and via the /diagnostics endpoint so the operator immediately
  // knows whether it's a sense problem, a no-RTT problem, or both.
  if (!isSenseOk(sense) || !numRtt || numRtt <= 0) {
    cdbg('normaliseJitter.downSample', {
      reason:
        !isSenseOk(sense)
          ? `sense=${sense} (expected 1 or 2)`
          : `numRtt=${numRtt}`,
      sense, numRtt, rttSum, rttMin, rttMax,
    });
    return { ...downSample(), mos: null };
  }

  const min = rttMin ?? 0;
  const max = rttMax ?? 0;
  const avg = rttSum != null ? rttSum / numRtt : 0;

  // Jitter: average absolute jitter across positive/negative SD+DS samples.
  const jitterSum = (sumPosSd ?? 0) + (sumNegSd ?? 0) + (sumPosDs ?? 0) + (sumNegDs ?? 0);
  const jitterN = (numPosSd ?? 0) + (numNegSd ?? 0) + (numPosDs ?? 0) + (numNegDs ?? 0);
  const jitter = jitterN > 0 ? jitterSum / jitterN : 0;

  // Loss: count source-to-dest + dest-to-source + MIA + out-of-sequence
  // against (numRtt + losses) — i.e. against the total packets the
  // sender attempted, not the number actually received.
  const lost = (lossSd ?? 0) + (lossDs ?? 0) + (mia ?? 0) + (oos ?? 0);
  const total = numRtt + lost;
  const loss_pct = total > 0 ? (lost / total) * 100 : 0;

  // MOS is reported * 100 in CISCO-RTTMON-MIB.
  const mos = mosRaw != null && mosRaw > 0 ? mosRaw / 100 : null;

  return {
    rtts: [],
    latency_min: min,
    latency_avg: avg,
    latency_max: max,
    jitter: Math.round(jitter * 1000) / 1000,
    loss_pct: Math.round(loss_pct * 100) / 100,
    probe_count: numRtt,
    mos,
  };
}

// A "down" sample. Mirrors what the ICMP prober emits on total failure
// so the dart chart shows a breach and SLA score drops to ~0.
function downSample(): ProbeResult {
  return {
    rtts: [],
    latency_min: 0,
    latency_avg: 0,
    latency_max: 0,
    jitter: 0,
    loss_pct: 100,
    probe_count: 0,
  };
}

function asNum(vb: { value: string | number | bigint | Buffer | boolean | null } | undefined): number | null {
  if (!vb || vb.value == null) return null;
  const v = vb.value;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') {
    // net-snmp emits BigInt for Counter64 leaves. We've already lost
    // precision past 2^53 anyway by virtue of normalising to JS number;
    // the jitter / RTT counters never come close.
    return Number(v);
  }
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  if (Buffer.isBuffer(v)) {
    // Some IOS versions return numeric leaves as zero-padded ASCII
    // octet strings ("00000020"). Try to parse as text first; failing
    // that, treat 4-byte unsigned BE as the integer (matches how
    // Counter32 used to be wire-encoded).
    const s = v.toString('utf8');
    const fromText = parseFloat(s);
    if (Number.isFinite(fromText)) return fromText;
    if (v.length === 4) return v.readUInt32BE(0);
    return null;
  }
  return null;
}

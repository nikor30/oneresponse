// CISCO-RTTMON-MIB OID and enum constants.
//
// All OIDs trace to ciscoRttMonMIB = 1.3.6.1.4.1.9.9.42 (assigned to
// Cisco Systems / "ciscoMgmt" subtree). The MIB itself is published by
// Cisco; the canonical source is
//   https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/mib/ref/cisco_mib_locator.html
// which links to CISCO-RTTMON-MIB. SNMPLINK and Observium also publish
// the resolved OID tree which we cross-referenced when writing this
// file. Each constant cites its column / row position so the next reader
// can verify against any current MIB browser without running the code.
//
// We deliberately use numeric OIDs (no MIB resolver) so the deployment
// has no MIB files to ship.

// ── Root: ciscoRttMonMIB ────────────────────────────────────────────
export const RTTMON_ROOT = '1.3.6.1.4.1.9.9.42';

// ── rttMonCtrlAdminTable: 1.3.6.1.4.1.9.9.42.1.2.1 ──────────────────
// Per-operation administrative configuration. Walked during discovery.
//   col 2 = rttMonCtrlAdminOwner
//   col 3 = rttMonCtrlAdminTag             (octet-string label)
//   col 4 = rttMonCtrlAdminRttType         (operation type enum, below)
//   col 5 = rttMonCtrlAdminThreshold
//   col 9 = rttMonCtrlAdminStatus          (RowStatus)
export const RTT_MON_CTRL_ADMIN_TABLE     = '1.3.6.1.4.1.9.9.42.1.2.1';
export const RTT_MON_CTRL_ADMIN_TAG       = '1.3.6.1.4.1.9.9.42.1.2.1.1.3';
export const RTT_MON_CTRL_ADMIN_RTT_TYPE  = '1.3.6.1.4.1.9.9.42.1.2.1.1.4';

// ── rttMonEchoAdminTable: 1.3.6.1.4.1.9.9.42.1.2.2 ──────────────────
// Per-operation target address configured by the operator.
//   col 2 = rttMonEchoAdminProtocol        (e.g. ipIcmpEcho)
//   col 3 = rttMonEchoAdminTargetAddress   (binary address)
//   col 7 = rttMonEchoAdminTargetAddressString (human-readable; not on all releases)
// We use col 3 since it's universally present, and decode based on
// protocol / address length.
export const RTT_MON_ECHO_ADMIN_TARGET_ADDRESS = '1.3.6.1.4.1.9.9.42.1.2.2.1.3';

// ── rttMonLatestRttOperTable: 1.3.6.1.4.1.9.9.42.1.2.10 ─────────────
// Latest result for echo-style operations (icmp-echo, udp-echo,
// tcp-connect, http, dns, ...).
//   col 1 = rttMonLatestRttOperCompletionTime  (ms — Gauge32)
//   col 2 = rttMonLatestRttOperSense           (enum, below)
//   col 4 = rttMonLatestRttOperTime            (TimeStamp of result)
export const RTT_MON_LATEST_RTT_OPER_COMPLETION_TIME = '1.3.6.1.4.1.9.9.42.1.2.10.1.1';
export const RTT_MON_LATEST_RTT_OPER_SENSE           = '1.3.6.1.4.1.9.9.42.1.2.10.1.2';

// ── rttMonLatestJitterOperTable: 1.3.6.1.4.1.9.9.42.1.5.2 ───────────
// Latest result for udp-jitter operations.
//
// Column layout per the current CISCO-RTTMON-MIB
// (verified against ios-xe 17.x MIB bundle and Cisco's published MIB
// browser). The mistake to avoid: columns 1-30 are the per-direction
// jitter sample counters (positives/negatives, SD/DS, min/max/num/sum/
// sum-squared). The packet-loss / sense fields start at column 31.
//
//   col 1  = NumOfRTT
//   col 2  = RTTSum
//   col 5  = RTTMin                     (ms)
//   col 6  = RTTMax                     (ms)
//   col 9  = NumOfPositivesSD
//   col 10 = SumOfPositivesSD
//   col 15 = NumOfNegativesSD
//   col 16 = SumOfNegativesSD
//   col 21 = NumOfPositivesDS
//   col 22 = SumOfPositivesDS
//   col 27 = NumOfNegativesDS
//   col 28 = SumOfNegativesDS
//   col 31 = PacketLossSD               (source-to-destination loss)
//   col 32 = PacketLossDS               (destination-to-source loss)
//   col 33 = PacketOutOfSequence
//   col 34 = PacketMIA                  (missing in action)
//   col 35 = PacketLateArrival
//   col 36 = Sense                      (operation result enum, see SENSE_OK)
//   col 42 = MOS                        (× 100 — divide by 100 to get score)
export const RTT_MON_LATEST_JITTER_NUM_RTT     = '1.3.6.1.4.1.9.9.42.1.5.2.1.1';
export const RTT_MON_LATEST_JITTER_RTT_SUM     = '1.3.6.1.4.1.9.9.42.1.5.2.1.2';
export const RTT_MON_LATEST_JITTER_RTT_MIN     = '1.3.6.1.4.1.9.9.42.1.5.2.1.5';
export const RTT_MON_LATEST_JITTER_RTT_MAX     = '1.3.6.1.4.1.9.9.42.1.5.2.1.6';
export const RTT_MON_LATEST_JITTER_NUM_POS_SD  = '1.3.6.1.4.1.9.9.42.1.5.2.1.9';
export const RTT_MON_LATEST_JITTER_SUM_POS_SD  = '1.3.6.1.4.1.9.9.42.1.5.2.1.10';
export const RTT_MON_LATEST_JITTER_NUM_NEG_SD  = '1.3.6.1.4.1.9.9.42.1.5.2.1.15';
export const RTT_MON_LATEST_JITTER_SUM_NEG_SD  = '1.3.6.1.4.1.9.9.42.1.5.2.1.16';
export const RTT_MON_LATEST_JITTER_NUM_POS_DS  = '1.3.6.1.4.1.9.9.42.1.5.2.1.21';
export const RTT_MON_LATEST_JITTER_SUM_POS_DS  = '1.3.6.1.4.1.9.9.42.1.5.2.1.22';
export const RTT_MON_LATEST_JITTER_NUM_NEG_DS  = '1.3.6.1.4.1.9.9.42.1.5.2.1.27';
export const RTT_MON_LATEST_JITTER_SUM_NEG_DS  = '1.3.6.1.4.1.9.9.42.1.5.2.1.28';
export const RTT_MON_LATEST_JITTER_LOSS_SD     = '1.3.6.1.4.1.9.9.42.1.5.2.1.31';
export const RTT_MON_LATEST_JITTER_LOSS_DS     = '1.3.6.1.4.1.9.9.42.1.5.2.1.32';
export const RTT_MON_LATEST_JITTER_OOS         = '1.3.6.1.4.1.9.9.42.1.5.2.1.33';
export const RTT_MON_LATEST_JITTER_MIA         = '1.3.6.1.4.1.9.9.42.1.5.2.1.34';
export const RTT_MON_LATEST_JITTER_SENSE       = '1.3.6.1.4.1.9.9.42.1.5.2.1.36';
export const RTT_MON_LATEST_JITTER_MOS         = '1.3.6.1.4.1.9.9.42.1.5.2.1.42';

// ── Enums ──────────────────────────────────────────────────────────
// rttMonCtrlAdminRttType — operation type enum
export const RTT_TYPE = {
  echo:        1,
  pathEcho:    2,
  fileIO:      3,
  script:      4,
  udpEcho:     5,
  tcpConnect:  6,
  http:        7,
  dns:         8,
  jitter:      9,
  dlsw:        10,
  dhcp:        11,
  ftp:         12,
  voip:        13,
  // Newer types (rtp, lspGroup, icmpJitter, lspPing, lspTrace, ethernetPing, ...)
  // exist on modern IOS — we don't try to handle them.
} as const;

export type OperKind = 'icmp-echo' | 'udp-echo' | 'udp-jitter' | 'tcp-connect' | 'http' | 'dns' | 'unsupported';

export function rttTypeToOperKind(n: number): OperKind {
  switch (n) {
    case RTT_TYPE.echo:       return 'icmp-echo';
    case RTT_TYPE.udpEcho:    return 'udp-echo';
    case RTT_TYPE.tcpConnect: return 'tcp-connect';
    case RTT_TYPE.http:       return 'http';
    case RTT_TYPE.dns:        return 'dns';
    case RTT_TYPE.jitter:     return 'udp-jitter';
    default: return 'unsupported';
  }
}
export const SENSE_OK_PRIMARY = 2;
export const SENSE_OK_ALT = 1;
export function isSenseOk(v: number | null | undefined): boolean {
  return v === SENSE_OK_PRIMARY || v === SENSE_OK_ALT;
}
export const SENSE_OK = 1;

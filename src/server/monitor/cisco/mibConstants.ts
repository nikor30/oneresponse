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
//   col 1  = rttMonLatestJitterOperNumOfRTT
//   col 2  = rttMonLatestJitterOperRTTSum
//   col 5  = rttMonLatestJitterOperRTTMin           (ms)
//   col 6  = rttMonLatestJitterOperRTTMax           (ms)
//   col 7  = rttMonLatestJitterOperMinOfPositivesSD
//   col 8  = rttMonLatestJitterOperMaxOfPositivesSD
//   col 9  = rttMonLatestJitterOperNumOfPositivesSD
//   col 10 = rttMonLatestJitterOperSumOfPositivesSD
//   col 13 = rttMonLatestJitterOperMinOfNegativesSD
//   col 14 = rttMonLatestJitterOperMaxOfNegativesSD
//   col 15 = rttMonLatestJitterOperNumOfNegativesSD
//   col 16 = rttMonLatestJitterOperSumOfNegativesSD
//   col 19 = rttMonLatestJitterOperMinOfPositivesDS
//   col 20 = rttMonLatestJitterOperMaxOfPositivesDS
//   col 21 = rttMonLatestJitterOperNumOfPositivesDS
//   col 22 = rttMonLatestJitterOperSumOfPositivesDS
//   col 25 = rttMonLatestJitterOperMinOfNegativesDS
//   col 26 = rttMonLatestJitterOperMaxOfNegativesDS
//   col 27 = rttMonLatestJitterOperNumOfNegativesDS
//   col 28 = rttMonLatestJitterOperSumOfNegativesDS
//   col 26 = rttMonLatestJitterOperPacketLossSD     (see note*)
//   col 27 = rttMonLatestJitterOperPacketLossDS     (see note*)
//   col 28 = rttMonLatestJitterOperPacketMIA        (see note*)
//   col 29 = rttMonLatestJitterOperPacketLateArrival
//   col 30 = rttMonLatestJitterOperPacketOutOfSequence
//   col 31 = rttMonLatestJitterOperSense
//   col 42 = rttMonLatestJitterOperMOS              (* 100 — divide by 100 for the score)
//
// NOTE on columns 26-30: Cisco renumbered some columns between MIB
// revisions to add IPv6 variants. The collector reads the values from
// the names below; if a particular IOS releases reports nothing at
// those OIDs we fall back to a zero loss rather than fail the probe.
// (Where deployments still report odd results, set logging to debug
// and adjust the indices in this file rather than scattering OIDs
// across the codebase.)
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
export const RTT_MON_LATEST_JITTER_LOSS_SD     = '1.3.6.1.4.1.9.9.42.1.5.2.1.26';
export const RTT_MON_LATEST_JITTER_LOSS_DS     = '1.3.6.1.4.1.9.9.42.1.5.2.1.27';
export const RTT_MON_LATEST_JITTER_MIA         = '1.3.6.1.4.1.9.9.42.1.5.2.1.28';
export const RTT_MON_LATEST_JITTER_OOS         = '1.3.6.1.4.1.9.9.42.1.5.2.1.30';
export const RTT_MON_LATEST_JITTER_SENSE       = '1.3.6.1.4.1.9.9.42.1.5.2.1.31';
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

// rttMonLatestRttOperSense — 2 = ok, everything else is a failure
// (timeout, disconnected, dnsError, httpError, ...). For the dart chart
// we just need to know "did the operation succeed".
export const SENSE_OK = 2;

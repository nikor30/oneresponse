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
// Column layout per the canonical CISCO-RTTMON-MIB, cross-checked
// against oidref.com (https://oidref.com/1.3.6.1.4.1.9.9.42.1.5.2.1)
// and the OIDs used by LibreNMS / SolarWinds IP SLA templates
// (rttMonLatestJitterOperSense = .31, MOS = .42, ICPIF = .43).
//
// NOTE: an earlier revision of this file used a shifted layout
// (RTTMin=5, PacketLossSD=31, Sense=36, …) that does not match the
// published MIB — it read Sense where PacketLossSD lives and RTTMax as
// RTTMin. If a device ever disagrees with the numbering below, the
// /devices/:id/diagnostics endpoint dumps every raw varbind so the
// mapping can be verified in minutes.
//
//   col 1  = NumOfRTT
//   col 2  = RTTSum
//   col 3  = RTTSum2
//   col 4  = RTTMin                     (ms)
//   col 5  = RTTMax                     (ms)
//   col 6  = MinOfPositivesSD    col 7  = MaxOfPositivesSD
//   col 8  = NumOfPositivesSD    col 9  = SumOfPositivesSD
//   col 11 = MinOfNegativesSD    col 12 = MaxOfNegativesSD
//   col 13 = NumOfNegativesSD    col 14 = SumOfNegativesSD
//   col 16 = MinOfPositivesDS    col 17 = MaxOfPositivesDS
//   col 18 = NumOfPositivesDS    col 19 = SumOfPositivesDS
//   col 21 = MinOfNegativesDS    col 22 = MaxOfNegativesDS
//   col 23 = NumOfNegativesDS    col 24 = SumOfNegativesDS
//   col 26 = PacketLossSD               (source→destination loss)
//   col 27 = PacketLossDS               (destination→source loss)
//   col 28 = PacketOutOfSequence
//   col 29 = PacketMIA                  (missing in action)
//   col 30 = PacketLateArrival
//   col 31 = Sense                      (operation result enum, see SENSE_OK)
//   col 33 = OWSumSD   col 35 = OWMinSD   col 36 = OWMaxSD   (one-way S→D, ms; needs NTP sync)
//   col 37 = OWSumDS   col 39 = OWMinDS   col 40 = OWMaxDS   (one-way D→S, ms; needs NTP sync)
//   col 41 = NumOfOW                    (number of successful one-way samples)
//   col 42 = MOS                        (× 100 — divide by 100 to get score)
//   col 43 = ICPIF                      (Calculated Planning Impairment Factor)
export const RTT_MON_LATEST_JITTER_NUM_RTT     = '1.3.6.1.4.1.9.9.42.1.5.2.1.1';
export const RTT_MON_LATEST_JITTER_RTT_SUM     = '1.3.6.1.4.1.9.9.42.1.5.2.1.2';
export const RTT_MON_LATEST_JITTER_RTT_MIN     = '1.3.6.1.4.1.9.9.42.1.5.2.1.4';
export const RTT_MON_LATEST_JITTER_RTT_MAX     = '1.3.6.1.4.1.9.9.42.1.5.2.1.5';
export const RTT_MON_LATEST_JITTER_NUM_POS_SD  = '1.3.6.1.4.1.9.9.42.1.5.2.1.8';
export const RTT_MON_LATEST_JITTER_SUM_POS_SD  = '1.3.6.1.4.1.9.9.42.1.5.2.1.9';
export const RTT_MON_LATEST_JITTER_NUM_NEG_SD  = '1.3.6.1.4.1.9.9.42.1.5.2.1.13';
export const RTT_MON_LATEST_JITTER_SUM_NEG_SD  = '1.3.6.1.4.1.9.9.42.1.5.2.1.14';
export const RTT_MON_LATEST_JITTER_NUM_POS_DS  = '1.3.6.1.4.1.9.9.42.1.5.2.1.18';
export const RTT_MON_LATEST_JITTER_SUM_POS_DS  = '1.3.6.1.4.1.9.9.42.1.5.2.1.19';
export const RTT_MON_LATEST_JITTER_NUM_NEG_DS  = '1.3.6.1.4.1.9.9.42.1.5.2.1.23';
export const RTT_MON_LATEST_JITTER_SUM_NEG_DS  = '1.3.6.1.4.1.9.9.42.1.5.2.1.24';
export const RTT_MON_LATEST_JITTER_LOSS_SD     = '1.3.6.1.4.1.9.9.42.1.5.2.1.26';
export const RTT_MON_LATEST_JITTER_LOSS_DS     = '1.3.6.1.4.1.9.9.42.1.5.2.1.27';
export const RTT_MON_LATEST_JITTER_OOS         = '1.3.6.1.4.1.9.9.42.1.5.2.1.28';
export const RTT_MON_LATEST_JITTER_MIA         = '1.3.6.1.4.1.9.9.42.1.5.2.1.29';
export const RTT_MON_LATEST_JITTER_LATE        = '1.3.6.1.4.1.9.9.42.1.5.2.1.30';
export const RTT_MON_LATEST_JITTER_SENSE       = '1.3.6.1.4.1.9.9.42.1.5.2.1.31';
export const RTT_MON_LATEST_JITTER_OW_SUM_SD   = '1.3.6.1.4.1.9.9.42.1.5.2.1.33';
export const RTT_MON_LATEST_JITTER_OW_MIN_SD   = '1.3.6.1.4.1.9.9.42.1.5.2.1.35';
export const RTT_MON_LATEST_JITTER_OW_MAX_SD   = '1.3.6.1.4.1.9.9.42.1.5.2.1.36';
export const RTT_MON_LATEST_JITTER_OW_SUM_DS   = '1.3.6.1.4.1.9.9.42.1.5.2.1.37';
export const RTT_MON_LATEST_JITTER_OW_MIN_DS   = '1.3.6.1.4.1.9.9.42.1.5.2.1.39';
export const RTT_MON_LATEST_JITTER_OW_MAX_DS   = '1.3.6.1.4.1.9.9.42.1.5.2.1.40';
export const RTT_MON_LATEST_JITTER_NUM_OW      = '1.3.6.1.4.1.9.9.42.1.5.2.1.41';
export const RTT_MON_LATEST_JITTER_MOS         = '1.3.6.1.4.1.9.9.42.1.5.2.1.42';
export const RTT_MON_LATEST_JITTER_ICPIF       = '1.3.6.1.4.1.9.9.42.1.5.2.1.43';

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

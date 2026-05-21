// Structured logging for the Cisco IP SLA data path. Gated behind the
// DEBUG_CISCO env var so production stays quiet but operators can
// re-enable verbose tracing without a code change.
//
//   DEBUG_CISCO=1  (or DEBUG_CISCO=true) → per-poll logs of:
//     - what targets the scheduler dispatches to which device
//     - every snmpGet (OIDs requested, raw values returned, varbind errors)
//     - the normalised ProbeResult produced
//     - the INSERT and how many rows were affected
//
// Each log line is a single JSON object so a downstream log shipper
// (rsyslog → ELK, Loki, etc) can index it.

let _enabled: boolean | null = null;

export function debugEnabled(): boolean {
  if (_enabled != null) return _enabled;
  const raw = (process.env.DEBUG_CISCO || '').trim().toLowerCase();
  _enabled = raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  return _enabled;
}

export function cdbg(event: string, data?: Record<string, unknown>): void {
  if (!debugEnabled()) return;
  const payload = { ts: new Date().toISOString(), tag: 'cisco', event, ...(data ?? {}) };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

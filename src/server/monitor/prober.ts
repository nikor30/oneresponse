import { exec } from 'child_process';
import { promisify } from 'util';
import dns from 'dns/promises';
import { getDb } from '../db/index.js';

const execAsync = promisify(exec);

// Custom DNS resolver. When the operator sets a `dns_server` setting we
// use it to resolve target hostnames before passing the IP to /bin/ping
// (the ping command itself reads /etc/resolv.conf, so we can't change
// its resolver without root). Refresh on every probe so changes via
// /api/v1/settings take effect immediately.
function resolveTargetHost(host: string): Promise<string> {
  // Plain IPv4 / IPv6 — nothing to resolve
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || /:[0-9a-f]/i.test(host)) {
    return Promise.resolve(host);
  }

  const db = getDb();
  const customServer = (db.prepare("SELECT value FROM settings WHERE key = 'dns_server'").get() as { value: string | null } | undefined)?.value || null;
  const searchDomain = (db.prepare("SELECT value FROM settings WHERE key = 'search_domain'").get() as { value: string | null } | undefined)?.value || null;

  // Append the search domain to short hostnames (no dot)
  let lookupHost = host;
  if (searchDomain && !host.includes('.')) {
    lookupHost = `${host}.${searchDomain.replace(/^\./, '')}`;
  }

  if (!customServer) {
    return Promise.resolve(lookupHost);
  }

  const resolver = new dns.Resolver();
  resolver.setServers([customServer]);
  return resolver.resolve4(lookupHost)
    .then(addrs => addrs[0] || lookupHost)
    .catch(() => lookupHost); // fall through; let ping fail with its own error
}

export interface ProbeResult {
  rtts: number[];
  latency_min: number;
  latency_avg: number;
  latency_max: number;
  jitter: number;
  loss_pct: number;
  probe_count: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export async function probe(host: string, count: number = 20, timeout: number = 5): Promise<ProbeResult> {
  const resolved = await resolveTargetHost(host);
  const cmd = `ping -c ${count} -W ${timeout} ${resolved}`;

  try {
    const { stdout } = await execAsync(cmd, { timeout: (count * timeout + 10) * 1000 });
    return parsePingOutput(stdout, count);
  } catch (err: unknown) {
    // ping exits with code 1 if some packets are lost but we still get output
    const error = err as { stdout?: string; killed?: boolean };
    if (error.stdout) {
      return parsePingOutput(error.stdout, count);
    }
    // Total failure — 100% loss
    return {
      rtts: [],
      latency_min: 0,
      latency_avg: 0,
      latency_max: 0,
      jitter: 0,
      loss_pct: 100,
      probe_count: count,
    };
  }
}

function parsePingOutput(stdout: string, count: number): ProbeResult {
  const rtts: number[] = [];

  // Parse individual ping lines: "64 bytes from ...: icmp_seq=1 ttl=64 time=1.23 ms"
  const rttRegex = /time[=<]([\d.]+)\s*ms/g;
  let match: RegExpExecArray | null;
  while ((match = rttRegex.exec(stdout)) !== null) {
    rtts.push(parseFloat(match[1]));
  }

  // Parse packet loss: "3 packets transmitted, 3 received, 0% packet loss"
  const lossMatch = stdout.match(/([\d.]+)% packet loss/);
  const loss_pct = lossMatch ? parseFloat(lossMatch[1]) : (rtts.length === 0 ? 100 : 0);

  if (rtts.length === 0) {
    return {
      rtts: [],
      latency_min: 0,
      latency_avg: 0,
      latency_max: 0,
      jitter: 0,
      loss_pct: 100,
      probe_count: count,
    };
  }

  return {
    rtts,
    latency_min: Math.min(...rtts),
    latency_avg: median(rtts),
    latency_max: Math.max(...rtts),
    jitter: Math.round(stddev(rtts) * 1000) / 1000,
    loss_pct,
    probe_count: count,
  };
}

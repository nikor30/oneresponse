// End-to-end test of the Cisco IP SLA data path with SNMP mocked out.
// We feed known-good responses for one udp-jitter operation and one
// icmp-echo operation through the real collector + scheduler + DB +
// measurements API, and assert the measurements come back out the
// other end. Any "import works, graphs empty" failure mode that's
// in the code (rather than on the device) is reproducible here.

import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.DB_PATH = ':memory:';

// Mock net-snmp before anything that imports it.
const fakeNetSnmp = vi.hoisted(() => {
  // Generate the canonical "happy path" varbinds for each OID.
  // udp-jitter op 100 mirrors the device output the user pasted:
  // 20 RTTs, RTT min/avg/max 21/22/27, no loss, sense OK.
  // icmp-echo op 10: 18 ms, sense OK.
  function valueFor(oid: string): number | null {
    // operIndex is the last segment
    const parts = oid.split('.');
    const operIndex = parseInt(parts[parts.length - 1], 10);
    const colPrefix = parts.slice(0, -1).join('.');

    // udp-jitter table (1.3.6.1.4.1.9.9.42.1.5.2.1.X)
    if (operIndex === 100) {
      switch (colPrefix) {
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.1':  return 20;   // numRtt
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.2':  return 440;  // rttSum (20 * 22)
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.5':  return 21;   // rttMin
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.6':  return 27;   // rttMax
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.9':  return 9;    // numPosSd
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.10': return 9;    // sumPosSd
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.15': return 5;    // numNegSd
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.16': return 5;    // sumNegSd
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.21': return 8;    // numPosDs
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.22': return 8;    // sumPosDs
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.27': return 6;    // numNegDs
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.28': return 6;    // sumNegDs
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.31': return 0;    // lossSd
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.32': return 0;    // lossDs
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.33': return 0;    // OOS
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.34': return 0;    // MIA
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.36': return 2;    // sense OK
        case '1.3.6.1.4.1.9.9.42.1.5.2.1.42': return 0;    // MOS not reported
      }
    }
    // icmp-echo table (1.3.6.1.4.1.9.9.42.1.2.10.1.X)
    if (operIndex === 10) {
      switch (colPrefix) {
        case '1.3.6.1.4.1.9.9.42.1.2.10.1.1': return 18;   // completion time
        case '1.3.6.1.4.1.9.9.42.1.2.10.1.2': return 2;    // sense OK
      }
    }
    // sysName / sysObjectID
    if (oid === '1.3.6.1.2.1.1.5.0') return 'router-test' as unknown as number;
    if (oid === '1.3.6.1.2.1.1.2.0') return '1.3.6.1.4.1.9.1.x' as unknown as number;
    return null;
  }

  return {
    Version2c: 1,
    Version3: 3,
    SecurityLevel: { noAuthNoPriv: 0, authNoPriv: 1, authPriv: 3 },
    AuthProtocols: { sha: 1, md5: 2 },
    PrivProtocols: { aes: 1, des: 2 },
    isVarbindError: () => false,
    createSession(_host: string, _community: string, _opts: unknown) {
      return {
        get(oids: string[], cb: (err: Error | null, vbs: unknown[]) => void) {
          const vbs = oids.map(oid => ({ oid, type: 2, value: valueFor(oid) }));
          process.nextTick(() => cb(null, vbs));
        },
        close() {},
        subtree() { /* not used in this test */ },
      };
    },
    createV3Session(_host: string, _user: unknown, _opts: unknown) {
      return this.createSession('', '', {});
    },
  };
});
vi.mock('net-snmp', () => ({ default: fakeNetSnmp, ...fakeNetSnmp }));

let app: express.Express;
let getDb: () => import('better-sqlite3').Database;
let pollAllOperations: typeof import('./collector.js').pollAllOperations;
let scheduler: typeof import('../scheduler.js');

beforeAll(async () => {
  const dbMod = await import('../../db/index.js');
  getDb = dbMod.getDb;
  getDb();

  const routerMod = await import('../../api/router.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1', routerMod.default);

  const collMod = await import('./collector.js');
  pollAllOperations = collMod.pollAllOperations;
  scheduler = await import('../scheduler.js');
});

beforeEach(() => {
  const db = getDb();
  db.exec(`
    DELETE FROM measurements;
    DELETE FROM targets;
    DELETE FROM cisco_devices;
    DELETE FROM groups;
    DELETE FROM sessions;
  `);
  db.prepare("DELETE FROM settings WHERE key IN ('admin_password_hash','admin_username')").run();
});

describe('cisco pipeline — pollAllOperations through mocked SNMP', () => {
  it('happy path udp-jitter: numRtt=20, sense=2 → real measurement, NOT a down sample', async () => {
    const results = await pollAllOperations(
      { host: '10.10.64.1', snmp_version: '2c', community: 'public' },
      [{ target_id: 't1', oper_index: 100, kind: 'udp-jitter' }],
    );
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.error).toBeUndefined();
    expect(r.result.loss_pct).toBe(0);            // not 100%
    expect(r.result.latency_avg).toBe(22);        // rttSum / numRtt = 440 / 20
    expect(r.result.latency_min).toBe(21);
    expect(r.result.latency_max).toBe(27);
    expect(r.result.probe_count).toBe(20);        // not 0
  });

  it('handles BigInt SNMP values (Counter64) without dropping the sample', async () => {
    // Patch the fake to emit BigInt for numRtt / rttSum / rttMin / rttMax
    // — that's what net-snmp returns for Counter64 columns on some IOS
    // releases. Before the asNum / decodeValue fix, BigInt fell through
    // to `null`, the normaliser saw numRtt=null and dropped the sample.
    const orig = fakeNetSnmp.createSession;
    fakeNetSnmp.createSession = function (_h: string, _c: string, _o: unknown) {
      return {
        get(oids: string[], cb: (err: Error | null, vbs: unknown[]) => void) {
          const map: Record<string, bigint | number> = {
            // Force BigInt on the RTT / numRtt leaves
            '1.3.6.1.4.1.9.9.42.1.5.2.1.1.100': 20n,
            '1.3.6.1.4.1.9.9.42.1.5.2.1.2.100': 440n,
            '1.3.6.1.4.1.9.9.42.1.5.2.1.5.100': 21n,
            '1.3.6.1.4.1.9.9.42.1.5.2.1.6.100': 27n,
            '1.3.6.1.4.1.9.9.42.1.5.2.1.36.100': 2,
          };
          const vbs = oids.map(oid => ({ oid, type: 70, value: map[oid] ?? 0 }));
          process.nextTick(() => cb(null, vbs));
        },
        close() {},
        subtree() {},
      };
    } as typeof fakeNetSnmp.createSession;

    const results = await pollAllOperations(
      { host: '10.10.64.1', snmp_version: '2c', community: 'public' },
      [{ target_id: 't3', oper_index: 100, kind: 'udp-jitter' }],
    );
    fakeNetSnmp.createSession = orig;

    expect(results[0].result.loss_pct).toBe(0);
    expect(results[0].result.latency_avg).toBe(22);
    expect(results[0].result.probe_count).toBe(20);
  });

  it('happy path icmp-echo: completionTime=18 → 18ms RTT, no loss', async () => {
    const results = await pollAllOperations(
      { host: '10.10.64.1', snmp_version: '2c', community: 'public' },
      [{ target_id: 't2', oper_index: 10, kind: 'icmp-echo' }],
    );
    expect(results[0].result.loss_pct).toBe(0);
    expect(results[0].result.latency_avg).toBe(18);
  });

  it('end-to-end: scheduler tick writes a real row to measurements + API returns it', async () => {
    const db = getDb();
    db.prepare(`INSERT INTO groups (id, name) VALUES (?, ?)`).run('g1', 'G');
    db.prepare(`INSERT INTO cisco_devices (id, name, host, snmp_version, community, poll_interval_seconds, enabled)
                VALUES (?, ?, ?, ?, ?, ?, 1)`)
      .run('d1', 'router', '10.10.64.1', '2c', 'public', 60);
    db.prepare(`INSERT INTO targets (id, group_id, name, host, enabled,
                                     probe_type, device_id, ipsla_oper_index, ipsla_oper_type)
                VALUES (?, ?, ?, ?, 1, 'cisco-ipsla', ?, ?, ?)`)
      .run('jitter-t', 'g1', 'SITE-B-WAN', 'cisco', 'd1', 100, 'udp-jitter');

    // Kick the scheduler — it'll call pollCiscoDevice once immediately
    scheduler.startScheduler();
    // Stop the interval+self-reload chain right away so the test ends.
    scheduler.stopScheduler();

    // pollCiscoDevice is async — wait for inserts to land. The mocked
    // SNMP resolves on process.nextTick so a couple of macrotasks is
    // plenty.
    await new Promise(r => setTimeout(r, 100));

    const rows = db.prepare(`SELECT * FROM measurements WHERE target_id = ?`).all('jitter-t') as Array<{
      latency_avg: number; loss_pct: number; source: string;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].source).toBe('cisco');
    expect(rows[0].loss_pct).toBe(0);
    expect(rows[0].latency_avg).toBe(22);

    // And the public API returns it.
    const resp = await request(app).get(`/api/v1/measurements/jitter-t?from=0`);
    expect(resp.status).toBe(200);
    expect(Array.isArray(resp.body)).toBe(true);
    expect(resp.body[0].latency_avg).toBe(22);
    expect(resp.body[0].loss_pct).toBe(0);
  });
});

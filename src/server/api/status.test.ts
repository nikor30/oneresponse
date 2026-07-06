// Tests for the client liveness endpoint (/api/v1/status): alive/dead
// verdicts from the latest measurement, staleness handling, and CSV export.
//
// Uses an in-memory better-sqlite3 DB (same bootstrap as targets.test.ts).

import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.DB_PATH = ':memory:';

let app: express.Express;
let getDb: () => import('better-sqlite3').Database;
beforeAll(async () => {
  const dbMod = await import('../db/index.js');
  getDb = dbMod.getDb;
  getDb();

  const routerMod = await import('./router.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1', routerMod.default);
});

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM measurements; DELETE FROM targets; DELETE FROM cisco_devices; DELETE FROM groups; DELETE FROM sessions;');
  db.prepare("DELETE FROM settings WHERE key IN ('admin_password_hash','admin_username')").run();
});

function seed(opts: {
  id: string;
  enabled?: number;
  interval?: number;
  measurement?: { ageSeconds: number; loss: number };
}) {
  const db = getDb();
  db.prepare(
    "INSERT INTO targets (id, group_id, name, host, enabled, probe_interval, probe_type) VALUES (?, 'g1', ?, '8.8.8.8', ?, ?, 'icmp')"
  ).run(opts.id, opts.id, opts.enabled ?? 1, opts.interval ?? 300);
  if (opts.measurement) {
    const ts = Math.floor(Date.now() / 1000) - opts.measurement.ageSeconds;
    db.prepare(`
      INSERT INTO measurements (target_id, timestamp, latency_avg, loss_pct, sla_score)
      VALUES (?, ?, 10.0, ?, 95)
    `).run(opts.id, ts, opts.measurement.loss);
  }
}

describe('GET /api/v1/status', () => {
  beforeEach(() => {
    getDb().prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g1', 'G');
  });

  it('marks a target with a fresh, low-loss measurement as alive', async () => {
    seed({ id: 'fresh', measurement: { ageSeconds: 30, loss: 0 } });
    const r = await request(app).get('/api/v1/status');
    expect(r.status).toBe(200);
    expect(r.body[0].status).toBe('alive');
  });

  it('marks a target whose last probe lost everything as dead', async () => {
    seed({ id: 'lossy', measurement: { ageSeconds: 30, loss: 100 } });
    const r = await request(app).get('/api/v1/status');
    expect(r.body[0].status).toBe('dead');
    expect(r.body[0].status_reason).toMatch(/100% packet loss/);
  });

  it('marks a target with only stale data as dead', async () => {
    // interval 300 → stale after 900s; measurement is 2h old
    seed({ id: 'stale', interval: 300, measurement: { ageSeconds: 7200, loss: 0 } });
    const r = await request(app).get('/api/v1/status');
    expect(r.body[0].status).toBe('dead');
    expect(r.body[0].status_reason).toMatch(/no data for/);
  });

  it('marks a never-measured target as no-data and a disabled one as disabled', async () => {
    seed({ id: 'new' });
    seed({ id: 'off', enabled: 0, measurement: { ageSeconds: 30, loss: 0 } });
    const r = await request(app).get('/api/v1/status');
    const byId = new Map((r.body as { id: string; status: string }[]).map(t => [t.id, t.status]));
    expect(byId.get('new')).toBe('no-data');
    expect(byId.get('off')).toBe('disabled');
  });

  it('defaults probe_type to icmp and reports the group name', async () => {
    seed({ id: 't1', measurement: { ageSeconds: 10, loss: 0 } });
    const r = await request(app).get('/api/v1/status');
    expect(r.body[0].probe_type).toBe('icmp');
    expect(r.body[0].group_name).toBe('G');
  });

  it('export.csv returns CSV with a status column', async () => {
    seed({ id: 'csv', measurement: { ageSeconds: 10, loss: 0 } });
    const r = await request(app).get('/api/v1/status/export.csv');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text.split('\n')[0]).toContain('status');
    expect(r.text).toContain('alive');
  });
});

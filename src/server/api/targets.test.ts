// Lightweight API tests for the new probe-type validation on /targets.
// We bypass HTTP and hit the validator directly, but mount the real
// router against a temp DB to confirm DB-level constraints too.
//
// Uses an in-memory better-sqlite3 DB.

import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// We have to point DB_PATH at an in-memory DB *before* the modules that
// open the connection get imported.
process.env.DB_PATH = ':memory:';

// Importing dynamically so the env var above takes effect.
let app: express.Express;
let getDb: () => import('better-sqlite3').Database;
beforeAll(async () => {
  const dbMod = await import('../db/index.js');
  getDb = dbMod.getDb;
  // Make sure schema + migrations are run
  getDb();

  const routerMod = await import('./router.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1', routerMod.default);
});

beforeEach(() => {
  const db = getDb();
  // Reset state between tests
  db.exec('DELETE FROM measurements; DELETE FROM targets; DELETE FROM cisco_devices; DELETE FROM groups; DELETE FROM sessions;');
  // We're in "open mode" (no admin set up) so mutations don't need auth.
  db.prepare("DELETE FROM settings WHERE key IN ('admin_password_hash','admin_username')").run();
});

describe('POST /api/v1/targets validation', () => {
  it('rejects unknown probe_type', async () => {
    const db = getDb();
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g1', 'G');
    const r = await request(app).post('/api/v1/targets').send({
      group_id: 'g1', name: 't', host: 'x', probe_type: 'bogus',
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/invalid probe_type/);
  });

  it('rejects cisco-ipsla without device_id', async () => {
    const db = getDb();
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g1', 'G');
    const r = await request(app).post('/api/v1/targets').send({
      group_id: 'g1', name: 't', host: 'x', probe_type: 'cisco-ipsla',
      ipsla_oper_index: 1, ipsla_oper_type: 'icmp-echo',
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/device_id/);
  });

  it('rejects cisco-ipsla with bad ipsla_oper_type', async () => {
    const db = getDb();
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g1', 'G');
    db.prepare(`INSERT INTO cisco_devices (id, name, host, snmp_version, community) VALUES ('d1','D','10.0.0.1','2c','public')`).run();
    const r = await request(app).post('/api/v1/targets').send({
      group_id: 'g1', name: 't', host: 'x', probe_type: 'cisco-ipsla',
      device_id: 'd1', ipsla_oper_index: 1, ipsla_oper_type: 'unknown-op',
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/ipsla_oper_type/);
  });

  it('accepts valid cisco-ipsla and stores the new fields', async () => {
    const db = getDb();
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g1', 'G');
    db.prepare(`INSERT INTO cisco_devices (id, name, host, snmp_version, community) VALUES ('d1','D','10.0.0.1','2c','public')`).run();
    const r = await request(app).post('/api/v1/targets').send({
      group_id: 'g1', name: 'op1', host: 'cisco', probe_type: 'cisco-ipsla',
      device_id: 'd1', ipsla_oper_index: 42, ipsla_oper_type: 'udp-jitter',
    });
    expect(r.status).toBe(201);
    expect(r.body.probe_type).toBe('cisco-ipsla');
    expect(r.body.device_id).toBe('d1');
    expect(r.body.ipsla_oper_index).toBe(42);
    expect(r.body.ipsla_oper_type).toBe('udp-jitter');
  });

  it('accepts legacy ICMP shape without any probe_type field', async () => {
    const db = getDb();
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g1', 'G');
    const r = await request(app).post('/api/v1/targets').send({
      group_id: 'g1', name: 't', host: '8.8.8.8',
    });
    expect(r.status).toBe(201);
    expect(r.body.probe_type).toBe('icmp');
  });
});

describe('bulk target operations', () => {
  function seedTargets(ids: string[], groupId = 'g1') {
    const db = getDb();
    const stmt = db.prepare(
      "INSERT INTO targets (id, group_id, name, host, enabled, probe_type) VALUES (?, ?, ?, ?, 1, 'icmp')"
    );
    for (const id of ids) stmt.run(id, groupId, id, '8.8.8.8');
  }

  it('bulk/delete removes many targets at once', async () => {
    const db = getDb();
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g1', 'G');
    seedTargets(['a', 'b', 'c']);

    const r = await request(app).post('/api/v1/targets/bulk/delete').send({ ids: ['a', 'b'] });
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(2);

    const remaining = db.prepare('SELECT id FROM targets ORDER BY id').all() as { id: string }[];
    expect(remaining.map(t => t.id)).toEqual(['c']);
  });

  it('bulk/delete rejects an empty ids array', async () => {
    const r = await request(app).post('/api/v1/targets/bulk/delete').send({ ids: [] });
    expect(r.status).toBe(400);
  });

  it('bulk/update applies enabled + group changes to many targets', async () => {
    const db = getDb();
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g1', 'G1');
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g2', 'G2');
    seedTargets(['a', 'b']);

    const r = await request(app).post('/api/v1/targets/bulk/update')
      .send({ ids: ['a', 'b'], patch: { enabled: 0, group_id: 'g2' } });
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(2);

    const rows = db.prepare('SELECT enabled, group_id FROM targets').all() as { enabled: number; group_id: string }[];
    expect(rows.every(t => t.enabled === 0 && t.group_id === 'g2')).toBe(true);
  });

  it('bulk/update rejects an invalid group_id', async () => {
    const db = getDb();
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g1', 'G');
    seedTargets(['a']);
    const r = await request(app).post('/api/v1/targets/bulk/update')
      .send({ ids: ['a'], patch: { group_id: 'nope' } });
    expect(r.status).toBe(400);
  });

  it('bulk/update rejects a patch with no editable fields', async () => {
    const db = getDb();
    db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run('g1', 'G');
    seedTargets(['a']);
    const r = await request(app).post('/api/v1/targets/bulk/update')
      .send({ ids: ['a'], patch: { name: 'hax', probe_type: 'cisco-ipsla' } });
    expect(r.status).toBe(400);
  });
});

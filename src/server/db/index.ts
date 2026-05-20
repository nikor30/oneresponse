import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA } from './schema.js';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'oneresponse.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    runMigrations(db);
  }
  return db;
}

// Idempotent migrations for columns added after the initial schema.
// SQLite ALTER TABLE ADD COLUMN doesn't support IF NOT EXISTS, so we
// check PRAGMA table_info first.
function runMigrations(d: Database.Database): void {
  const ensureCol = (table: string, col: string, ddl: string) => {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some(c => c.name === col)) {
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    }
  };
  ensureCol('groups', 'viz_latency_min', 'REAL');
  ensureCol('groups', 'viz_latency_max', 'REAL');
  ensureCol('peers', 'last_error', 'TEXT');

  // Cisco IP SLA integration — new columns on targets + measurements.
  // cisco_devices itself is created by CREATE TABLE IF NOT EXISTS in
  // schema.ts and so doesn't need a migration step.
  ensureCol('targets',      'probe_type',       `TEXT NOT NULL DEFAULT 'icmp'`);
  ensureCol('targets',      'device_id',        'TEXT');
  ensureCol('targets',      'ipsla_oper_index', 'INTEGER');
  ensureCol('targets',      'ipsla_oper_type',  'TEXT');
  ensureCol('measurements', 'mos',              'REAL');
  ensureCol('measurements', 'source',           'TEXT');
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}

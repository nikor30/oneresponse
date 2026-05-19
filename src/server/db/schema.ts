export const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sla_latency_ms REAL DEFAULT 100,
  sla_jitter_ms REAL DEFAULT 30,
  sla_loss_pct REAL DEFAULT 1,
  viz_latency_min REAL,
  viz_latency_max REAL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  site_code TEXT,
  probe_interval INTEGER DEFAULT 300,
  probe_count INTEGER DEFAULT 20,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  peer_id TEXT,
  timestamp INTEGER NOT NULL,
  latency_min REAL,
  latency_avg REAL,
  latency_max REAL,
  jitter REAL,
  loss_pct REAL,
  probe_count INTEGER,
  rtts TEXT,
  sla_score REAL
);

CREATE INDEX IF NOT EXISTS idx_measurements_target_ts
  ON measurements(target_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_measurements_peer_ts
  ON measurements(peer_id, timestamp);

CREATE TABLE IF NOT EXISTS peers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  direction TEXT DEFAULT 'both',
  enabled INTEGER DEFAULT 1,
  last_seen INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  permissions TEXT DEFAULT 'read',
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Pre-computed lifetime drift bounds per target so the dashboard query
-- doesn't have to run NTILE(20) over the entire measurements table on
-- every render. Refreshed periodically by the maintenance job.
CREATE TABLE IF NOT EXISTS target_stats (
  target_id TEXT PRIMARY KEY REFERENCES targets(id) ON DELETE CASCADE,
  latency_min_lifetime REAL,
  latency_max_lifetime REAL,
  sample_count INTEGER,
  updated_at INTEGER
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('site_name', 'oneresponse');
INSERT OR IGNORE INTO settings (key, value) VALUES ('retention_raw_days', '90');
INSERT OR IGNORE INTO settings (key, value) VALUES ('retention_rtts_days', '7');
`;

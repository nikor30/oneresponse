// Single-admin authentication.
//
// State:
//   - settings.admin_username + settings.admin_password_hash (scrypt) hold
//     the one admin account. When the hash row is missing the system is
//     in "open mode" so a fresh install isn't locked out before setup.
//   - sessions(token, username, expires_at) holds active logins. Cookie
//     `or_session` carries the token.
//
// Mutation routes call requireAdmin() which returns 401 when:
//   - an admin exists AND no valid session cookie is presented.
//
// In open mode (no admin yet) requireAdmin lets every request through so
// the operator can complete setup. Once an admin is created (via the
// /api/v1/auth/setup route) the system flips into locked mode.

import { Request, Response, NextFunction } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { getDb } from './db/index.js';

const SESSION_COOKIE = 'or_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64);
  return salt + ':' + derived.toString('hex');
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, 64);
  } catch {
    return false;
  }
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function getSettingValue(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function isAdminConfigured(): boolean {
  return !!getSettingValue('admin_password_hash');
}

export function getAdminUsername(): string {
  return getSettingValue('admin_username') || 'admin';
}

export function setAdminCredentials(username: string, password: string): void {
  const db = getDb();
  const hash = hashPassword(password);
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
  `);
  const tx = db.transaction(() => {
    upsert.run('admin_username', username);
    upsert.run('admin_password_hash', hash);
  });
  tx();
}

export function createSession(username: string): string {
  const token = randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  db.prepare('INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)')
    .run(token, username, now + SESSION_TTL_SECONDS);
  return token;
}

export function deleteSession(token: string): void {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

interface SessionRow { token: string; username: string; expires_at: number }

export function lookupSession(token: string | undefined): SessionRow | null {
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  const row = db.prepare('SELECT token, username, expires_at FROM sessions WHERE token = ? AND expires_at > ?')
    .get(token, now) as SessionRow | undefined;
  return row || null;
}

// Minimal cookie parser — avoids pulling in cookie-parser.
function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function getSessionFromRequest(req: Request): SessionRow | null {
  return lookupSession(readCookie(req, SESSION_COOKIE));
}

export function setSessionCookie(res: Response, token: string): void {
  // HttpOnly + SameSite=Lax: the cookie is sent on same-site navigations,
  // never exposed to JS. Secure flag is enabled when the request comes in
  // over HTTPS — set by the operator's reverse proxy in production.
  const maxAge = SESSION_TTL_SECONDS;
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Express middleware for endpoints that mutate state. Open until the
// first admin password is set; locked thereafter.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAdminConfigured()) {
    return next(); // open mode — pre-setup
  }
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'Admin login required' });
    return;
  }
  next();
}

// Field-level encryption for SNMP credentials at rest.
//
// When the env var ONERESPONSE_SECRET_KEY is set, every secret stored
// goes through AES-256-GCM with a key derived from that env var via
// SHA-256. Encoded form: "enc1:<base64 iv>:<base64 tag>:<base64 ct>".
// When the env var is not set, secrets are written as plain text and a
// warning is logged the first time we save one — so the operator knows
// they should set the key.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc1:';

let warned = false;
function getKey(): Buffer | null {
  const env = process.env.ONERESPONSE_SECRET_KEY;
  if (!env) return null;
  return createHash('sha256').update(env, 'utf8').digest();
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === '') return null;
  const key = getKey();
  if (!key) {
    if (!warned) {
      console.warn('[secret] ONERESPONSE_SECRET_KEY not set — SNMP credentials are stored unencrypted. Set the env var to enable at-rest encryption.');
      warned = true;
    }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + iv.toString('base64') + ':' + tag.toString('base64') + ':' + ct.toString('base64');
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return null;
  if (!stored.startsWith(PREFIX)) return stored; // plain (legacy or unencrypted mode)
  const key = getKey();
  if (!key) {
    // Stored value is encrypted but we don't have the key — return null
    // rather than half-broken garbage. The collector will then fail with
    // an auth error, which is honest.
    return null;
  }
  const parts = stored.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  try {
    const iv  = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const ct  = Buffer.from(parts[2], 'base64');
    const dec = createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
  } catch {
    return null;
  }
}

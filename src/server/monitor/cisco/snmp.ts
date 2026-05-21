// Thin wrapper around net-snmp providing the two operations we need:
//   - `snmpGet`: a single GET for a small list of leaf OIDs
//   - `snmpTableColumns`: subtree walks for a set of table columns,
//                         keyed by the row index suffix
//
// Both close the session on completion so the caller doesn't have to
// manage lifecycle. Errors are returned as a single typed Error.

import snmp from 'net-snmp';
import { cdbg } from './debug.js';

export interface CiscoDeviceConn {
  host: string;
  snmp_port?: number | null;
  snmp_version: '2c' | '3';
  community?: string | null;
  v3_username?: string | null;
  v3_auth_protocol?: string | null;
  v3_auth_password?: string | null;
  v3_priv_protocol?: string | null;
  v3_priv_password?: string | null;
}

export interface SnmpVarbind {
  oid: string;
  type: number;
  value: string | number | bigint | Buffer | boolean | null;
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_RETRIES = 1;

function createSession(d: CiscoDeviceConn) {
  const opts = {
    port: d.snmp_port ?? 161,
    retries: DEFAULT_RETRIES,
    timeout: DEFAULT_TIMEOUT_MS,
    transport: 'udp4' as const,
    version: d.snmp_version === '3' ? snmp.Version3 : snmp.Version2c,
  };

  if (d.snmp_version === '3') {
    if (!d.v3_username) throw new Error('SNMPv3 requires a username');
    const authProto = mapAuthProto(d.v3_auth_protocol);
    const privProto = mapPrivProto(d.v3_priv_protocol);
    const level =
      privProto && authProto ? snmp.SecurityLevel.authPriv :
      authProto              ? snmp.SecurityLevel.authNoPriv :
                               snmp.SecurityLevel.noAuthNoPriv;
    const user = {
      name: d.v3_username,
      level,
      authProtocol: authProto ?? undefined,
      authKey: d.v3_auth_password ?? undefined,
      privProtocol: privProto ?? undefined,
      privKey: d.v3_priv_password ?? undefined,
    };
    return snmp.createV3Session(d.host, user, opts);
  }
  return snmp.createSession(d.host, d.community || 'public', opts);
}

function mapAuthProto(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = s.toUpperCase();
  if (v === 'SHA') return snmp.AuthProtocols.sha;
  if (v === 'MD5') return snmp.AuthProtocols.md5;
  return null;
}
function mapPrivProto(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = s.toUpperCase();
  if (v === 'AES') return snmp.PrivProtocols.aes;
  if (v === 'DES') return snmp.PrivProtocols.des;
  return null;
}

export async function snmpGet(d: CiscoDeviceConn, oids: string[]): Promise<SnmpVarbind[]> {
  cdbg('snmpGet.request', { host: d.host, version: d.snmp_version, oids });
  const session = createSession(d);
  return new Promise<SnmpVarbind[]>((resolve, reject) => {
    session.get(oids, (err: Error | null, varbinds: SnmpVarbind[]) => {
      session.close();
      if (err) {
        cdbg('snmpGet.error', { host: d.host, error: err.message });
        return reject(err);
      }
      // Replace noSuchObject / noSuchInstance / endOfMibView responses
      // with a null-valued varbind so the caller can treat them as
      // "value missing" without having to know about SNMP error types.
      // (Older / newer MIB revisions move columns around; we tolerate
      // missing leaves rather than failing the whole probe.)
      const cleaned = (varbinds || []).map(vb => {
        if (snmp.isVarbindError(vb)) {
          cdbg('snmpGet.varbindError', { oid: vb.oid, type: vb.type });
          return { oid: vb.oid, type: 5, value: null };
        }
        return vb;
      });
      cdbg('snmpGet.response', {
        host: d.host,
        values: cleaned.map(vb => ({
          oid: vb.oid,
          type: vb.type,
          // Render Buffer as hex so it serialises cleanly
          value: Buffer.isBuffer(vb.value) ? vb.value.toString('hex') : vb.value,
        })),
      });
      resolve(cleaned);
    });
  });
}

// Walk one or more table columns (each given as the column's leaf OID
// prefix, e.g. "1.3.6.1.4.1.9.9.42.1.2.1.1.4") and group results by the
// row-index suffix after the prefix. So a call asking for columns
// [tag, type] returns:
//
//   {
//     "1": { tag: "...", type: 9 },
//     "2": { tag: "...", type: 1 },
//     ...
//   }
//
// keyed by the operation index. Values are decoded to JS scalars.
export async function snmpTableColumns(
  d: CiscoDeviceConn,
  columns: { name: string; oid: string }[],
): Promise<Record<string, Record<string, string | number | null>>> {
  const session = createSession(d);
  const rows: Record<string, Record<string, string | number | null>> = {};

  try {
    for (const col of columns) {
      await new Promise<void>((resolve, reject) => {
        const oidPrefix = col.oid;
        const feedCb = (vbs: SnmpVarbind[]) => {
          for (const vb of vbs) {
            if (snmp.isVarbindError(vb)) continue;
            // The row index is everything after the column prefix
            if (!vb.oid.startsWith(oidPrefix + '.')) continue;
            const index = vb.oid.slice(oidPrefix.length + 1);
            const decoded = decodeValue(vb);
            (rows[index] ??= {})[col.name] = decoded;
          }
        };
        const doneCb = (err: Error | null) => {
          if (err) return reject(err);
          resolve();
        };
        session.subtree(oidPrefix, 20, feedCb, doneCb);
      });
    }
  } finally {
    session.close();
  }

  return rows;
}

function decodeValue(vb: SnmpVarbind): string | number | null {
  const v = vb.value;
  if (v == null) return null;
  if (typeof v === 'number') return v;
  // net-snmp emits BigInt for Counter64. We don't need 64-bit precision
  // for any column we read, so cast to Number.
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Buffer.isBuffer(v)) {
    // For OCTET STRING values, attempt to render UTF-8 if printable,
    // otherwise hex.
    if (looksPrintable(v)) return v.toString('utf8');
    return v.toString('hex');
  }
  return null;
}

function looksPrintable(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  for (const b of buf) {
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b > 126) return false;
  }
  return true;
}

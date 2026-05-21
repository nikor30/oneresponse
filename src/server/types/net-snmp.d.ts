// Minimal shim for net-snmp — we only use a tiny surface. A more
// thorough definition would belong in @types/net-snmp, which doesn't
// exist on npm at the time of writing.

declare module 'net-snmp' {
  export const Version2c: number;
  export const Version3: number;
  export const SecurityLevel: { noAuthNoPriv: number; authNoPriv: number; authPriv: number };
  export const AuthProtocols: { sha: number; md5: number };
  export const PrivProtocols: { aes: number; des: number };

  export interface Varbind {
    oid: string;
    type: number;
    value: string | number | bigint | Buffer | boolean | null;
  }

  export function isVarbindError(vb: Varbind): boolean;

  interface Session {
    get(oids: string[], cb: (err: Error | null, vbs: Varbind[]) => void): void;
    subtree(
      oid: string,
      maxRepetitions: number,
      feedCb: (vbs: Varbind[]) => void,
      doneCb: (err: Error | null) => void
    ): void;
    close(): void;
  }

  export function createSession(host: string, community: string, opts?: Record<string, unknown>): Session;
  export function createV3Session(host: string, user: Record<string, unknown>, opts?: Record<string, unknown>): Session;

  const _default: {
    Version2c: number;
    Version3: number;
    SecurityLevel: typeof SecurityLevel;
    AuthProtocols: typeof AuthProtocols;
    PrivProtocols: typeof PrivProtocols;
    isVarbindError: typeof isVarbindError;
    createSession: typeof createSession;
    createV3Session: typeof createV3Session;
  };
  export default _default;
}

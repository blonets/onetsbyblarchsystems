import { ReplySentence, replyRows } from '../protocol.js';
import { idWord, parseYesNo, queryWords, setWords } from './util.js';

/**
 * Typed command builders for `/interface/*`.
 *
 * SSTP-CLIENT QUIRK (live-verified on RouterOS 6.49.17 CHR): the API accepts
 * ONLY `connect-to` / `user` / `password` at creation time
 * (`/interface/sstp-client/add`). Everything else — `name`,
 * `verify-server-certificate`, `disabled`, … — must be set afterwards with
 * `/interface/sstp-client/set`. The builders below enforce this split at the
 * type level so app code cannot send a rejected sentence.
 *
 * Refined 2026-10-16: the device actually tolerates `name`/`disabled`/
 * `verify-server-certificate` at creation too — but `port` is NOT a valid
 * sstp-client parameter at all (API rejects it with "unknown parameter";
 * the port travels inside `connect-to` as `host:port`). The builder stays on
 * the conservative 3-parameter creation path, which works on every version.
 */

// ---------------------------------------------------------------------------
// generic interface reads / state
// ---------------------------------------------------------------------------

export const interfaceList = (filter: Record<string, string> = {}): string[] => [
  '/interface/print',
  ...queryWords(filter),
];

export const interfaceSet = (id: string, patch: { name?: string; mtu?: number; comment?: string }): string[] => [
  '/interface/set',
  idWord(id),
  ...setWords({ name: patch.name, mtu: patch.mtu, comment: patch.comment }),
];

export const interfaceEnable = (id: string): string[] => ['/interface/enable', idWord(id)];

export const interfaceDisable = (id: string): string[] => ['/interface/disable', idWord(id)];

export interface InterfaceEntry {
  id: string;
  name: string;
  type?: string;
  mtu?: string;
  macAddress?: string;
  running?: boolean;
  disabled: boolean;
  comment?: string;
}

export function parseInterfaces(replies: ReplySentence[]): InterfaceEntry[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    type: r['type'],
    mtu: r['mtu'],
    macAddress: r['mac-address'],
    running: r['running'] === undefined ? undefined : parseYesNo(r['running']),
    disabled: parseYesNo(r['disabled']),
    comment: r['comment'],
  }));
}

// ---------------------------------------------------------------------------
// sstp-client
// ---------------------------------------------------------------------------

/**
 * Create an SSTP client. Per the creation quirk, ONLY connect-to/user/password
 * may be sent here — pass everything else to {@link sstpClientSet}.
 */
export const sstpClientAdd = (connectTo: string, user: string, password: string): string[] => [
  '/interface/sstp-client/add',
  `=connect-to=${connectTo}`,
  `=user=${user}`,
  `=password=${password}`,
];

export interface SstpClientSetInput {
  name?: string;
  /** e.g. "hub.example.com:444" — the port travels inside connect-to */
  connectTo?: string;
  /**
   * NOTE: there is NO `port` parameter — the device rejects `=port=` with
   * "unknown parameter" (live-verified on 6.49.17). The port travels inside
   * `connect-to` as `host:port` (see the `connectTo` field on add).
   */
  profile?: string;
  authentication?: string;
  certificate?: string;
  verifyServerCertificate?: boolean;
  tlsVersion?: string;
  keepaliveTimeout?: string;
  comment?: string;
  disabled?: boolean;
}

export const sstpClientSet = (id: string, patch: SstpClientSetInput): string[] => [
  '/interface/sstp-client/set',
  idWord(id),
  ...setWords({
    name: patch.name,
    'connect-to': patch.connectTo,
    profile: patch.profile,
    authentication: patch.authentication,
    certificate: patch.certificate,
    'verify-server-certificate': patch.verifyServerCertificate,
    'tls-version': patch.tlsVersion,
    'keepalive-timeout': patch.keepaliveTimeout,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const sstpClientList = (): string[] => ['/interface/sstp-client/print'];

export const sstpClientRemove = (id: string): string[] => [
  '/interface/sstp-client/remove',
  idWord(id),
];

export const sstpClientEnable = (id: string): string[] => [
  '/interface/sstp-client/enable',
  idWord(id),
];

export const sstpClientDisable = (id: string): string[] => [
  '/interface/sstp-client/disable',
  idWord(id),
];

export interface SstpClient {
  id: string;
  name?: string;
  connectTo?: string;
  port?: string;
  user?: string;
  profile?: string;
  verifyServerCertificate?: boolean;
  running?: boolean;
  disabled: boolean;
  comment?: string;
}

export function parseSstpClients(replies: ReplySentence[]): SstpClient[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'],
    connectTo: r['connect-to'],
    port: r['port'],
    user: r['user'],
    profile: r['profile'],
    verifyServerCertificate:
      r['verify-server-certificate'] === undefined
        ? undefined
        : parseYesNo(r['verify-server-certificate']),
    running: r['running'] === undefined ? undefined : parseYesNo(r['running']),
    disabled: parseYesNo(r['disabled']),
    comment: r['comment'],
  }));
}

import { ReplySentence, replyRows } from '../protocol.js';
import { idWord, parseYesNo, queryWords, setWords } from './util.js';

/**
 * Typed command builders for `/ppp/secret`.
 * Used by the provisioning service to create the hub-side SSTP secret for each
 * site router: unique username/password + static tunnel IP (`remote-address`).
 */

export interface PppSecretInput {
  name: string;
  password: string;
  /** 'sstp' for site routers */
  service?: string;
  profile?: string;
  /** static tunnel IP, e.g. 10.200.0.7 */
  remoteAddress?: string;
  localAddress?: string;
  /** the platform stamps `panel-router:<routerUuid>` */
  comment?: string;
  disabled?: boolean;
}

export const pppSecretAdd = (input: PppSecretInput): string[] => [
  '/ppp/secret/add',
  ...setWords({
    name: input.name,
    password: input.password,
    service: input.service ?? 'sstp',
    profile: input.profile ?? 'default',
    'remote-address': input.remoteAddress,
    'local-address': input.localAddress,
    comment: input.comment,
    disabled: input.disabled,
  }),
];

export const pppSecretList = (filter: Record<string, string> = {}): string[] => [
  '/ppp/secret/print',
  ...queryWords(filter),
];

export const pppSecretSet = (id: string, patch: Partial<PppSecretInput>): string[] => [
  '/ppp/secret/set',
  idWord(id),
  ...setWords({
    name: patch.name,
    password: patch.password,
    service: patch.service,
    profile: patch.profile,
    'remote-address': patch.remoteAddress,
    'local-address': patch.localAddress,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const pppSecretRemove = (id: string): string[] => ['/ppp/secret/remove', idWord(id)];

export const pppSecretEnable = (id: string): string[] => ['/ppp/secret/enable', idWord(id)];

export const pppSecretDisable = (id: string): string[] => ['/ppp/secret/disable', idWord(id)];

export interface PppSecret {
  id: string;
  name: string;
  service?: string;
  profile?: string;
  remoteAddress?: string;
  localAddress?: string;
  comment?: string;
  disabled: boolean;
}

export function parsePppSecrets(replies: ReplySentence[]): PppSecret[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    service: r['service'],
    profile: r['profile'],
    remoteAddress: r['remote-address'],
    localAddress: r['local-address'],
    comment: r['comment'],
    disabled: parseYesNo(r['disabled']),
  }));
}

// ---------------------------------------------------------------------------
// ppp active sessions (read + disconnect)
// ---------------------------------------------------------------------------

export const pppActiveList = (filter: Record<string, string> = {}): string[] => [
  '/ppp/active/print',
  ...queryWords(filter),
];

/** Drop an active PPP session (forces the client to redial). */
export const pppActiveRemove = (id: string): string[] => ['/ppp/active/remove', idWord(id)];

export interface PppActiveEntry {
  id: string;
  name: string;
  service?: string;
  callerId?: string;
  address?: string;
  uptime?: string;
  encoding?: string;
}

export function parsePppActive(replies: ReplySentence[]): PppActiveEntry[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    service: r['service'],
    callerId: r['caller-id'],
    address: r['address'],
    uptime: r['uptime'],
    encoding: r['encoding'],
  }));
}

// ---------------------------------------------------------------------------
// ppp profiles (/ppp/profile)
// ---------------------------------------------------------------------------

export interface PppProfileInput {
  name: string;
  localAddress?: string;
  remoteAddress?: string;
  bridge?: string;
  dnsServer?: string;
  comment?: string;
}

export const pppProfileAdd = (input: PppProfileInput): string[] => [
  '/ppp/profile/add',
  ...setWords({
    name: input.name,
    'local-address': input.localAddress,
    'remote-address': input.remoteAddress,
    bridge: input.bridge,
    'dns-server': input.dnsServer,
    comment: input.comment,
  }),
];

export const pppProfileList = (): string[] => ['/ppp/profile/print'];

export const pppProfileSet = (id: string, patch: Partial<PppProfileInput>): string[] => [
  '/ppp/profile/set',
  idWord(id),
  ...setWords({
    name: patch.name,
    'local-address': patch.localAddress,
    'remote-address': patch.remoteAddress,
    bridge: patch.bridge,
    'dns-server': patch.dnsServer,
    comment: patch.comment,
  }),
];

export const pppProfileRemove = (id: string): string[] => ['/ppp/profile/remove', idWord(id)];

export interface PppProfile {
  id: string;
  name: string;
  localAddress?: string;
  remoteAddress?: string;
  bridge?: string;
  dnsServer?: string;
  comment?: string;
}

export function parsePppProfiles(replies: ReplySentence[]): PppProfile[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    localAddress: r['local-address'],
    remoteAddress: r['remote-address'],
    bridge: r['bridge'],
    dnsServer: r['dns-server'],
    comment: r['comment'],
  }));
}

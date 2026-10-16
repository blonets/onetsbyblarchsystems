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

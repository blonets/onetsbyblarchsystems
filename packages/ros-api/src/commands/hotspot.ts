import type { HotspotProfile, HotspotServer, HotspotUser } from '@mtk/types';
import { ReplySentence, replyRows } from '../protocol.js';
import { idWord, parseYesNo, queryWords, setWords } from './util.js';

/** Typed command builders for `/ip/hotspot/*`. Every builder returns one API sentence. */

// ---------------------------------------------------------------------------
// hotspot users
// ---------------------------------------------------------------------------

export interface HotspotUserInput {
  server: string;
  name: string;
  password?: string;
  profile?: string;
  comment?: string;
  disabled?: boolean;
  /** e.g. "1d", "12:00:00" */
  limitUptime?: string;
  /** e.g. "5M/5M" */
  limitBytesTotal?: string;
}

export const hotspotUserAdd = (input: HotspotUserInput): string[] => [
  '/ip/hotspot/user/add',
  ...setWords({
    server: input.server,
    name: input.name,
    password: input.password,
    profile: input.profile,
    comment: input.comment,
    disabled: input.disabled,
    'limit-uptime': input.limitUptime,
    'limit-bytes-total': input.limitBytesTotal,
  }),
];

export const hotspotUserList = (filter: Record<string, string> = {}): string[] => [
  '/ip/hotspot/user/print',
  ...queryWords(filter),
];

export const hotspotUserSet = (id: string, patch: Partial<HotspotUserInput>): string[] => [
  '/ip/hotspot/user/set',
  idWord(id),
  ...setWords({
    server: patch.server,
    name: patch.name,
    password: patch.password,
    profile: patch.profile,
    comment: patch.comment,
    disabled: patch.disabled,
    'limit-uptime': patch.limitUptime,
    'limit-bytes-total': patch.limitBytesTotal,
  }),
];

export const hotspotUserRemove = (id: string): string[] => ['/ip/hotspot/user/remove', idWord(id)];

export const hotspotUserEnable = (id: string): string[] => ['/ip/hotspot/user/enable', idWord(id)];

export const hotspotUserDisable = (id: string): string[] => ['/ip/hotspot/user/disable', idWord(id)];

export function parseHotspotUsers(replies: ReplySentence[]): HotspotUser[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    server: r['server'] ?? '',
    name: r['name'] ?? '',
    profile: r['profile'] ?? '',
    uptime: r['uptime'],
    bytesIn: num(r['bytes-in']),
    bytesOut: num(r['bytes-out']),
    packetsIn: num(r['packets-in']),
    packetsOut: num(r['packets-out']),
    disabled: parseYesNo(r['disabled']),
    dynamic: parseYesNo(r['dynamic']),
    comment: r['comment'],
  }));
}

// ---------------------------------------------------------------------------
// hotspot user profiles
// ---------------------------------------------------------------------------

export interface HotspotProfileInput {
  name: string;
  /** e.g. "10M/10M" */
  rateLimit?: string;
  sessionTimeout?: string;
  idleTimeout?: string;
  sharedUsers?: number;
  transparentProxy?: boolean;
  comment?: string;
}

export const hotspotProfileAdd = (input: HotspotProfileInput): string[] => [
  '/ip/hotspot/user/profile/add',
  ...setWords({
    name: input.name,
    'rate-limit': input.rateLimit,
    'session-timeout': input.sessionTimeout,
    'idle-timeout': input.idleTimeout,
    'shared-users': input.sharedUsers,
    'transparent-proxy': input.transparentProxy,
    comment: input.comment,
  }),
];

export const hotspotProfileList = (): string[] => ['/ip/hotspot/user/profile/print'];

export const hotspotProfileSet = (id: string, patch: Partial<HotspotProfileInput>): string[] => [
  '/ip/hotspot/user/profile/set',
  idWord(id),
  ...setWords({
    name: patch.name,
    'rate-limit': patch.rateLimit,
    'session-timeout': patch.sessionTimeout,
    'idle-timeout': patch.idleTimeout,
    'shared-users': patch.sharedUsers,
    'transparent-proxy': patch.transparentProxy,
    comment: patch.comment,
  }),
];

export const hotspotProfileRemove = (id: string): string[] => [
  '/ip/hotspot/user/profile/remove',
  idWord(id),
];

export function parseHotspotProfiles(replies: ReplySentence[]): HotspotProfile[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    rateLimit: r['rate-limit'],
    sessionTimeout: r['session-timeout'],
    idleTimeout: r['idle-timeout'],
    sharedUsers: num(r['shared-users']),
    transparentProxy: r['transparent-proxy'] === undefined ? undefined : parseYesNo(r['transparent-proxy']),
    comment: r['comment'],
  }));
}

// ---------------------------------------------------------------------------
// hotspot servers
// ---------------------------------------------------------------------------

export const hotspotServerList = (): string[] => ['/ip/hotspot/print'];

export function parseHotspotServers(replies: ReplySentence[]): HotspotServer[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    interface: r['interface'] ?? '',
    addressPool: r['address-pool'],
    profile: r['profile'],
    disabled: parseYesNo(r['disabled']),
  }));
}

// ---------------------------------------------------------------------------
// walled garden
// ---------------------------------------------------------------------------

export interface WalledGardenInput {
  server?: string;
  dstHost?: string;
  dstPort?: string;
  protocol?: string;
  action?: 'allow' | 'deny';
  comment?: string;
  disabled?: boolean;
}

export const walledGardenAdd = (input: WalledGardenInput): string[] => [
  '/ip/hotspot/walled-garden/add',
  ...setWords({
    server: input.server,
    'dst-host': input.dstHost,
    'dst-port': input.dstPort,
    protocol: input.protocol,
    action: input.action,
    comment: input.comment,
    disabled: input.disabled,
  }),
];

export const walledGardenList = (): string[] => ['/ip/hotspot/walled-garden/print'];

export const walledGardenRemove = (id: string): string[] => [
  '/ip/hotspot/walled-garden/remove',
  idWord(id),
];

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

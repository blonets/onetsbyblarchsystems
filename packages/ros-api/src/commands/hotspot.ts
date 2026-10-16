import { ReplySentence, replyRows } from '../protocol.js';
import { idWord, parseYesNo, queryWords, setWords } from './util.js';

/** Typed command builders for `/ip/hotspot/*`. Every builder returns one API sentence. */

// Device-row shapes (what the router returns over the wire). The app layer
// maps these onto the `@mtk/types` DB entities (which carry routerId,
// mikrotikId, …) — ros-api never fabricates those fields.
export interface HotspotUserRow {
  id: string;
  server: string;
  name: string;
  profile: string;
  uptime?: string;
  bytesIn?: number;
  bytesOut?: number;
  packetsIn?: number;
  packetsOut?: number;
  disabled: boolean;
  dynamic: boolean;
  comment?: string;
}

export interface HotspotProfileRow {
  id: string;
  name: string;
  rateLimit?: string;
  sessionTimeout?: string;
  idleTimeout?: string;
  sharedUsers?: number;
  transparentProxy?: boolean;
  comment?: string;
}

export interface HotspotServerRow {
  id: string;
  name: string;
  interface: string;
  addressPool?: string;
  profile?: string;
  disabled: boolean;
}

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

export function parseHotspotUsers(replies: ReplySentence[]): HotspotUserRow[] {
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

export const hotspotProfileEnable = (id: string): string[] => [
  '/ip/hotspot/user/profile/enable',
  idWord(id),
];

export const hotspotProfileDisable = (id: string): string[] => [
  '/ip/hotspot/user/profile/disable',
  idWord(id),
];

export function parseHotspotProfiles(replies: ReplySentence[]): HotspotProfileRow[] {
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

export interface HotspotServerInput {
  name: string;
  /** interface the hotspot listens on */
  interface: string;
  addressPool?: string;
  profile?: string;
  idleTimeout?: string;
  keepaliveTimeout?: string;
  loginBy?: string;
  comment?: string;
  disabled?: boolean;
}

export const hotspotServerAdd = (input: HotspotServerInput): string[] => [
  '/ip/hotspot/add',
  ...setWords({
    name: input.name,
    interface: input.interface,
    'address-pool': input.addressPool,
    profile: input.profile,
    'idle-timeout': input.idleTimeout,
    'keepalive-timeout': input.keepaliveTimeout,
    'login-by': input.loginBy,
    comment: input.comment,
    disabled: input.disabled,
  }),
];

export const hotspotServerSet = (id: string, patch: Partial<HotspotServerInput>): string[] => [
  '/ip/hotspot/set',
  idWord(id),
  ...setWords({
    name: patch.name,
    interface: patch.interface,
    'address-pool': patch.addressPool,
    profile: patch.profile,
    'idle-timeout': patch.idleTimeout,
    'keepalive-timeout': patch.keepaliveTimeout,
    'login-by': patch.loginBy,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const hotspotServerRemove = (id: string): string[] => ['/ip/hotspot/remove', idWord(id)];

export const hotspotServerEnable = (id: string): string[] => ['/ip/hotspot/enable', idWord(id)];

export const hotspotServerDisable = (id: string): string[] => ['/ip/hotspot/disable', idWord(id)];

export const hotspotServerList = (): string[] => ['/ip/hotspot/print'];

// ---------------------------------------------------------------------------
// hotspot server profiles (/ip/hotspot/profile)
// ---------------------------------------------------------------------------

export interface HotspotServerProfileInput {
  name: string;
  hotspotAddress?: string;
  dnsName?: string;
  htmlDirectory?: string;
  loginBy?: string;
  comment?: string;
}

export const hotspotServerProfileAdd = (input: HotspotServerProfileInput): string[] => [
  '/ip/hotspot/profile/add',
  ...setWords({
    name: input.name,
    'hotspot-address': input.hotspotAddress,
    'dns-name': input.dnsName,
    'html-directory': input.htmlDirectory,
    'login-by': input.loginBy,
    comment: input.comment,
  }),
];

export const hotspotServerProfileList = (): string[] => ['/ip/hotspot/profile/print'];

export const hotspotServerProfileSet = (
  id: string,
  patch: Partial<HotspotServerProfileInput>,
): string[] => [
  '/ip/hotspot/profile/set',
  idWord(id),
  ...setWords({
    name: patch.name,
    'hotspot-address': patch.hotspotAddress,
    'dns-name': patch.dnsName,
    'html-directory': patch.htmlDirectory,
    'login-by': patch.loginBy,
    comment: patch.comment,
  }),
];

export const hotspotServerProfileRemove = (id: string): string[] => [
  '/ip/hotspot/profile/remove',
  idWord(id),
];

export interface HotspotServerProfile {
  id: string;
  name: string;
  hotspotAddress?: string;
  dnsName?: string;
  htmlDirectory?: string;
  loginBy?: string;
  comment?: string;
}

export function parseHotspotServerProfiles(replies: ReplySentence[]): HotspotServerProfile[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    hotspotAddress: r['hotspot-address'],
    dnsName: r['dns-name'],
    htmlDirectory: r['html-directory'],
    loginBy: r['login-by'],
    comment: r['comment'],
  }));
}

// ---------------------------------------------------------------------------
// hotspot servers (print/parse)
// ---------------------------------------------------------------------------

export function parseHotspotServers(replies: ReplySentence[]): HotspotServerRow[] {
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

export const walledGardenSet = (id: string, patch: Partial<WalledGardenInput>): string[] => [
  '/ip/hotspot/walled-garden/set',
  idWord(id),
  ...setWords({
    server: patch.server,
    'dst-host': patch.dstHost,
    'dst-port': patch.dstPort,
    protocol: patch.protocol,
    action: patch.action,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const walledGardenRemove = (id: string): string[] => [
  '/ip/hotspot/walled-garden/remove',
  idWord(id),
];

export const walledGardenEnable = (id: string): string[] => [
  '/ip/hotspot/walled-garden/enable',
  idWord(id),
];

export const walledGardenDisable = (id: string): string[] => [
  '/ip/hotspot/walled-garden/disable',
  idWord(id),
];

export interface WalledGardenEntry {
  id: string;
  server?: string;
  dstHost?: string;
  dstPort?: string;
  protocol?: string;
  action?: string;
  comment?: string;
  disabled: boolean;
  dynamic: boolean;
}

export function parseWalledGarden(replies: ReplySentence[]): WalledGardenEntry[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    server: r['server'],
    dstHost: r['dst-host'],
    dstPort: r['dst-port'],
    protocol: r['protocol'],
    action: r['action'],
    comment: r['comment'],
    disabled: parseYesNo(r['disabled']),
    dynamic: parseYesNo(r['dynamic']),
  }));
}

// ---------------------------------------------------------------------------
// walled garden ip (/ip/hotspot/walled-garden/ip)
// ---------------------------------------------------------------------------

export interface WalledGardenIpInput {
  server?: string;
  dstAddress?: string;
  dstPort?: string;
  protocol?: string;
  action?: 'allow' | 'deny';
  comment?: string;
  disabled?: boolean;
}

export const walledGardenIpAdd = (input: WalledGardenIpInput): string[] => [
  '/ip/hotspot/walled-garden/ip/add',
  ...setWords({
    server: input.server,
    'dst-address': input.dstAddress,
    'dst-port': input.dstPort,
    protocol: input.protocol,
    action: input.action,
    comment: input.comment,
    disabled: input.disabled,
  }),
];

export const walledGardenIpList = (): string[] => ['/ip/hotspot/walled-garden/ip/print'];

export const walledGardenIpSet = (id: string, patch: Partial<WalledGardenIpInput>): string[] => [
  '/ip/hotspot/walled-garden/ip/set',
  idWord(id),
  ...setWords({
    server: patch.server,
    'dst-address': patch.dstAddress,
    'dst-port': patch.dstPort,
    protocol: patch.protocol,
    action: patch.action,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const walledGardenIpRemove = (id: string): string[] => [
  '/ip/hotspot/walled-garden/ip/remove',
  idWord(id),
];

export const walledGardenIpEnable = (id: string): string[] => [
  '/ip/hotspot/walled-garden/ip/enable',
  idWord(id),
];

export const walledGardenIpDisable = (id: string): string[] => [
  '/ip/hotspot/walled-garden/ip/disable',
  idWord(id),
];

export interface WalledGardenIpEntry {
  id: string;
  server?: string;
  dstAddress?: string;
  dstPort?: string;
  protocol?: string;
  action?: string;
  comment?: string;
  disabled: boolean;
  dynamic: boolean;
}

export function parseWalledGardenIp(replies: ReplySentence[]): WalledGardenIpEntry[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    server: r['server'],
    dstAddress: r['dst-address'],
    dstPort: r['dst-port'],
    protocol: r['protocol'],
    action: r['action'],
    comment: r['comment'],
    disabled: parseYesNo(r['disabled']),
    dynamic: parseYesNo(r['dynamic']),
  }));
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

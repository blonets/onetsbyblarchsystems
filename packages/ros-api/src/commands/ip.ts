import { ReplySentence, replyRows } from '../protocol.js';
import { idWord, parseYesNo, queryWords, setWords } from './util.js';

/** Typed command builders for `/ip/*` (neighbor, address, dhcp-server, pool). */

// ---------------------------------------------------------------------------
// neighbor discovery (MNDP/LLDP/CDP) — used for downstream device discovery
// ---------------------------------------------------------------------------

export const neighborList = (): string[] => ['/ip/neighbor/print'];

export interface IpNeighbor {
  id: string;
  interface?: string;
  macAddress?: string;
  identity?: string;
  platform?: string;
  version?: string;
  board?: string;
  address?: string;
}

export function parseNeighbors(replies: ReplySentence[]): IpNeighbor[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    interface: r['interface'],
    macAddress: r['mac-address'],
    identity: r['identity'],
    platform: r['platform'],
    version: r['version'],
    board: r['board'],
    address: r['address'],
  }));
}

// ---------------------------------------------------------------------------
// ip addresses (/ip/address)
// ---------------------------------------------------------------------------

export interface IpAddressInput {
  /** e.g. "192.168.88.1/24" */
  address: string;
  interface: string;
  network?: string;
  comment?: string;
  disabled?: boolean;
}

export const ipAddressAdd = (input: IpAddressInput): string[] => [
  '/ip/address/add',
  ...setWords({
    address: input.address,
    interface: input.interface,
    network: input.network,
    comment: input.comment,
    disabled: input.disabled,
  }),
];

export const ipAddressList = (filter: Record<string, string> = {}): string[] => [
  '/ip/address/print',
  ...queryWords(filter),
];

export const ipAddressSet = (id: string, patch: Partial<IpAddressInput>): string[] => [
  '/ip/address/set',
  idWord(id),
  ...setWords({
    address: patch.address,
    interface: patch.interface,
    network: patch.network,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const ipAddressRemove = (id: string): string[] => ['/ip/address/remove', idWord(id)];

export const ipAddressEnable = (id: string): string[] => ['/ip/address/enable', idWord(id)];

export const ipAddressDisable = (id: string): string[] => ['/ip/address/disable', idWord(id)];

export interface IpAddress {
  id: string;
  address: string;
  interface: string;
  network?: string;
  comment?: string;
  disabled: boolean;
  dynamic: boolean;
}

export function parseIpAddresses(replies: ReplySentence[]): IpAddress[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    address: r['address'] ?? '',
    interface: r['interface'] ?? '',
    network: r['network'],
    comment: r['comment'],
    disabled: parseYesNo(r['disabled']),
    dynamic: parseYesNo(r['dynamic']),
  }));
}

// ---------------------------------------------------------------------------
// dhcp server (/ip/dhcp-server)
// ---------------------------------------------------------------------------

export interface DhcpServerInput {
  name: string;
  interface: string;
  addressPool: string;
  /** e.g. "10m" */
  leaseTime?: string;
  authoritative?: boolean;
  comment?: string;
  disabled?: boolean;
}

export const dhcpServerAdd = (input: DhcpServerInput): string[] => [
  '/ip/dhcp-server/add',
  ...setWords({
    name: input.name,
    interface: input.interface,
    'address-pool': input.addressPool,
    'lease-time': input.leaseTime,
    authoritative: input.authoritative,
    comment: input.comment,
    disabled: input.disabled,
  }),
];

export const dhcpServerList = (): string[] => ['/ip/dhcp-server/print'];

export const dhcpServerSet = (id: string, patch: Partial<DhcpServerInput>): string[] => [
  '/ip/dhcp-server/set',
  idWord(id),
  ...setWords({
    name: patch.name,
    interface: patch.interface,
    'address-pool': patch.addressPool,
    'lease-time': patch.leaseTime,
    authoritative: patch.authoritative,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const dhcpServerRemove = (id: string): string[] => ['/ip/dhcp-server/remove', idWord(id)];

export const dhcpServerEnable = (id: string): string[] => ['/ip/dhcp-server/enable', idWord(id)];

export const dhcpServerDisable = (id: string): string[] => ['/ip/dhcp-server/disable', idWord(id)];

export interface DhcpServer {
  id: string;
  name: string;
  interface: string;
  addressPool?: string;
  leaseTime?: string;
  authoritative?: boolean;
  comment?: string;
  disabled: boolean;
}

export function parseDhcpServers(replies: ReplySentence[]): DhcpServer[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    interface: r['interface'] ?? '',
    addressPool: r['address-pool'],
    leaseTime: r['lease-time'],
    authoritative:
      r['authoritative'] === undefined ? undefined : parseYesNo(r['authoritative']),
    comment: r['comment'],
    disabled: parseYesNo(r['disabled']),
  }));
}

// ---------------------------------------------------------------------------
// dhcp server networks (/ip/dhcp-server/network)
// ---------------------------------------------------------------------------

export interface DhcpNetworkInput {
  /** e.g. "192.168.88.0/24" */
  address: string;
  gateway?: string;
  dnsServer?: string;
  comment?: string;
}

export const dhcpNetworkAdd = (input: DhcpNetworkInput): string[] => [
  '/ip/dhcp-server/network/add',
  ...setWords({
    address: input.address,
    gateway: input.gateway,
    'dns-server': input.dnsServer,
    comment: input.comment,
  }),
];

export const dhcpNetworkList = (): string[] => ['/ip/dhcp-server/network/print'];

export const dhcpNetworkSet = (id: string, patch: Partial<DhcpNetworkInput>): string[] => [
  '/ip/dhcp-server/network/set',
  idWord(id),
  ...setWords({
    address: patch.address,
    gateway: patch.gateway,
    'dns-server': patch.dnsServer,
    comment: patch.comment,
  }),
];

export const dhcpNetworkRemove = (id: string): string[] => [
  '/ip/dhcp-server/network/remove',
  idWord(id),
];

export interface DhcpNetwork {
  id: string;
  address: string;
  gateway?: string;
  dnsServer?: string;
  comment?: string;
}

export function parseDhcpNetworks(replies: ReplySentence[]): DhcpNetwork[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    address: r['address'] ?? '',
    gateway: r['gateway'],
    dnsServer: r['dns-server'],
    comment: r['comment'],
  }));
}

// ---------------------------------------------------------------------------
// ip pools (/ip/pool)
// ---------------------------------------------------------------------------

export interface IpPoolInput {
  name: string;
  /** e.g. "192.168.88.10-192.168.88.254" */
  ranges: string;
  comment?: string;
}

export const ipPoolAdd = (input: IpPoolInput): string[] => [
  '/ip/pool/add',
  ...setWords({ name: input.name, ranges: input.ranges, comment: input.comment }),
];

export const ipPoolList = (): string[] => ['/ip/pool/print'];

export const ipPoolSet = (id: string, patch: Partial<IpPoolInput>): string[] => [
  '/ip/pool/set',
  idWord(id),
  ...setWords({ name: patch.name, ranges: patch.ranges, comment: patch.comment }),
];

export const ipPoolRemove = (id: string): string[] => ['/ip/pool/remove', idWord(id)];

export interface IpPool {
  id: string;
  name: string;
  ranges?: string;
  comment?: string;
}

export function parseIpPools(replies: ReplySentence[]): IpPool[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    ranges: r['ranges'],
    comment: r['comment'],
  }));
}

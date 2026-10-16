import { ReplySentence, replyRows } from '../protocol.js';
import { idWord, parseYesNo, queryWords, setWords } from './util.js';

/** Typed command builders for `/ip/firewall/filter` and `/ip/firewall/nat`. */

// ---------------------------------------------------------------------------
// filter rules
// ---------------------------------------------------------------------------

export interface FilterRuleInput {
  chain: string; // input | forward | output | custom
  action: string; // accept | drop | reject | log | ...
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  srcPort?: string;
  dstPort?: string;
  inInterface?: string;
  outInterface?: string;
  comment?: string;
  disabled?: boolean;
  log?: boolean;
  /** insert before this rule id (RouterOS `place-before`) */
  placeBefore?: string;
}

export const filterRuleAdd = (input: FilterRuleInput): string[] => [
  '/ip/firewall/filter/add',
  ...setWords({
    chain: input.chain,
    action: input.action,
    protocol: input.protocol,
    'src-address': input.srcAddress,
    'dst-address': input.dstAddress,
    'src-port': input.srcPort,
    'dst-port': input.dstPort,
    'in-interface': input.inInterface,
    'out-interface': input.outInterface,
    comment: input.comment,
    disabled: input.disabled,
    log: input.log,
    'place-before': input.placeBefore,
  }),
];

export const filterRuleList = (filter: Record<string, string> = {}): string[] => [
  '/ip/firewall/filter/print',
  ...queryWords(filter),
];

export const filterRuleSet = (id: string, patch: Partial<FilterRuleInput>): string[] => [
  '/ip/firewall/filter/set',
  idWord(id),
  ...setWords({
    chain: patch.chain,
    action: patch.action,
    protocol: patch.protocol,
    'src-address': patch.srcAddress,
    'dst-address': patch.dstAddress,
    'src-port': patch.srcPort,
    'dst-port': patch.dstPort,
    'in-interface': patch.inInterface,
    'out-interface': patch.outInterface,
    comment: patch.comment,
    disabled: patch.disabled,
    log: patch.log,
  }),
];

export const filterRuleRemove = (id: string): string[] => [
  '/ip/firewall/filter/remove',
  idWord(id),
];

export const filterRuleEnable = (id: string): string[] => [
  '/ip/firewall/filter/enable',
  idWord(id),
];

export const filterRuleDisable = (id: string): string[] => [
  '/ip/firewall/filter/disable',
  idWord(id),
];

// ---------------------------------------------------------------------------
// nat rules (incl. the platform-managed `panel-proxy:<deviceId>` dst-nat rules)
// ---------------------------------------------------------------------------

export interface NatRuleInput {
  chain: string; // srcnat | dstnat
  action: string; // masquerade | dst-nat | src-nat | redirect | ...
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  dstPort?: string;
  inInterface?: string;
  outInterface?: string;
  toAddresses?: string;
  toPorts?: string;
  comment?: string;
  disabled?: boolean;
  /** insert before this rule id (RouterOS `place-before`) */
  placeBefore?: string;
}

export const natRuleAdd = (input: NatRuleInput): string[] => [
  '/ip/firewall/nat/add',
  ...setWords({
    chain: input.chain,
    action: input.action,
    protocol: input.protocol,
    'src-address': input.srcAddress,
    'dst-address': input.dstAddress,
    'dst-port': input.dstPort,
    'in-interface': input.inInterface,
    'out-interface': input.outInterface,
    'to-addresses': input.toAddresses,
    'to-ports': input.toPorts,
    comment: input.comment,
    disabled: input.disabled,
    'place-before': input.placeBefore,
  }),
];

export const natRuleList = (filter: Record<string, string> = {}): string[] => [
  '/ip/firewall/nat/print',
  ...queryWords(filter),
];

export const natRuleSet = (id: string, patch: Partial<NatRuleInput>): string[] => [
  '/ip/firewall/nat/set',
  idWord(id),
  ...setWords({
    chain: patch.chain,
    action: patch.action,
    protocol: patch.protocol,
    'src-address': patch.srcAddress,
    'dst-address': patch.dstAddress,
    'dst-port': patch.dstPort,
    'in-interface': patch.inInterface,
    'out-interface': patch.outInterface,
    'to-addresses': patch.toAddresses,
    'to-ports': patch.toPorts,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const natRuleRemove = (id: string): string[] => ['/ip/firewall/nat/remove', idWord(id)];

export const natRuleEnable = (id: string): string[] => ['/ip/firewall/nat/enable', idWord(id)];

export const natRuleDisable = (id: string): string[] => ['/ip/firewall/nat/disable', idWord(id)];

/**
 * Move a firewall rule within its chain. RouterOS `move`: `=destination=` is
 * the rule id to insert *before*.
 */
export const filterRuleMove = (id: string, destination: string): string[] => [
  '/ip/firewall/filter/move',
  idWord(id),
  `=destination=${destination}`,
];

export const natRuleMove = (id: string, destination: string): string[] => [
  '/ip/firewall/nat/move',
  idWord(id),
  `=destination=${destination}`,
];

// ---------------------------------------------------------------------------
// mangle rules
// ---------------------------------------------------------------------------

export interface MangleRuleInput {
  chain: string; // prerouting | forward | postrouting | input | output
  action: string; // mark-packet | mark-connection | mark-routing | accept | ...
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  srcPort?: string;
  dstPort?: string;
  inInterface?: string;
  outInterface?: string;
  newPacketMark?: string;
  newConnectionMark?: string;
  newRoutingMark?: string;
  passthrough?: boolean;
  comment?: string;
  disabled?: boolean;
  log?: boolean;
  /** insert before this rule id (RouterOS `place-before`) */
  placeBefore?: string;
}

export const mangleRuleAdd = (input: MangleRuleInput): string[] => [
  '/ip/firewall/mangle/add',
  ...setWords({
    chain: input.chain,
    action: input.action,
    protocol: input.protocol,
    'src-address': input.srcAddress,
    'dst-address': input.dstAddress,
    'src-port': input.srcPort,
    'dst-port': input.dstPort,
    'in-interface': input.inInterface,
    'out-interface': input.outInterface,
    'new-packet-mark': input.newPacketMark,
    'new-connection-mark': input.newConnectionMark,
    'new-routing-mark': input.newRoutingMark,
    passthrough: input.passthrough,
    comment: input.comment,
    disabled: input.disabled,
    log: input.log,
    'place-before': input.placeBefore,
  }),
];

export const mangleRuleList = (filter: Record<string, string> = {}): string[] => [
  '/ip/firewall/mangle/print',
  ...queryWords(filter),
];

export const mangleRuleSet = (id: string, patch: Partial<MangleRuleInput>): string[] => [
  '/ip/firewall/mangle/set',
  idWord(id),
  ...setWords({
    chain: patch.chain,
    action: patch.action,
    protocol: patch.protocol,
    'src-address': patch.srcAddress,
    'dst-address': patch.dstAddress,
    'src-port': patch.srcPort,
    'dst-port': patch.dstPort,
    'in-interface': patch.inInterface,
    'out-interface': patch.outInterface,
    'new-packet-mark': patch.newPacketMark,
    'new-connection-mark': patch.newConnectionMark,
    'new-routing-mark': patch.newRoutingMark,
    passthrough: patch.passthrough,
    comment: patch.comment,
    disabled: patch.disabled,
    log: patch.log,
  }),
];

export const mangleRuleRemove = (id: string): string[] => [
  '/ip/firewall/mangle/remove',
  idWord(id),
];

export const mangleRuleEnable = (id: string): string[] => [
  '/ip/firewall/mangle/enable',
  idWord(id),
];

export const mangleRuleDisable = (id: string): string[] => [
  '/ip/firewall/mangle/disable',
  idWord(id),
];

export const mangleRuleMove = (id: string, destination: string): string[] => [
  '/ip/firewall/mangle/move',
  idWord(id),
  `=destination=${destination}`,
];

export interface MangleRule {
  id: string;
  chain: string;
  action: string;
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  srcPort?: string;
  dstPort?: string;
  inInterface?: string;
  outInterface?: string;
  newPacketMark?: string;
  newConnectionMark?: string;
  newRoutingMark?: string;
  comment?: string;
  disabled: boolean;
  dynamic: boolean;
  bytes?: number;
  packets?: number;
}

export function parseMangleRules(replies: ReplySentence[]): MangleRule[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    chain: r['chain'] ?? '',
    action: r['action'] ?? '',
    protocol: r['protocol'],
    srcAddress: r['src-address'],
    dstAddress: r['dst-address'],
    srcPort: r['src-port'],
    dstPort: r['dst-port'],
    inInterface: r['in-interface'],
    outInterface: r['out-interface'],
    newPacketMark: r['new-packet-mark'],
    newConnectionMark: r['new-connection-mark'],
    newRoutingMark: r['new-routing-mark'],
    comment: r['comment'],
    disabled: parseYesNo(r['disabled']),
    dynamic: parseYesNo(r['dynamic']),
    bytes: num(r['bytes']),
    packets: num(r['packets']),
  }));
}

// ---------------------------------------------------------------------------
// address lists
// ---------------------------------------------------------------------------

export interface AddressListInput {
  list: string;
  address: string;
  comment?: string;
  disabled?: boolean;
  /** e.g. "1d" — entry auto-expires */
  timeout?: string;
}

export const addressListAdd = (input: AddressListInput): string[] => [
  '/ip/firewall/address-list/add',
  ...setWords({
    list: input.list,
    address: input.address,
    comment: input.comment,
    disabled: input.disabled,
    timeout: input.timeout,
  }),
];

export const addressListList = (filter: Record<string, string> = {}): string[] => [
  '/ip/firewall/address-list/print',
  ...queryWords(filter),
];

export const addressListSet = (id: string, patch: Partial<AddressListInput>): string[] => [
  '/ip/firewall/address-list/set',
  idWord(id),
  ...setWords({
    list: patch.list,
    address: patch.address,
    comment: patch.comment,
    disabled: patch.disabled,
    timeout: patch.timeout,
  }),
];

export const addressListRemove = (id: string): string[] => [
  '/ip/firewall/address-list/remove',
  idWord(id),
];

export const addressListEnable = (id: string): string[] => [
  '/ip/firewall/address-list/enable',
  idWord(id),
];

export const addressListDisable = (id: string): string[] => [
  '/ip/firewall/address-list/disable',
  idWord(id),
];

export interface AddressListEntry {
  id: string;
  list: string;
  address: string;
  comment?: string;
  disabled: boolean;
  dynamic: boolean;
  timeout?: string;
}

export function parseAddressList(replies: ReplySentence[]): AddressListEntry[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    list: r['list'] ?? '',
    address: r['address'] ?? '',
    comment: r['comment'],
    disabled: parseYesNo(r['disabled']),
    dynamic: parseYesNo(r['dynamic']),
    timeout: r['timeout'],
  }));
}

/**
 * Build the platform-managed proxy rule that exposes a downstream device
 * (camera, printer, cascaded MikroTik…) on the site router's WAN side.
 * The rule is tagged `panel-proxy:<deviceId>` so the platform can find,
 * update and garbage-collect exactly its own rules.
 */
export const downstreamProxyRuleAdd = (
  deviceId: string,
  proxyPort: number,
  deviceIp: string,
  devicePort: number,
): string[] =>
  natRuleAdd({
    chain: 'dstnat',
    action: 'dst-nat',
    protocol: 'tcp',
    dstPort: String(proxyPort),
    toAddresses: deviceIp,
    toPorts: String(devicePort),
    comment: `panel-proxy:${deviceId}`,
  });

/** Device-row shape for filter/nat rules (see note on HotspotUserRow). */
export interface FirewallRuleRow {
  id: string;
  chain: string;
  action: string;
  srcAddress?: string;
  dstAddress?: string;
  protocol?: string;
  srcPort?: string;
  dstPort?: string;
  inInterface?: string;
  outInterface?: string;
  toAddresses?: string;
  toPorts?: string;
  comment?: string;
  disabled: boolean;
  dynamic: boolean;
  /** 'platform' = managed by us (e.g. panel-proxy:*); 'device' = pre-existing. */
  source: 'platform' | 'device';
  bytes?: number;
  packets?: number;
}

export function parseFirewallRules(replies: ReplySentence[]): FirewallRuleRow[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    chain: r['chain'] ?? '',
    action: r['action'] ?? '',
    srcAddress: r['src-address'],
    dstAddress: r['dst-address'],
    protocol: r['protocol'],
    srcPort: r['src-port'],
    dstPort: r['dst-port'],
    inInterface: r['in-interface'],
    outInterface: r['out-interface'],
    toAddresses: r['to-addresses'],
    toPorts: r['to-ports'],
    comment: r['comment'],
    disabled: parseYesNo(r['disabled']),
    dynamic: parseYesNo(r['dynamic']),
    source: (r['comment'] ?? '').startsWith('panel-proxy:') ? 'platform' : 'device',
    bytes: num(r['bytes']),
    packets: num(r['packets']),
  }));
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

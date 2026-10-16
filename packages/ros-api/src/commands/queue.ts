import { ReplySentence, replyRows } from '../protocol.js';
import { idWord, parseYesNo, setWords } from './util.js';

/** Typed command builders for `/queue/simple`. */

export interface SimpleQueueInput {
  name: string;
  /** e.g. "192.168.88.0/24" or "ether2" */
  target: string;
  /** e.g. "10M/10M" */
  maxLimit?: string;
  limitAt?: string;
  burstLimit?: string;
  burstTime?: string;
  priority?: string;
  comment?: string;
  disabled?: boolean;
}

export const simpleQueueAdd = (input: SimpleQueueInput): string[] => [
  '/queue/simple/add',
  ...setWords({
    name: input.name,
    target: input.target,
    'max-limit': input.maxLimit,
    'limit-at': input.limitAt,
    'burst-limit': input.burstLimit,
    'burst-time': input.burstTime,
    priority: input.priority,
    comment: input.comment,
    disabled: input.disabled,
  }),
];

export const simpleQueueList = (): string[] => ['/queue/simple/print'];

export const simpleQueueSet = (id: string, patch: Partial<SimpleQueueInput>): string[] => [
  '/queue/simple/set',
  idWord(id),
  ...setWords({
    name: patch.name,
    target: patch.target,
    'max-limit': patch.maxLimit,
    'limit-at': patch.limitAt,
    'burst-limit': patch.burstLimit,
    'burst-time': patch.burstTime,
    priority: patch.priority,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const simpleQueueRemove = (id: string): string[] => ['/queue/simple/remove', idWord(id)];

export const simpleQueueEnable = (id: string): string[] => ['/queue/simple/enable', idWord(id)];

export const simpleQueueDisable = (id: string): string[] => ['/queue/simple/disable', idWord(id)];

export const simpleQueueMove = (id: string, destination: string): string[] => [
  '/queue/simple/move',
  idWord(id),
  `=destination=${destination}`,
];

// ---------------------------------------------------------------------------
// queue tree (/queue/tree)
// ---------------------------------------------------------------------------

export interface QueueTreeInput {
  name: string;
  /** parent queue name, e.g. "global" or another queue tree item */
  parent: string;
  packetMark?: string;
  /** e.g. "10M/10M" */
  maxLimit?: string;
  limitAt?: string;
  burstLimit?: string;
  burstTime?: string;
  priority?: string;
  comment?: string;
  disabled?: boolean;
  /** insert before this item id (RouterOS `place-before`) */
  placeBefore?: string;
}

export const queueTreeAdd = (input: QueueTreeInput): string[] => [
  '/queue/tree/add',
  ...setWords({
    name: input.name,
    parent: input.parent,
    'packet-mark': input.packetMark,
    'max-limit': input.maxLimit,
    'limit-at': input.limitAt,
    'burst-limit': input.burstLimit,
    'burst-time': input.burstTime,
    priority: input.priority,
    comment: input.comment,
    disabled: input.disabled,
    'place-before': input.placeBefore,
  }),
];

export const queueTreeList = (): string[] => ['/queue/tree/print'];

export const queueTreeSet = (id: string, patch: Partial<QueueTreeInput>): string[] => [
  '/queue/tree/set',
  idWord(id),
  ...setWords({
    name: patch.name,
    parent: patch.parent,
    'packet-mark': patch.packetMark,
    'max-limit': patch.maxLimit,
    'limit-at': patch.limitAt,
    'burst-limit': patch.burstLimit,
    'burst-time': patch.burstTime,
    priority: patch.priority,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const queueTreeRemove = (id: string): string[] => ['/queue/tree/remove', idWord(id)];

export const queueTreeEnable = (id: string): string[] => ['/queue/tree/enable', idWord(id)];

export const queueTreeDisable = (id: string): string[] => ['/queue/tree/disable', idWord(id)];

export const queueTreeMove = (id: string, destination: string): string[] => [
  '/queue/tree/move',
  idWord(id),
  `=destination=${destination}`,
];

export interface QueueTreeItem {
  id: string;
  name: string;
  parent: string;
  packetMark?: string;
  maxLimit?: string;
  limitAt?: string;
  burstLimit?: string;
  priority?: string;
  disabled: boolean;
  dynamic: boolean;
  comment?: string;
}

export function parseQueueTree(replies: ReplySentence[]): QueueTreeItem[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    parent: r['parent'] ?? '',
    packetMark: r['packet-mark'],
    maxLimit: r['max-limit'],
    limitAt: r['limit-at'],
    burstLimit: r['burst-limit'],
    priority: r['priority'],
    disabled: parseYesNo(r['disabled']),
    dynamic: parseYesNo(r['dynamic']),
    comment: r['comment'],
  }));
}

/** Device-row shape for `/queue/simple` (see note on HotspotUserRow). */
export interface SimpleQueueRow {
  id: string;
  name: string;
  target: string;
  maxLimit?: string;
  limitAt?: string;
  burstLimit?: string;
  priority?: string;
  disabled: boolean;
  dynamic: boolean;
  comment?: string;
}

export function parseSimpleQueues(replies: ReplySentence[]): SimpleQueueRow[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    target: r['target'] ?? '',
    maxLimit: r['max-limit'],
    limitAt: r['limit-at'],
    burstLimit: r['burst-limit'],
    priority: r['priority'],
    disabled: parseYesNo(r['disabled']),
    dynamic: parseYesNo(r['dynamic']),
    comment: r['comment'],
  }));
}

import type { QueueItem } from '@mtk/types';
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

export function parseSimpleQueues(replies: ReplySentence[]): QueueItem[] {
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

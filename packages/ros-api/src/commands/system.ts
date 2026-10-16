import { ReplySentence, replyRows } from '../protocol.js';
import { setWords } from './util.js';

/** Typed command builders for system-level commands. */

export const resourcePrint = (): string[] => ['/system/resource/print'];

export interface SystemResource {
  'board-name'?: string;
  version?: string;
  'build-time'?: string;
  architecture?: string;
  'cpu-load'?: string;
  'free-memory'?: string;
  'total-memory'?: string;
  uptime?: string;
  [key: string]: string | undefined;
}

export function parseResource(replies: ReplySentence[]): SystemResource {
  const rows = replyRows(replies);
  return { ...(rows[0] ?? {}) };
}

export const identityPrint = (): string[] => ['/system/identity/print'];

/**
 * Set `/system identity`. The platform stamps `comment=panel-uuid:<uuid>` so a
 * router can always be matched back to its DB row even after a rename.
 */
export const identitySet = (name: string, uuid?: string): string[] => [
  '/system/identity/set',
  `=name=${name}`,
  ...(uuid ? [`=comment=panel-uuid:${uuid}`] : []),
];

export function parseIdentity(replies: ReplySentence[]): { name?: string; comment?: string } {
  const row = replyRows(replies)[0] ?? {};
  return { name: row['name'], comment: row['comment'] };
}

/** Schedule a binary backup on the device (retrieval is a worker TODO — see jobs). */
export const backupSave = (name: string, password?: string): string[] => [
  '/system/backup/save',
  `=name=${name}`,
  ...setWords({ password }),
];

/** Export the running config (`/export`); optionally to a file on the device. */
export const configExport = (file?: string): string[] => [
  '/export',
  ...setWords({ file }),
];

export const reboot = (): string[] => ['/system/reboot'];

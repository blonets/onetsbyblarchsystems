import { ReplySentence, replyRows } from '../protocol.js';
import { idWord, parseYesNo, setWords } from './util.js';

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
 * Set `/system identity` name. NOTE: identity exposes ONLY `name` (no `comment`
 * property — verified against the official Identity docs). The platform's
 * `panel-uuid:<uuid>` stamp belongs in `/system note` (see {@link systemNoteSet}).
 */
export const identitySet = (name: string): string[] => ['/system/identity/set', `=name=${name}`];

export function parseIdentity(replies: ReplySentence[]): { name?: string } {
  const row = replyRows(replies)[0] ?? {};
  return { name: row['name'] };
}

// ---------------------------------------------------------------------------
// system note (carries the platform's panel-uuid:<uuid> stamp — see identitySet)
// ---------------------------------------------------------------------------

export const systemNotePrint = (): string[] => ['/system/note/print'];

export const systemNoteSet = (note: string): string[] => ['/system/note/set', `=note=${note}`];

export function parseSystemNote(replies: ReplySentence[]): { note?: string } {
  const row = replyRows(replies)[0] ?? {};
  return { note: row['note'] };
}

// ---------------------------------------------------------------------------
// scheduler
// ---------------------------------------------------------------------------

export interface SchedulerInput {
  name: string;
  /** script source run on schedule */
  onEvent: string;
  /** e.g. "1m", "00:00:00" */
  interval?: string;
  startDate?: string;
  startTime?: string;
  comment?: string;
  disabled?: boolean;
}

export const schedulerAdd = (input: SchedulerInput): string[] => [
  '/system/scheduler/add',
  ...setWords({
    name: input.name,
    'on-event': input.onEvent,
    interval: input.interval,
    'start-date': input.startDate,
    'start-time': input.startTime,
    comment: input.comment,
    disabled: input.disabled,
  }),
];

export const schedulerList = (): string[] => ['/system/scheduler/print'];

export const schedulerSet = (id: string, patch: Partial<SchedulerInput>): string[] => [
  '/system/scheduler/set',
  idWord(id),
  ...setWords({
    name: patch.name,
    'on-event': patch.onEvent,
    interval: patch.interval,
    'start-date': patch.startDate,
    'start-time': patch.startTime,
    comment: patch.comment,
    disabled: patch.disabled,
  }),
];

export const schedulerRemove = (id: string): string[] => ['/system/scheduler/remove', idWord(id)];

export const schedulerEnable = (id: string): string[] => ['/system/scheduler/enable', idWord(id)];

export const schedulerDisable = (id: string): string[] => ['/system/scheduler/disable', idWord(id)];

export interface SystemScheduler {
  id: string;
  name: string;
  onEvent?: string;
  interval?: string;
  startDate?: string;
  startTime?: string;
  comment?: string;
  disabled: boolean;
}

export function parseSchedulers(replies: ReplySentence[]): SystemScheduler[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    onEvent: r['on-event'],
    interval: r['interval'],
    startDate: r['start-date'],
    startTime: r['start-time'],
    comment: r['comment'],
    disabled: parseYesNo(r['disabled']),
  }));
}

// ---------------------------------------------------------------------------
// scripts
// ---------------------------------------------------------------------------

export interface ScriptInput {
  name: string;
  source: string;
  comment?: string;
}

export const scriptAdd = (input: ScriptInput): string[] => [
  '/system/script/add',
  ...setWords({ name: input.name, source: input.source, comment: input.comment }),
];

export const scriptList = (): string[] => ['/system/script/print'];

export const scriptSet = (id: string, patch: Partial<ScriptInput>): string[] => [
  '/system/script/set',
  idWord(id),
  ...setWords({ name: patch.name, source: patch.source, comment: patch.comment }),
];

export const scriptRemove = (id: string): string[] => ['/system/script/remove', idWord(id)];

export const scriptRun = (id: string): string[] => ['/system/script/run', idWord(id)];

export interface SystemScript {
  id: string;
  name: string;
  source?: string;
  comment?: string;
}

export function parseScripts(replies: ReplySentence[]): SystemScript[] {
  return replyRows(replies).map((r) => ({
    id: r['.id'] ?? '',
    name: r['name'] ?? '',
    source: r['source'],
    comment: r['comment'],
  }));
}

// ---------------------------------------------------------------------------
// misc system reads
// ---------------------------------------------------------------------------

export const routerboardPrint = (): string[] => ['/system/routerboard/print'];

export const packageList = (): string[] => ['/system/package/print'];

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

/**
 * Collect the raw config lines of a `/export` fetch. The device returns the
 * script text as `!re` sentences; this joins their payload words (everything
 * after the `!re` head) into the export text.
 */
export function exportText(replies: ReplySentence[]): string {
  return replies
    .filter((r) => r.type === 're')
    .flatMap((r) => r.raw.slice(1))
    .join('\n');
}

export const reboot = (): string[] => ['/system/reboot'];

/**
 * Backup job — real implementation (canonical {@link BackupJob} contract).
 *
 * Per job `{ opId, routerId, backupType }` (`'both'` runs export + binary):
 * - binary: `/system/backup/save name=<ts>.backup` → wait for the file →
 *   FTP RETR (router's `ftpPort`; binary files can't cross the API protocol)
 *   → delete the file from the device → encrypt → store
 * - export: `/export file=<ts>.rsc` → wait → FTP RETR → delete → encrypt → store
 *   (live-validated on 6.49.17: a bare `/export` returns just `!done`, so the
 *   file route is the only working path)
 *
 * Payloads are AES-256-GCM encrypted (crypto.ts) before hitting the object
 * store. A canonical {@link BackupRecord} (sha256, size, retentionUntil) goes
 * to the backup index; the retention janitor deletes expired rows + objects.
 * Each completed backup emits `backup.completed`.
 *
 * Restore requests (`restoreBackupId` set) are routed to the restore
 * processor (jobs/restore.job.ts) by the queue dispatcher in main.ts.
 */

import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import {
  backupSave,
  configExport,
  replyRows,
  type ReplySentence,
  type RosConnection,
} from '@mtk/ros-api';
import type { BackupJob, BackupRecord, BackupType } from '@mtk/types';
import type { ConnectionManager } from '../connection-manager.js';
import { filePrint, fileRemove } from '../ros-ext.js';
import { ftpGet } from '../ftp.js';
import { encryptBackup, resolveBackupKey, serializeEnvelope } from '../crypto.js';
import type { ObjectStore } from '../object-store.js';
import type { AuditSink } from '../audit.js';
import { InMemoryAuditSink, makeAuditEvent } from '../audit.js';
import type { EventBus } from '../queues.js';
import { InMemoryEventBus } from '../queues.js';

export interface BackupIndex {
  put(record: BackupRecord): Promise<void>;
  get(id: string): Promise<BackupRecord | undefined>;
  listExpired(nowIso: string): Promise<BackupRecord[]>;
  delete(id: string): Promise<void>;
}

export class InMemoryBackupIndex implements BackupIndex {
  private readonly rows = new Map<string, BackupRecord>();

  async put(record: BackupRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async get(id: string): Promise<BackupRecord | undefined> {
    return this.rows.get(id);
  }

  async listExpired(nowIso: string): Promise<BackupRecord[]> {
    return [...this.rows.values()].filter((r) => r.retentionUntil <= nowIso);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

/** FTP credentials for a router — resolved from the vaulted router record. */
export interface FtpCredentials {
  port: number;
  user: string;
  password: string;
}

export interface BackupDeps {
  manager: ConnectionManager;
  /** routerId → tunnel host + FTP credentials (vaulted, runtime only) */
  ftpCredentials: (routerId: string) => Promise<{ host: string } & FtpCredentials>;
  store: ObjectStore;
  index: BackupIndex;
  audit?: AuditSink;
  events?: EventBus;
  /** retention in days (default 30) */
  retentionDays?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface BackupResult {
  backupId: string;
  routerId: string;
  type: BackupType;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Object-store key layout: backups/<routerId>/<ts>-<type>.enc */
export const backupObjectKey = (routerId: string, ts: string, type: string): string =>
  `backups/${routerId}/${ts}-${type}.enc`;

export function createBackupProcessor(deps: BackupDeps) {
  const audit = deps.audit ?? new InMemoryAuditSink();
  const events = deps.events ?? new InMemoryEventBus();
  const retentionDays = deps.retentionDays ?? 30;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const at = () => new Date(now()).toISOString();
  const kmsKeyId = process.env.BACKUP_KMS_KEY_ID ?? 'env:BACKUP_KMS_KEY';

  return async (job: Job<BackupJob>): Promise<BackupResult[]> => {
    const { opId, routerId, backupType } = job.data;
    const types: BackupType[] = backupType === 'both' ? ['export', 'binary'] : [backupType];
    const results: BackupResult[] = [];
    for (const type of types) {
      results.push(await runOne(opId, routerId, type));
    }
    return results;
  };

  async function runOne(opId: string, routerId: string, type: BackupType): Promise<BackupResult> {
    const started = new Date(now());
    const stamp = started.toISOString().replace(/[:.]/g, '-');
    await audit.record(
      makeAuditEvent({
        actorType: 'system', action: `backup.${type}`, entityType: 'router',
        entityId: routerId, opId, result: 'pending',
      }),
    );

    try {
      const plaintext =
        type === 'binary'
          ? await fetchBinaryBackup(routerId, stamp, sleep)
          : await fetchExport(routerId, stamp, sleep);

      const sha256 = createHash('sha256').update(plaintext).digest('hex');
      const envelope = encryptBackup(plaintext, resolveBackupKey());
      const storageKey = backupObjectKey(routerId, stamp, type);
      await deps.store.put(storageKey, Buffer.from(serializeEnvelope(envelope), 'utf8'), {
        contentType: 'application/json',
      });

      const record: BackupRecord = {
        id: `${opId}-${type}`,
        routerId,
        type,
        fileName: type === 'binary' ? `${stamp}.backup` : `${stamp}.rsc`,
        storageKey,
        sizeBytes: String(plaintext.length),
        sha256,
        kmsKeyId,
        createdAt: started.toISOString(),
        retentionUntil: new Date(started.getTime() + retentionDays * 86_400_000).toISOString(),
      };
      await deps.index.put(record);
      await audit.record(
        makeAuditEvent({
          actorType: 'system', action: `backup.${type}`, entityType: 'router',
          entityId: routerId, opId, result: 'done',
          after: { backupId: record.id, sizeBytes: record.sizeBytes, sha256 },
        }),
      );
      await events.emit({
        event: 'backup.completed',
        payload: { routerId, backupId: record.id, type, at: at() },
      });
      return {
        backupId: record.id, routerId, type,
        sizeBytes: plaintext.length, sha256, storageKey,
      };
    } catch (err) {
      await audit.record(
        makeAuditEvent({
          actorType: 'system', action: `backup.${type}`, entityType: 'router',
          entityId: routerId, opId, result: 'failed', error: (err as Error).message,
        }),
      );
      throw err;
    }
  }

  /** Binary flow: save on-device, FTP-download, delete from device. */
  async function fetchBinaryBackup(
    routerId: string,
    stamp: string,
    sleepFn: (ms: number) => Promise<void>,
  ): Promise<Buffer> {
    const name = `panel-backup-${stamp}.backup`;
    const creds = await deps.ftpCredentials(routerId);
    await deps.manager.execute(routerId, async (conn) => {
      await conn.talk(backupSave(name));
      await waitForFile(conn, name, sleepFn);
    });
    try {
      return await ftpGet(
        { host: creds.host, port: creds.port, user: creds.user, password: creds.password },
        name,
      );
    } finally {
      // never leave backup files on the device, even when the download failed
      await removeDeviceFile(routerId, name);
    }
  }

  /** Export flow: `/export file=` → wait → FTP-download → delete from device. */
  async function fetchExport(
    routerId: string,
    stamp: string,
    sleepFn: (ms: number) => Promise<void>,
  ): Promise<Buffer> {
    const name = await exportFileToDevice(routerId, stamp, sleepFn);
    const creds = await deps.ftpCredentials(routerId);
    try {
      return await ftpGet(
        { host: creds.host, port: creds.port, user: creds.user, password: creds.password },
        name,
      );
    } finally {
      // never leave export files on the device, even when the download failed
      await removeDeviceFile(routerId, name);
    }
  }

  /** Write an `/export` file on the device and wait until it is complete. */
  async function exportFileToDevice(
    routerId: string,
    stamp: string,
    sleepFn: (ms: number) => Promise<void>,
  ): Promise<string> {
    const name = `panel-export-${stamp}.rsc`;
    await deps.manager.execute(routerId, async (conn) => {
      await conn.talk(configExport(name));
      await waitForFile(conn, name, sleepFn);
    });
    return name;
  }

  /** Remove a file from the device by name (best-effort, never throws). */
  async function removeDeviceFile(routerId: string, name: string): Promise<void> {
    await deps.manager
      .execute(routerId, (conn) => removeFileByName(conn, name))
      .catch(() => undefined);
  }
}

/**
 * Write an `/export` file on the device and wait until it is complete.
 * Exported for live validation (the full job continues with FTP download).
 */
export async function exportFileToDevice(
  manager: ConnectionManager,
  routerId: string,
  stamp: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<string> {
  const name = `panel-export-${stamp}.rsc`;
  await manager.execute(routerId, async (conn) => {
    await conn.talk(configExport(name));
    await waitForFile(conn, name, sleep);
  });
  return name;
}

/** Remove a file from the device by name (best-effort, never throws). */
export async function removeDeviceFile(
  manager: ConnectionManager,
  routerId: string,
  name: string,
): Promise<void> {
  await manager
    .execute(routerId, (conn) => removeFileByName(conn, name))
    .catch(() => undefined);
}

/**
 * Poll /file/print until the backup file appears (save can take seconds).
 * A transient `<name>.in_progress` file means the save is still running —
 * keep waiting until the final name appears (rosapi-agent live finding).
 * Live-verified on 6.49.17: `/export file=` returns `!done` immediately but
 * the file lands asynchronously, occasionally taking ~25 s — budget 60 s.
 */
async function waitForFile(
  conn: RosConnection,
  name: string,
  sleep: (ms: number) => Promise<void>,
  tries = 30,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const rows = replyRows(await conn.talk(filePrint()));
    const names = new Set(rows.map((r) => r['name']));
    if (names.has(name) && !names.has(`${name}.in_progress`)) return;
    await sleep(2000);
  }
  throw new Error(`backup file ${name} never appeared on the device`);
}

async function removeFileByName(conn: RosConnection, name: string): Promise<void> {
  const rows = replyRows(await conn.talk(filePrint({ name })));
  const id = rows.find((r) => r['name'] === name)?.['.id'];
  if (id) await conn.talk(fileRemove(id));
}

/**
 * Reassemble `/export` output from API reply sentences (kept for RouterOS
 * versions that stream export text; 6.49.17 returns bare `!done` instead —
 * the file route above is the live-validated path).
 */
export function exportTextFromReplies(replies: ReplySentence[]): string {
  const lines: string[] = [];
  for (const r of replies) {
    if (r.type !== 're') continue;
    const words = r.raw.slice(1).filter((w) => !w.startsWith('=') && !w.startsWith('.'));
    if (words.length > 0) lines.push(words.join(' '));
    // some RouterOS versions pack the line into `=value=` instead
    const value = r.attrs['value'] ?? r.attrs['ret'];
    if (value && words.length === 0) lines.push(value);
  }
  return lines.join('\n');
}

/** Stagger daily backups across 02:00–05:00 local by router hash (ARCH §3.4). */
export function backupCronForRouter(routerId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < routerId.length; i++) {
    h ^= routerId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const slot = (h >>> 0) % 180; // 180 minutes in 02:00–05:00
  const minute = slot % 60;
  const hour = 2 + Math.floor(slot / 60);
  return `${minute} ${hour} * * *`;
}

/** Retention janitor — repeatable daily: delete expired backups + objects. */
export function createBackupJanitorProcessor(deps: {
  store: ObjectStore;
  index: BackupIndex;
  audit?: AuditSink;
  now?: () => number;
}) {
  const audit = deps.audit ?? new InMemoryAuditSink();
  const now = deps.now ?? Date.now;

  return async (): Promise<{ deleted: number }> => {
    const at = new Date(now()).toISOString();
    const expired = await deps.index.listExpired(at);
    for (const record of expired) {
      await deps.store.delete(record.storageKey).catch(() => undefined);
      await deps.index.delete(record.id);
      await audit.record(
        makeAuditEvent({
          actorType: 'system', action: 'backup.janitor', entityType: 'router',
          entityId: record.routerId, opId: `backup-janitor-${record.id}`, result: 'done',
          after: { backupId: record.id, storageKey: record.storageKey },
        }),
      );
    }
    return { deleted: expired.length };
  };
}

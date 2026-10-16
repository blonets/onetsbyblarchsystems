/**
 * Restore job — decrypt a stored backup and push it back to the router.
 * Dispatched from the backup queue when `BackupJob.restoreBackupId` is set.
 *
 * - export kind: upload `<id>.rsc` over FTP, then `/import file-name=<f>`
 * - binary kind: upload `<id>.backup` over FTP, then
 *   `/system/backup/load name=<f>` — **this reboots the router** and replaces
 *   its entire configuration. Binary restores are operator-confirmed only;
 *   the job refuses to run them when `allowBinaryRestore` is false.
 *
 * Restores are recorded as canonical {@link AuditEvent}s and emit
 * `config.changed`.
 */

import type { Job } from 'bullmq';
import type { BackupJob, BackupType } from '@mtk/types';
import type { ConnectionManager } from '../connection-manager.js';
import { backupLoad, importFile, fileRemove, filePrint } from '../ros-ext.js';
import { ftpPut } from '../ftp.js';
import { decryptBackup, parseEnvelope, resolveBackupKey } from '../crypto.js';
import type { ObjectStore } from '../object-store.js';
import type { BackupIndex, FtpCredentials } from './backup.job.js';
import { replyRows } from '@mtk/ros-api';
import type { AuditSink } from '../audit.js';
import { InMemoryAuditSink, makeAuditEvent } from '../audit.js';
import type { EventBus } from '../queues.js';
import { InMemoryEventBus } from '../queues.js';

export interface RestoreDeps {
  manager: ConnectionManager;
  ftpCredentials: (routerId: string) => Promise<{ host: string } & FtpCredentials>;
  store: ObjectStore;
  index: BackupIndex;
  audit?: AuditSink;
  events?: EventBus;
  /** binary restores reboot the router — default false (refuse) */
  allowBinaryRestore?: boolean;
  now?: () => number;
}

export function createRestoreProcessor(deps: RestoreDeps) {
  const audit = deps.audit ?? new InMemoryAuditSink();
  const events = deps.events ?? new InMemoryEventBus();
  const now = deps.now ?? Date.now;
  const at = () => new Date(now()).toISOString();

  return async (job: Job<BackupJob>): Promise<{ backupId: string; type: BackupType }> => {
    const { opId, routerId, restoreBackupId } = job.data;
    if (!restoreBackupId) throw new Error('restore processor requires restoreBackupId');
    const backupId = restoreBackupId;
    const record = await deps.index.get(backupId);
    if (!record) throw new Error(`unknown backup: ${backupId}`);
    if (record.routerId !== routerId) {
      throw new Error(`backup ${backupId} belongs to router ${record.routerId}, not ${routerId}`);
    }
    if (record.type === 'binary' && !deps.allowBinaryRestore) {
      throw new Error(
        'binary restore refused: /system/backup/load reboots the router — set allowBinaryRestore explicitly',
      );
    }

    await audit.record(
      makeAuditEvent({
        actorType: 'system', action: 'backup.restore', entityType: 'router',
        entityId: routerId, opId, result: 'pending', after: { backupId, type: record.type },
      }),
    );

    try {
      const stored = await deps.store.get(record.storageKey);
      const plaintext = decryptBackup(parseEnvelope(stored.toString('utf8')), resolveBackupKey());
      const creds = await deps.ftpCredentials(routerId);
      const remoteName = `panel-restore-${backupId}.${record.type === 'binary' ? 'backup' : 'rsc'}`;

      await ftpPut(
        { host: creds.host, port: creds.port, user: creds.user, password: creds.password },
        remoteName,
        plaintext,
      );
      await deps.manager.execute(routerId, async (conn) => {
        if (record.type === 'binary') {
          await conn.talk(backupLoad(remoteName));
        } else {
          await conn.talk(importFile(remoteName));
          // clean up the uploaded script; binary restores reboot so cleanup
          // happens on next contact via the janitor
          const rows = replyRows(await conn.talk(filePrint({ name: remoteName })));
          const id = rows.find((r) => r['name'] === remoteName)?.['.id'];
          if (id) await conn.talk(fileRemove(id));
        }
      });

      await audit.record(
        makeAuditEvent({
          actorType: 'system', action: 'backup.restore', entityType: 'router',
          entityId: routerId, opId, result: 'done', after: { backupId, type: record.type },
        }),
      );
      await events.emit({
        event: 'config.changed',
        payload: { routerId, domain: 'system', action: 'backup.restore', opId, at: at() },
      });
      return { backupId, type: record.type };
    } catch (err) {
      await audit.record(
        makeAuditEvent({
          actorType: 'system', action: 'backup.restore', entityType: 'router',
          entityId: routerId, opId, result: 'failed', error: (err as Error).message,
        }),
      );
      throw err;
    }
  };
}

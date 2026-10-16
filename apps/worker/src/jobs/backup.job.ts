import type { Job } from 'bullmq';
import type { ConnectionManager } from '../connection-manager.js';

export interface BackupJobData {
  routerId: string;
  kind: 'binary' | 'export';
}

export interface BackupDeps {
  manager: ConnectionManager;
  /** TODO: S3-compatible object storage put. */
  storeBackup: (
    routerId: string,
    kind: 'binary' | 'export',
    filename: string,
    payload: Uint8Array,
  ) => Promise<void>;
}

/**
 * Backup job — STUB.
 *
 * Intended flow:
 *  1. `manager.ensure(routerId)` for a live session
 *  2. binary → `talk(backupSave(name))`, then download the `.backup` file
 *     export → `talk(configExport())` and capture the text
 *  3. `storeBackup(...)` to object storage + insert the `Backup` row via the API
 *
 * File download is NOT possible over the binary API protocol — it needs FTP /
 * API-SSL / SCP. TODO: implement retrieval over FTP (port comes from
 * `Router.ftpPort`; the hub runs FTP on 8921) or SCP, then flip
 * this stub to the real flow above.
 */
export function createBackupProcessor(_deps: BackupDeps) {
  return async (job: Job<BackupJobData>): Promise<never> => {
    throw new Error(
      `TODO: backup retrieval for router ${job.data.routerId} is not implemented yet (see src/jobs/backup.job.ts)`,
    );
  };
}

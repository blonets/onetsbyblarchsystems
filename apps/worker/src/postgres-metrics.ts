/**
 * Deploy-time repository implementations backed by PostgreSQL + TimescaleDB.
 *
 * Schema: `migrations/001-metrics.sql` (run it before starting the worker).
 * Connection: `DATABASE_URL` env var.
 *
 * NOTE: metrics themselves flow through the `metrics-ingest` BullMQ queue
 * (canonical contract) — the worker never writes metric hypertables
 * directly. These repositories cover the downtime ledger and the backup
 * index, which the worker owns.
 *
 * These implementations are complete but were authored in an environment
 * without a live Postgres — run an integration pass (`migrations/001`
 * applied to a real TimescaleDB) before trusting them in production. The
 * unit-test suite exercises the same interfaces through the in-memory fakes.
 */

import { Pool } from 'pg';
import { newOpId, type BackupRecord, type DowntimeEntry } from '@mtk/types';
import type { DowntimeRepository } from './downtime.js';
import type { BackupIndex } from './jobs/backup.job.js';

let sharedPool: Pool | undefined;

/** Lazily-created shared pool from DATABASE_URL. */
export function pool(): Pool {
  if (!sharedPool) {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL is not set');
    sharedPool = new Pool({ connectionString: url, max: 10 });
  }
  return sharedPool;
}

export class PostgresDowntimeRepository implements DowntimeRepository {
  constructor(private readonly db: Pool = pool()) {}

  async open(routerId: string, startedAt: string, cause?: string): Promise<void> {
    await this.db.query(
      `INSERT INTO downtime_ledger (id, router_id, started_at, cause)
       SELECT $1, $2, $3, $4
       WHERE NOT EXISTS (
         SELECT 1 FROM downtime_ledger
         WHERE router_id = $2 AND ended_at IS NULL
       )`,
      [newOpId(), routerId, startedAt, cause ?? null],
    );
  }

  async close(routerId: string, endedAt: string): Promise<DowntimeEntry | null> {
    const { rows } = await this.db.query(
      `UPDATE downtime_ledger
         SET ended_at = $2,
             duration_s = EXTRACT(EPOCH FROM ($2::timestamptz - started_at))::bigint
         WHERE id = (
           SELECT id FROM downtime_ledger
           WHERE router_id = $1 AND ended_at IS NULL
           ORDER BY started_at DESC LIMIT 1
         )
       RETURNING id, router_id, started_at, ended_at, duration_s, cause`,
      [routerId, endedAt],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row['id'] as string,
      routerId: row['router_id'] as string,
      startedAt: (row['started_at'] as Date).toISOString(),
      endedAt: (row['ended_at'] as Date).toISOString(),
      durationS: Number(row['duration_s']),
      cause: (row['cause'] as string) ?? null,
    };
  }

  async list(routerId: string): Promise<DowntimeEntry[]> {
    const { rows } = await this.db.query(
      `SELECT id, router_id, started_at, ended_at, duration_s, cause
         FROM downtime_ledger WHERE router_id = $1 ORDER BY started_at ASC`,
      [routerId],
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: row['id'] as string,
      routerId: row['router_id'] as string,
      startedAt: (row['started_at'] as Date).toISOString(),
      endedAt: row['ended_at'] ? (row['ended_at'] as Date).toISOString() : null,
      durationS: row['duration_s'] !== null ? Number(row['duration_s']) : null,
      cause: (row['cause'] as string) ?? null,
    }));
  }
}

export class PostgresBackupIndex implements BackupIndex {
  constructor(private readonly db: Pool = pool()) {}

  async put(record: BackupRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO backups
         (id, router_id, type, file_name, storage_key, size_bytes, sha256,
          kms_key_id, created_at, retention_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         storage_key = EXCLUDED.storage_key, size_bytes = EXCLUDED.size_bytes,
         sha256 = EXCLUDED.sha256, retention_until = EXCLUDED.retention_until`,
      [
        record.id, record.routerId, record.type, record.fileName,
        record.storageKey, record.sizeBytes, record.sha256,
        record.kmsKeyId, record.createdAt, record.retentionUntil,
      ],
    );
  }

  async get(id: string): Promise<BackupRecord | undefined> {
    const { rows } = await this.db.query(`SELECT * FROM backups WHERE id = $1`, [id]);
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: row['id'] as string,
      routerId: row['router_id'] as string,
      type: row['type'] as BackupRecord['type'],
      fileName: row['file_name'] as string,
      storageKey: row['storage_key'] as string,
      sizeBytes: String(row['size_bytes']),
      sha256: row['sha256'] as string,
      kmsKeyId: row['kms_key_id'] as string,
      createdAt: (row['created_at'] as Date).toISOString(),
      retentionUntil: (row['retention_until'] as Date).toISOString(),
    };
  }

  async listExpired(nowIso: string): Promise<BackupRecord[]> {
    const { rows } = await this.db.query(
      `SELECT id FROM backups WHERE retention_until <= $1 ORDER BY retention_until ASC`,
      [nowIso],
    );
    const out: BackupRecord[] = [];
    for (const row of rows as Array<Record<string, unknown>>) {
      const rec = await this.get(row['id'] as string);
      if (rec) out.push(rec);
    }
    return out;
  }

  async delete(id: string): Promise<void> {
    await this.db.query(`DELETE FROM backups WHERE id = $1`, [id]);
  }
}

/** Write a poller gap event (deploy-time; in-memory GapTracker feeds this). */
export async function recordPollGap(
  db: Pool,
  routerId: string,
  atIso: string,
  gapSec: number,
): Promise<void> {
  await db.query(`INSERT INTO poll_gaps (ts, router_id, gap_sec) VALUES ($1,$2,$3)`, [
    atIso, routerId, gapSec,
  ]);
}

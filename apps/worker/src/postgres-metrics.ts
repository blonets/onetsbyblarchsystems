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
      `INSERT INTO "Downtime" ("id", "routerId", "startedAt", "cause")
       SELECT $1, $2, $3::timestamptz, $4
       WHERE EXISTS (SELECT 1 FROM "Router" WHERE "id" = $2)
         AND NOT EXISTS (
           SELECT 1 FROM "Downtime"
           WHERE "routerId" = $2 AND "endedAt" IS NULL
         )`,
      [newOpId(), routerId, startedAt, cause ?? null],
    );
  }

  async close(routerId: string, endedAt: string): Promise<DowntimeEntry | null> {
    const { rows } = await this.db.query(
      `UPDATE "Downtime"
         SET "endedAt" = $2::timestamptz,
             "durationS" = GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - "startedAt"))::int)
         WHERE "id" = (
           SELECT "id" FROM "Downtime"
           WHERE "routerId" = $1 AND "endedAt" IS NULL
           ORDER BY "startedAt" DESC LIMIT 1
         )
       RETURNING "id", "routerId", "startedAt", "endedAt", "durationS", "cause"`,
      [routerId, endedAt],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row['id'] as string,
      routerId: row['routerId'] as string,
      startedAt: (row['startedAt'] as Date).toISOString(),
      endedAt: (row['endedAt'] as Date).toISOString(),
      durationS: Number(row['durationS']),
      cause: (row['cause'] as string) ?? null,
    };
  }

  async list(routerId: string): Promise<DowntimeEntry[]> {
    const { rows } = await this.db.query(
      `SELECT "id", "routerId", "startedAt", "endedAt", "durationS", "cause"
         FROM "Downtime" WHERE "routerId" = $1 ORDER BY "startedAt" ASC`,
      [routerId],
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: row['id'] as string,
      routerId: row['routerId'] as string,
      startedAt: (row['startedAt'] as Date).toISOString(),
      endedAt: row['endedAt'] ? (row['endedAt'] as Date).toISOString() : null,
      durationS: row['durationS'] !== null ? Number(row['durationS']) : null,
      cause: (row['cause'] as string) ?? null,
    }));
  }
}

export class PostgresBackupIndex implements BackupIndex {
  constructor(private readonly db: Pool = pool()) {}

  async put(record: BackupRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO "Backup"
         ("id", "routerId", "type", "fileName", "storageKey", "sizeBytes", "sha256",
          "kmsKeyId", "createdAt", "retentionUntil")
       VALUES ($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9::timestamptz,$10::timestamptz)
       ON CONFLICT ("id") DO UPDATE SET
         "storageKey" = EXCLUDED."storageKey", "sizeBytes" = EXCLUDED."sizeBytes",
         "sha256" = EXCLUDED."sha256", "retentionUntil" = EXCLUDED."retentionUntil"`,
      [
        record.id, record.routerId, record.type, record.fileName,
        record.storageKey, record.sizeBytes, record.sha256,
        record.kmsKeyId, record.createdAt, record.retentionUntil,
      ],
    );
  }

  async get(id: string): Promise<BackupRecord | undefined> {
    const { rows } = await this.db.query(`SELECT * FROM "Backup" WHERE "id" = $1`, [id]);
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: row['id'] as string,
      routerId: row['routerId'] as string,
      type: row['type'] as BackupRecord['type'],
      fileName: row['fileName'] as string,
      storageKey: row['storageKey'] as string,
      sizeBytes: String(row['sizeBytes']),
      sha256: row['sha256'] as string,
      kmsKeyId: row['kmsKeyId'] as string,
      createdAt: (row['createdAt'] as Date).toISOString(),
      retentionUntil: (row['retentionUntil'] as Date).toISOString(),
    };
  }

  async listExpired(nowIso: string): Promise<BackupRecord[]> {
    const { rows } = await this.db.query(
      `SELECT "id" FROM "Backup" WHERE "retentionUntil" <= $1::timestamptz ORDER BY "retentionUntil" ASC`,
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
    await this.db.query(`DELETE FROM "Backup" WHERE "id" = $1`, [id]);
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

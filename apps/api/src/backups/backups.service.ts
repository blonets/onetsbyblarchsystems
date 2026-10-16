import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { newOpId, type BackupRecord, type BackupSchedule, type BackupType } from '@mtk/types';
import { AuditService } from '../audit/audit.service.js';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import { EventsService } from '../events/events.module.js';
import { JOBS_PORT, type JobsPort } from '../jobs/jobs.module.js';
import { REALTIME_PORT, type RealtimePort } from '../realtime/realtime.port.js';

export interface UpsertScheduleInput {
  type: BackupType | 'both';
  cron: string;
  enabled: boolean;
  retentionDays: number;
}

/** Posted by the worker when a backup job finishes. */
export interface BackupCompletedPayload {
  opId: string;
  routerId: string;
  type: BackupType;
  fileName: string;
  storageKey: string;
  sizeBytes: string; // serialized bigint
  sha256: string;
  kmsKeyId: string;
  retentionUntil: string; // ISO-8601
}

const CRON_RE = /^(\S+\s+){4}\S+$/;

/**
 * Backups — schedule CRUD, backup records, run-now, and restore.
 *
 * The API never touches the router: backups and restores are BullMQ `backup`
 * jobs executed by the worker (export + binary dump, AES-256-GCM encrypted at
 * rest, checksums stored). Restore is admin-only and always audited.
 */
@Injectable()
export class BackupsService {
  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    @Inject(JOBS_PORT) private readonly jobs: JobsPort,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  private async routerOrThrow(routerId: string): Promise<void> {
    const router = await this.db.routers.findUnique({ id: routerId });
    if (!router) throw new NotFoundException(`router ${routerId} not found`);
  }

  // ------------------------------------------------------------- schedules --

  async listSchedules(routerId: string): Promise<BackupSchedule[]> {
    await this.routerOrThrow(routerId);
    const rows = await this.db.backupSchedules.findMany({ where: { routerId } });
    return rows.map(toScheduleDto);
  }

  async upsertSchedule(routerId: string, input: UpsertScheduleInput, actor?: CurrentUserType): Promise<BackupSchedule> {
    await this.routerOrThrow(routerId);
    if (!CRON_RE.test(input.cron.trim())) {
      throw new BadRequestException('cron must be a 5-field cron expression, e.g. "0 2 * * *"');
    }
    if (input.retentionDays < 1 || input.retentionDays > 365) {
      throw new BadRequestException('retentionDays must be between 1 and 365');
    }
    const row = await this.db.backupSchedules.upsert(
      { routerId, type: input.type },
      {
        routerId,
        type: input.type,
        cron: input.cron.trim(),
        enabled: input.enabled,
        retentionDays: input.retentionDays,
      },
      { cron: input.cron.trim(), enabled: input.enabled, retentionDays: input.retentionDays },
    );
    await this.audit.append({
      actorId: actor?.sub ?? null,
      routerId,
      action: 'backup.schedule.upsert',
      after: { type: input.type, cron: row.cron, enabled: row.enabled },
      result: 'done',
    });
    return toScheduleDto(row);
  }

  async deleteSchedule(routerId: string, type: string, actor?: CurrentUserType): Promise<void> {
    await this.routerOrThrow(routerId);
    const row = await this.db.backupSchedules.findFirst({ routerId, type });
    if (!row) throw new NotFoundException(`backup schedule ${type} not found`);
    await this.db.backupSchedules.delete({ id: row.id });
    await this.audit.append({
      actorId: actor?.sub ?? null,
      routerId,
      action: 'backup.schedule.delete',
      before: { type: row.type },
      result: 'done',
    });
  }

  // --------------------------------------------------------------- records --

  async listBackups(routerId: string, page = 1, pageSize = 50): Promise<{ items: BackupRecord[]; total: number }> {
    await this.routerOrThrow(routerId);
    const size = Math.min(pageSize, 500);
    const total = await this.db.backups.count({ routerId });
    const rows = await this.db.backups.findMany({
      where: { routerId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * size,
      take: size,
    });
    return { items: rows.map(toRecordDto), total };
  }

  // -------------------------------------------------------------- run/restore --

  /**
   * Enqueue an immediate backup (`backupType: 'both'` runs /export + binary).
   */
  async runNow(routerId: string, actor?: CurrentUserType): Promise<{ opId: string; jobId: string }> {
    await this.routerOrThrow(routerId);
    const opId = newOpId();
    const { id: auditId } = await this.audit.append({
      actorId: actor?.sub ?? null,
      routerId,
      action: 'backup.run',
      opId,
      result: 'pending',
    });
    const job = await this.jobs.add(
      'backup',
      'backup.run',
      { kind: 'backup', opId, routerId, backupType: 'both', auditId },
      { jobId: opId },
    );
    return { opId, jobId: job.id };
  }

  /**
   * One-click restore (admin only — enforced by the controller). The worker
   * decrypts the blob and imports it (`/import` for text exports,
   * `/system/backup/load` + reboot for binary).
   */
  async restore(backupId: string, actor?: CurrentUserType): Promise<{ opId: string; jobId: string }> {
    const backup = await this.db.backups.findUnique({ id: backupId });
    if (!backup) throw new NotFoundException(`backup ${backupId} not found`);
    const opId = newOpId();
    const { id: auditId } = await this.audit.append({
      actorId: actor?.sub ?? null,
      routerId: backup.routerId,
      action: 'backup.restore',
      opId,
      before: { backupId, fileName: backup.fileName, type: backup.type },
      result: 'pending',
    });
    const job = await this.jobs.add(
      'backup',
      'backup.restore',
      {
        kind: 'backup',
        opId,
        routerId: backup.routerId,
        backupType: backup.type as BackupType,
        restoreBackupId: backupId,
        auditId,
      },
      { jobId: opId },
    );
    return { opId, jobId: job.id };
  }

  /**
   * Worker/internal endpoint: record a finished backup, settle the audit,
   * emit `backup.completed` and push realtime.
   */
  async reportCompleted(payload: BackupCompletedPayload): Promise<BackupRecord> {
    const row = await this.db.backups.create({
      routerId: payload.routerId,
      type: payload.type,
      fileName: payload.fileName,
      storageKey: payload.storageKey,
      sizeBytes: BigInt(payload.sizeBytes),
      sha256: payload.sha256,
      kmsKeyId: payload.kmsKeyId,
      retentionUntil: new Date(payload.retentionUntil),
    });
    await this.audit.settle(payload.opId, 'done');
    const at = new Date().toISOString();
    this.events.emitEvent('backup.completed', {
      routerId: payload.routerId,
      backupId: row.id,
      type: payload.type,
      at,
    });
    this.realtime.emitToRouter(payload.routerId, 'backup.completed', { backupId: row.id, type: payload.type, at });
    return toRecordDto(row);
  }
}

function toScheduleDto(r: {
  id: string; routerId: string; type: string; cron: string; enabled: boolean;
  retentionDays: number; createdAt: Date; updatedAt: Date;
}): BackupSchedule {
  return {
    id: r.id,
    routerId: r.routerId,
    type: r.type as BackupSchedule['type'],
    cron: r.cron,
    enabled: r.enabled,
    retentionDays: r.retentionDays,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toRecordDto(r: {
  id: string; routerId: string; type: string; fileName: string; storageKey: string;
  sizeBytes: bigint; sha256: string; kmsKeyId: string; retentionUntil: Date; createdAt: Date;
}): BackupRecord {
  return {
    id: r.id,
    routerId: r.routerId,
    type: r.type as BackupType,
    fileName: r.fileName,
    storageKey: r.storageKey,
    sizeBytes: String(r.sizeBytes),
    sha256: r.sha256,
    kmsKeyId: r.kmsKeyId,
    retentionUntil: r.retentionUntil.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

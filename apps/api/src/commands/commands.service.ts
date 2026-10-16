import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { newOpId, type CommandResultPayload, type RosCommandJob } from '@mtk/types';
import { AuditService } from '../audit/audit.service.js';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import { EventsService } from '../events/events.module.js';
import { JOBS_PORT, type JobsPort } from '../jobs/jobs.module.js';
import { REALTIME_PORT, type RealtimePort } from '../realtime/realtime.port.js';

/**
 * Internal (non-bus) event name for raw discovery rows posted by
 * reportResult(). Consumed only by DownstreamService — NOT part of the
 * stable Phase-2 bus contract.
 */
export const DISCOVERY_RAW_EVENT = 'internal:downstream.discovered.raw';

export interface EnqueueRosInput {
  routerId: string;
  /** Action name, e.g. 'hotspot.user.create'. Also the BullMQ job name. */
  action: string;
  /** Ordered RouterOS API sentences (word arrays) built with @mtk/ros-api. */
  sentences: string[][];
  /** Idempotency key; generated when omitted. Re-enqueue with the same opId is a no-op. */
  opId?: string;
  actorId?: string | null;
  before?: unknown;
  /** Must NEVER contain plaintext secrets — redact before calling. */
  after?: unknown;
  /**
   * Mirror-row pointer for mikrotikId reconciliation on success.
   * Stored inside the audit `after` as `entity`.
   */
  entity?: { table: string; id: string };
  /** Filter-table changes pass safe-apply; the worker verifies reachability after apply. */
  safeApply?: { verifyAfterMs: number };
  /** Dispatches result rows to a domain ingest handler (e.g. downstream discovery). */
  resultTag?: RosCommandJob['resultTag'];
  attempts?: number;
}

export interface EnqueuedCommand {
  opId: string;
  auditId: string;
  jobId: string;
  /** True when the opId was already known (idempotent replay, nothing enqueued). */
  replayed: boolean;
}

const CONFIG_CHANGED_DOMAINS: Record<string, 'hotspot' | 'firewall' | 'queues' | 'system'> = {
  hotspot: 'hotspot',
  firewall: 'firewall',
  queue: 'queues',
  queues: 'queues',
  downstream: 'system',
  backup: 'system',
};

/**
 * RouterCommandsService — the ONLY way panel code sends config to routers.
 *
 * Flow: validate opId (idempotency) → AuditLog(pending) → BullMQ `commands`
 * queue (jobId = opId, so the queue itself dedupes) → worker executes over the
 * tunnel → worker POSTs the outcome to /internal/commands/results →
 * audit settled + realtime push + `config.changed` bus event.
 *
 * The API never opens a router connection. Sentence words may carry plaintext
 * secrets (e.g. hotspot user passwords); they live transiently in Redis and
 * the worker MUST redact them before logging. Audit `after` snapshots must
 * already be redacted by the caller.
 */
@Injectable()
export class RouterCommandsService {
  private readonly logger = new Logger(RouterCommandsService.name);

  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    @Inject(JOBS_PORT) private readonly jobs: JobsPort,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  async requireRouter(routerId: string): Promise<void> {
    const router = await this.db.routers.findUnique({ id: routerId });
    if (!router) throw new NotFoundException(`router ${routerId} not found`);
    if (router.status === 'decommissioned') {
      throw new NotFoundException(`router ${routerId} is decommissioned`);
    }
  }

  async enqueueRos(input: EnqueueRosInput): Promise<EnqueuedCommand> {
    await this.requireRouter(input.routerId);
    const opId = input.opId ?? newOpId();

    // Idempotency: the opId is the AuditLog PK-equivalent. A replayed opId
    // returns the original outcome instead of enqueueing a duplicate.
    const existing = await this.db.auditLogs.findUnique({ opId });
    if (existing) {
      return { opId, auditId: existing.id, jobId: opId, replayed: true };
    }

    // The entity pointer + resultTag travel in the audit row so
    // reportResult() can reconcile mirrors and dispatch tagged results
    // without trusting the worker to echo them back.
    const afterBase = (input.after as Record<string, unknown> | undefined) ?? {};
    const extras: Record<string, unknown> = {};
    if (input.entity) extras.entity = input.entity;
    if (input.resultTag) extras.resultTag = input.resultTag;
    const after: unknown =
      Object.keys(afterBase).length > 0 || Object.keys(extras).length > 0
        ? { ...afterBase, ...extras }
        : null;

    const { id: auditId } = await this.audit.append({
      actorId: input.actorId ?? null,
      routerId: input.routerId,
      action: input.action,
      opId,
      before: input.before ?? null,
      after,
      result: 'pending',
    });

    const payload: RosCommandJob = {
      kind: 'ros',
      opId,
      routerId: input.routerId,
      sentences: input.sentences,
      auditId,
    };
    if (input.safeApply) payload.safeApply = input.safeApply;
    if (input.resultTag) payload.resultTag = input.resultTag;
    if (input.attempts) payload.attempts = input.attempts;

    const job = await this.jobs.add('commands', input.action, payload, {
      jobId: opId,
      attempts: input.attempts ?? 3,
    });
    return { opId, auditId, jobId: job.id, replayed: false };
  }

  /** Enqueue a quota-enforcer run for one router. */
  async enqueueQuota(routerId: string, actor?: CurrentUserType): Promise<EnqueuedCommand> {
    await this.requireRouter(routerId);
    const opId = newOpId();
    const { id: auditId } = await this.audit.append({
      actorId: actor?.sub ?? null,
      routerId,
      action: 'quota.enforce',
      opId,
      result: 'pending',
    });
    const job = await this.jobs.add(
      'quota',
      'quota.enforce',
      { kind: 'quota', opId, routerId },
      { jobId: opId },
    );
    return { opId, auditId, jobId: job.id, replayed: false };
  }

  /**
   * Handle a worker-posted command result (POST /internal/commands/results).
   * Settles the audit row, reconciles the device `.id` into the DB mirror,
   * pushes realtime, emits `config.changed`, and dispatches tagged results
   * (e.g. downstream discovery rows) to their ingest handler.
   */
  async reportResult(payload: CommandResultPayload): Promise<void> {
    const audit = await this.db.auditLogs.findUnique({ opId: payload.opId });
    if (!audit) {
      this.logger.warn(`result for unknown opId ${payload.opId} — ignoring`);
      return;
    }
    await this.audit.settle(payload.opId, payload.ok ? 'done' : 'failed', payload.error);

    const rows = payload.rows ?? [];
    if (payload.ok && rows.length > 0) {
      await this.reconcileMirror(audit, rows[0]);
    }

    if (audit.routerId) {
      this.realtime.emitToRouter(audit.routerId, 'command.result', {
        opId: payload.opId,
        action: audit.action,
        ok: payload.ok,
        error: payload.error ?? null,
        at: new Date().toISOString(),
      });

      if (payload.ok) {
        const domainKey = audit.action.split('.')[0] ?? '';
        const domain = CONFIG_CHANGED_DOMAINS[domainKey] ?? 'system';
        this.events.emitEvent('config.changed', {
          routerId: audit.routerId,
          domain,
          action: audit.action,
          opId: payload.opId,
          actorId: audit.actorId ?? undefined,
          at: new Date().toISOString(),
        });
      }

      const tag = (audit.after as { resultTag?: string } | null)?.resultTag;
      if (tag === 'downstream-discover') {
        // Internal (non-stable-bus) handoff: the downstream module subscribes.
        // Rows are raw reply records; the downstream ingest normalizes both
        // raw (`mac-address`) and parsed (`macAddress`) key shapes.
        this.events.emit(DISCOVERY_RAW_EVENT, { routerId: audit.routerId, rows });
      }
    }
  }

  /**
   * Reconcile the device-side `.id` into the platform mirror row after a
   * successful add. `audit.after.entity = { table, id }` is set by the
   * enqueueing service; the row update targets that table's mikrotikId.
   */
  private async reconcileMirror(
    audit: { after: unknown },
    row: Record<string, string>,
  ): Promise<void> {
    const deviceId = row['.id'] ?? row['id'] ?? row['ret'];
    if (!deviceId) return;
    const entity = (audit.after as { entity?: { table: string; id: string } } | null)?.entity;
    if (!entity) return;
    try {
      switch (entity.table) {
        case 'hotspot-user':
          await this.db.hotspotUsers.update({ id: entity.id }, { mikrotikId: deviceId });
          break;
        case 'hotspot-server':
          await this.db.hotspotServers.update({ id: entity.id }, { mikrotikId: deviceId });
          break;
        case 'hotspot-profile':
          await this.db.hotspotProfiles.update({ id: entity.id }, { mikrotikId: deviceId });
          break;
        case 'hotspot-user-profile':
          await this.db.hotspotUserProfiles.update({ id: entity.id }, { mikrotikId: deviceId });
          break;
        case 'hotspot-walled-garden':
          await this.db.hotspotWalledGardens.update({ id: entity.id }, { mikrotikId: deviceId });
          break;
        case 'hotspot': {
          const user = await this.db.hotspotUsers.findUnique({ id: entity.id });
          if (user) {
            await this.db.hotspotUsers.update({ id: entity.id }, { mikrotikId: deviceId });
            break;
          }
          const server = await this.db.hotspotServers.findUnique({ id: entity.id });
          if (server) {
            await this.db.hotspotServers.update({ id: entity.id }, { mikrotikId: deviceId });
            break;
          }
          const userProfile = await this.db.hotspotUserProfiles.findUnique({ id: entity.id });
          if (userProfile) {
            await this.db.hotspotUserProfiles.update({ id: entity.id }, { mikrotikId: deviceId });
            break;
          }
          const profile = await this.db.hotspotProfiles.findUnique({ id: entity.id });
          if (profile) {
            await this.db.hotspotProfiles.update({ id: entity.id }, { mikrotikId: deviceId });
            break;
          }
          const wg = await this.db.hotspotWalledGardens.findUnique({ id: entity.id });
          if (wg) {
            await this.db.hotspotWalledGardens.update({ id: entity.id }, { mikrotikId: deviceId });
            break;
          }
          break;
        }
        case 'firewall':
          await this.db.firewallRules.update({ id: entity.id }, { mikrotikId: deviceId });
          break;
        case 'queue':
          await this.db.queues.update({ id: entity.id }, { mikrotikId: deviceId });
          break;
      }
    } catch (err) {
      // Reconciliation is best-effort: the command succeeded on-device; a
      // later poller reconciliation pass can heal the mirror.
      this.logger.warn(`mirror reconcile failed for ${entity.table}:${entity.id}: ${(err as Error).message}`);
    }
  }
}

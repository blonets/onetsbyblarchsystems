import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  newOpId,
  type BusEventName,
  type BusEventPayload,
  type NotificationChannel,
  type NotificationRule,
  type NotifyJob,
} from '@mtk/types';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort, type NewNotificationRule } from '../db/database.port.js';
import type { NotificationRuleRow } from '../db/rows.js';
import { EventsService } from '../events/events.module.js';
import { JOBS_PORT, type JobsPort } from '../jobs/jobs.module.js';

export interface CreateRuleInput {
  name: string;
  event: BusEventName;
  channel: NotificationChannel;
  target: string;
  template?: string | null;
}

export interface UpdateRuleInput {
  name?: string;
  event?: BusEventName;
  channel?: NotificationChannel;
  target?: string;
  template?: string | null;
  enabled?: boolean;
}

/** Bus events that can trigger notification rules. */
const SUBSCRIBED_EVENTS: BusEventName[] = [
  'router.online',
  'router.offline',
  'hotspot.user.login',
  'hotspot.user.logout',
  'quota.exceeded',
  'backup.completed',
  'config.changed',
  'alert.raised',
];

/**
 * Notifications — rule CRUD + fan-out plumbing.
 *
 * On every subscribed bus event, all enabled rules for that event are
 * enqueued as `notify` jobs (one per rule). The worker's `notify` consumer
 * performs the actual Telegram/email delivery.
 *
 * NEEDS-CONFIG: delivery requires channel credentials
 * (`TELEGRAM_BOT_TOKEN` / `SMTP_*`). Without them the worker fails the job
 * with a clear configuration error — sends are NEVER faked or swallowed.
 * This service only routes; it never sends anything itself.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    @Inject(JOBS_PORT) private readonly jobs: JobsPort,
    private readonly events: EventsService,
  ) {}

  onModuleInit(): void {
    for (const event of SUBSCRIBED_EVENTS) {
      this.events.onEvent(event, (payload) => {
        this.fanOut(event, payload as BusEventPayload[BusEventName]).catch((err) =>
          this.logger.error(`notify fan-out failed for ${event}: ${(err as Error).message}`),
        );
      });
    }
  }

  private async fanOut(event: BusEventName, payload: Record<string, unknown>): Promise<void> {
    const rules = await this.db.notificationRules.findMany({ where: { event, enabled: true } });
    for (const rule of rules) {
      const job: NotifyJob = {
        kind: 'notify',
        opId: newOpId(),
        event,
        payload,
        ruleId: rule.id,
        channel: rule.channel as NotificationChannel,
        target: rule.target,
        template: rule.template ?? undefined,
      };
      await this.jobs.add('notify', `notify:${event}`, job, { jobId: job.opId });
    }
    if (rules.length > 0) {
      this.logger.debug(`fanned out ${event} to ${rules.length} rule(s)`);
    }
  }

  // ------------------------------------------------------------------ CRUD --

  async listRules(event?: string): Promise<NotificationRule[]> {
    const where: Record<string, unknown> = {};
    if (event) where.event = event;
    const rows = await this.db.notificationRules.findMany({ where, orderBy: { createdAt: 'asc' } });
    return rows.map(toDto);
  }

  async createRule(input: CreateRuleInput, actor?: CurrentUserType): Promise<NotificationRule> {
    const data: NewNotificationRule = {
      name: input.name,
      event: input.event,
      channel: input.channel,
      target: input.target,
      template: input.template ?? null,
      enabled: true,
    };
    const row = await this.db.notificationRules.create(data);
    this.logger.log(`notification rule created by ${actor?.sub ?? 'system'}: ${row.name} (${row.event} → ${row.channel}:${row.target})`);
    return toDto(row);
  }

  async updateRule(id: string, input: UpdateRuleInput, actor?: CurrentUserType): Promise<NotificationRule> {
    const row = await this.db.notificationRules.findUnique({ id });
    if (!row) throw new NotFoundException(`notification rule ${id} not found`);
    const updated = await this.db.notificationRules.update(
      { id },
      Object.fromEntries(
        Object.entries({
          name: input.name,
          event: input.event,
          channel: input.channel,
          target: input.target,
          template: input.template ?? undefined,
          enabled: input.enabled,
        }).filter(([, v]) => v !== undefined),
      ),
    );
    this.logger.log(`notification rule updated by ${actor?.sub ?? 'system'}: ${updated.name}`);
    return toDto(updated);
  }

  async deleteRule(id: string): Promise<void> {
    const row = await this.db.notificationRules.findUnique({ id });
    if (!row) throw new NotFoundException(`notification rule ${id} not found`);
    await this.db.notificationRules.delete({ id });
  }

  /**
   * Send a labeled test notification through a rule (operator+). The payload
   * is clearly marked as a test so it can never be mistaken for a real alert.
   */
  async testRule(id: string, actor?: CurrentUserType): Promise<{ opId: string; jobId: string }> {
    const row = await this.db.notificationRules.findUnique({ id });
    if (!row) throw new NotFoundException(`notification rule ${id} not found`);
    const opId = newOpId();
    const job: NotifyJob = {
      kind: 'notify',
      opId,
      event: 'alert.raised',
      payload: {
        test: true,
        requestedBy: actor?.sub ?? 'system',
        message: `[TEST] notification rule "${row.name}" is working`,
        at: new Date().toISOString(),
      },
      ruleId: row.id,
      channel: row.channel as NotificationChannel,
      target: row.target,
      template: row.template ?? undefined,
    };
    const queued = await this.jobs.add('notify', 'notify:test', job, { jobId: opId });
    return { opId, jobId: queued.id };
  }

  /** Events this service fans out — exposed for docs/health. */
  subscribedEvents(): BusEventName[] {
    return [...SUBSCRIBED_EVENTS];
  }
}

function toDto(r: NotificationRuleRow): NotificationRule {
  return {
    id: r.id,
    name: r.name,
    event: r.event as BusEventName,
    channel: r.channel as NotificationChannel,
    target: r.target,
    template: r.template,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

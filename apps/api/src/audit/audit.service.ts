import { Inject, Injectable } from '@nestjs/common';
import { newOpId } from '@mtk/types';
import { DB_PORT, type DbPort, type NewAuditLog } from '../db/database.port.js';

export interface AppendAuditInput {
  actorId?: string | null;
  routerId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  /** Idempotency key; generated when omitted. */
  opId?: string;
  before?: unknown;
  after?: unknown;
  result?: 'pending' | 'done' | 'failed';
  error?: string | null;
}

/**
 * Append-only audit log. There is intentionally no update/delete API —
 * history is immutable. Every mutating action records who/what/router,
 * before/after snapshots and the command-path opId.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB_PORT) private readonly db: DbPort) {}

  async append(input: AppendAuditInput): Promise<{ id: string; opId: string }> {
    if (input.opId) {
      const existing = await this.db.auditLogs.findUnique({ opId: input.opId });
      if (existing) {
        const patch: Record<string, unknown> = {};
        if (input.result !== undefined) patch.result = input.result;
        if (input.error !== undefined) patch.error = input.error;
        if (input.after !== undefined && input.after !== null) patch.after = input.after;
        if (input.before !== undefined && input.before !== null) patch.before = input.before;
        if (Object.keys(patch).length > 0) {
          await this.db.auditLogs.update({ opId: input.opId }, patch);
        }
        return { id: existing.id, opId: existing.opId };
      }
    }
    const data: NewAuditLog = {
      actorId: input.actorId ?? null,
      routerId: input.routerId ?? null,
      action: input.action,
      opId: input.opId ?? newOpId(),
      before: input.before ?? null,
      after: input.after ?? null,
      result: input.result ?? 'done',
      error: input.error ?? null,
    };
    const row = await this.db.auditLogs.create(data);
    return { id: row.id, opId: row.opId };
  }

  /** Flip a pending audit row to its terminal state (used by command results). */
  async settle(opId: string, result: 'done' | 'failed', error?: string): Promise<void> {
    const row = await this.db.auditLogs.findUnique({ opId });
    if (!row) return;
    await this.db.auditLogs.update(
      { opId },
      { result, error: error ?? null },
    );
  }

  async query(opts: {
    actorId?: string;
    routerId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: unknown[]; total: number }> {
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 50, 500);
    const where: Record<string, unknown> = {};
    if (opts.actorId) where.actorId = opts.actorId;
    if (opts.routerId) where.routerId = opts.routerId;
    if (opts.action) where.action = opts.action;
    // Date-range filtering is applied in-memory: the Table port only does
    // equality matching, and ranges are rare on this endpoint.
    const all = await this.db.auditLogs.findMany({ where, orderBy: { createdAt: 'desc' } });
    const ranged = all.filter((r) => {
      if (opts.from && r.createdAt < opts.from) return false;
      if (opts.to && r.createdAt > opts.to) return false;
      return true;
    });
    const items = ranged
      .slice((page - 1) * pageSize, page * pageSize)
      .map((r) => ({
        id: r.id,
        actorId: r.actorId,
        routerId: r.routerId,
        action: r.action,
        opId: r.opId,
        before: r.before,
        after: r.after,
        result: r.result,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
      }));
    return { items, total: ranged.length };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import type { FirewallJournalEntry } from '@mtk/types';
import { DB_PORT, type DbPort, type NewFirewallJournal } from '../db/database.port.js';
import type { FirewallJournalRow } from '../db/rows.js';

export interface JournalInput {
  routerId: string;
  opId: string;
  action: string;
  table: string;
  chain?: string | null;
  ruleId?: string | null;
  /** Before-snapshot of affected mirror rows (plain JSON). */
  before: unknown;
  /** Mirror rows created by the journaled op (rollback revokes these). */
  createdRuleIds?: string[];
  /** Exact sentences applied. */
  sentences: unknown;
}

/**
 * Rollback journal for firewall changes.
 *
 * Written BEFORE any firewall mutation is applied (status 'pending' →
 * 'applied' once the command is enqueued). `POST
 * /routers/:id/firewall/rollback/:journalId` restores the before-snapshot;
 * rollback revokes created rules (revoked=true, disabled) — it never
 * hard-deletes a journaled rule.
 *
 * Journal rows are append-only history: rollback flips the status, it never
 * deletes the entry.
 */
@Injectable()
export class FirewallJournalService {
  constructor(@Inject(DB_PORT) private readonly db: DbPort) {}

  async record(input: JournalInput): Promise<FirewallJournalRow> {
    const data: NewFirewallJournal = {
      routerId: input.routerId,
      opId: input.opId,
      action: input.action,
      table: input.table,
      chain: input.chain ?? null,
      ruleId: input.ruleId ?? null,
      before: input.before,
      createdRuleIds: input.createdRuleIds ?? [],
      sentences: input.sentences,
      status: 'pending',
    };
    return this.db.firewallJournals.create(data);
  }

  async markApplied(id: string): Promise<void> {
    await this.db.firewallJournals.update({ id }, { status: 'applied' });
  }

  async markRolledBack(id: string): Promise<void> {
    await this.db.firewallJournals.update(
      { id },
      { status: 'rolled-back', rolledBackAt: new Date() },
    );
  }

  async get(routerId: string, journalId: string): Promise<FirewallJournalRow | null> {
    const row = await this.db.firewallJournals.findUnique({ id: journalId });
    return row && row.routerId === routerId ? row : null;
  }

  async list(routerId: string, limit = 50): Promise<FirewallJournalEntry[]> {
    const rows = await this.db.firewallJournals.findMany({
      where: { routerId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return rows.map(toJournalDto);
  }
}

export function toJournalDto(r: FirewallJournalRow): FirewallJournalEntry {
  return {
    id: r.id,
    routerId: r.routerId,
    opId: r.opId,
    action: r.action,
    table: r.table,
    chain: r.chain,
    ruleId: r.ruleId,
    before: Array.isArray(r.before) ? (r.before as FirewallJournalEntry['before']) : [],
    createdRuleIds: Array.isArray(r.createdRuleIds) ? (r.createdRuleIds as string[]) : [],
    sentences: Array.isArray(r.sentences) ? (r.sentences as string[][]) : [],
    status: r.status as FirewallJournalEntry['status'],
    createdAt: r.createdAt.toISOString(),
    rolledBackAt: r.rolledBackAt ? r.rolledBackAt.toISOString() : null,
  };
}

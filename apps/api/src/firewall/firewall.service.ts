import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  addressListAdd,
  addressListDisable,
  addressListEnable,
  addressListRemove,
  addressListSet,
  filterRuleAdd,
  filterRuleDisable,
  filterRuleEnable,
  filterRuleMove,
  filterRuleRemove,
  filterRuleSet,
  mangleRuleAdd,
  mangleRuleDisable,
  mangleRuleEnable,
  mangleRuleMove,
  mangleRuleRemove,
  mangleRuleSet,
  natRuleAdd,
  natRuleDisable,
  natRuleEnable,
  natRuleMove,
  natRuleRemove,
  natRuleSet,
} from '@mtk/ros-api';
import { newOpId, type FirewallJournalEntry, type FirewallRule } from '@mtk/types';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort, type NewFirewallRule } from '../db/database.port.js';
import type { FirewallRuleRow } from '../db/rows.js';
import { RouterCommandsService, type EnqueuedCommand } from '../commands/commands.service.js';
import { FirewallJournalService } from './firewall-journal.service.js';
import type {
  CreateFirewallRuleDto,
  ListFirewallRulesQuery,
  MoveFirewallRuleDto,
  UpdateFirewallRuleDto,
} from './dto/firewall.dto.js';

/**
 * How long the worker waits after a filter-table change before verifying the
 * router is still reachable (safe-apply). On lost heartbeat it rolls the
 * change back (worker-side).
 */
const SAFE_APPLY_VERIFY_MS = 60_000;

/**
 * Firewall manager — filter/nat/mangle/address-list CRUD + ordering.
 *
 * - Every mutation writes the platform mirror, then enqueues typed sentences.
 * - `order` is the platform-side ordering within (table, chain); reconciled
 *   on-device via `move` (destination = successor's device id, `*0` = top).
 * - Filter-table mutations carry `needsSafeApply` (safeApply.verifyAfterMs):
 *   a filter change can lock management out, so the worker verifies
 *   reachability afterwards and rolls back on failure.
 * - Address-list entries are stored in the same mirror table
 *   (`table='address-list'`, `chain`=list name, `srcAddress`=entry); they have
 *   no device-side ordering, so `move` is rejected for them.
 * - Rollback journaling: EVERY mutation writes a FirewallJournal entry BEFORE
 *   applying (status pending → applied once enqueued). Rollback restores the
 *   before-snapshot; rules created by the journaled op are REVOKED
 *   (revoked=true, disabled) — never hard-deleted.
 */
@Injectable()
export class FirewallService {
  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    private readonly commands: RouterCommandsService,
    private readonly journals: FirewallJournalService,
  ) {}

  private needDeviceId(row: FirewallRuleRow): string {
    if (!row.mikrotikId) {
      throw new UnprocessableEntityException(
        'rule has no device id yet — wait for the add command to complete before mutating it',
      );
    }
    return row.mikrotikId;
  }

  private safeApplyFor(table: string): { verifyAfterMs: number } | undefined {
    return table === 'filter' ? { verifyAfterMs: SAFE_APPLY_VERIFY_MS } : undefined;
  }

  private async ruleOrThrow(routerId: string, id: string): Promise<FirewallRuleRow> {
    await this.commands.requireRouter(routerId);
    const row = await this.db.firewallRules.findUnique({ id });
    if (!row || row.routerId !== routerId) throw new NotFoundException(`firewall rule ${id} not found`);
    return row;
  }

  async listRules(routerId: string, q: ListFirewallRulesQuery): Promise<FirewallRule[]> {
    await this.commands.requireRouter(routerId);
    const where: Record<string, unknown> = { routerId };
    if (q.table) where.table = q.table;
    if (q.chain) where.chain = q.chain;
    // Revoked rules are hidden by default (soft-deleted by rollback); the UI
    // can still list them with ?includeRevoked=true for audit.
    if (!q.includeRevoked) where.revoked = false;
    const rows = await this.db.firewallRules.findMany({ where, orderBy: { order: 'asc' } });
    return rows.map(toDto);
  }

  async listJournals(routerId: string, limit?: number): Promise<FirewallJournalEntry[]> {
    await this.commands.requireRouter(routerId);
    return this.journals.list(routerId, limit);
  }

  async createRule(routerId: string, dto: CreateFirewallRuleDto, actor?: CurrentUserType) {
    await this.commands.requireRouter(routerId);
    const isAddressList = dto.table === 'address-list';

    let order = 0;
    let placeBefore: string | undefined;
    if (!isAddressList) {
      const siblings = await this.db.firewallRules.findMany({
        where: { routerId, table: dto.table, chain: dto.chain },
        orderBy: { order: 'asc' },
      });
      if (dto.beforeId) {
        const anchor = siblings.find((r) => r.id === dto.beforeId);
        if (!anchor) throw new NotFoundException(`anchor rule ${dto.beforeId} not found in ${dto.table}/${dto.chain}`);
        placeBefore = this.needDeviceId(anchor);
        order = anchor.order;
        for (const s of siblings) {
          if (s.order >= order) await this.db.firewallRules.update({ id: s.id }, { order: s.order + 1 });
        }
      } else {
        order = siblings.length === 0 ? 0 : Math.max(...siblings.map((r) => r.order)) + 1;
      }
    }

    const data: NewFirewallRule = {
      routerId,
      table: dto.table,
      chain: dto.chain,
      action: dto.action,
      order,
      protocol: dto.protocol ?? null,
      srcAddress: dto.srcAddress ?? null,
      dstAddress: dto.dstAddress ?? null,
      srcPort: dto.srcPort ?? null,
      dstPort: dto.dstPort ?? null,
      inInterface: dto.inInterface ?? null,
      outInterface: dto.outInterface ?? null,
      toAddresses: dto.toAddresses ?? null,
      toPorts: dto.toPorts ?? null,
      comment: dto.comment ?? null,
      disabled: dto.disabled ?? false,
      managed: true,
    };
    // Journal BEFORE applying: the mirror id is allocated up-front so the
    // journal can reference the row it is about to create.
    const opId = dto.opId ?? newOpId();
    const newId = randomUUID();
    const sentences = [this.addSentence(dto, placeBefore)];
    const journal = await this.journals.record({
      routerId,
      opId,
      action: 'firewall.rule.create',
      table: dto.table,
      chain: dto.chain,
      ruleId: null,
      before: [],
      createdRuleIds: [newId],
      sentences,
    });
    const row = await this.db.firewallRules.create({ ...data, id: newId } as NewFirewallRule & { id: string });
    const enq = await this.commands.enqueueRos({
      routerId,
      action: `firewall.rule.create`,
      sentences,
      opId,
      actorId: actor?.sub,
      after: { table: dto.table, chain: dto.chain, action: dto.action, journalId: journal.id },
      entity: { table: 'firewall', id: row.id },
      safeApply: this.safeApplyFor(dto.table),
    });
    await this.journals.markApplied(journal.id);
    return { rule: toDto(row), journalId: journal.id, ...enq };
  }

  async updateRule(routerId: string, id: string, dto: UpdateFirewallRuleDto, actor?: CurrentUserType) {
    const row = await this.ruleOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row);
    const opId = dto.opId ?? newOpId();
    const sentences = [this.setSentence(row, dto, deviceId)];
    const journal = await this.journals.record({
      routerId,
      opId,
      action: 'firewall.rule.update',
      table: row.table,
      chain: row.chain,
      ruleId: id,
      before: [{ ...row }],
      sentences,
    });
    const updated = await this.db.firewallRules.update(
      { id },
      Object.fromEntries(
        Object.entries({
          action: dto.action,
          protocol: dto.protocol ?? undefined,
          srcAddress: dto.srcAddress ?? undefined,
          dstAddress: dto.dstAddress ?? undefined,
          srcPort: dto.srcPort ?? undefined,
          dstPort: dto.dstPort ?? undefined,
          inInterface: dto.inInterface ?? undefined,
          outInterface: dto.outInterface ?? undefined,
          toAddresses: dto.toAddresses ?? undefined,
          toPorts: dto.toPorts ?? undefined,
          comment: dto.comment ?? undefined,
          disabled: dto.disabled,
        }).filter(([, v]) => v !== undefined),
      ),
    );
    const enq = await this.commands.enqueueRos({
      routerId,
      action: 'firewall.rule.update',
      sentences,
      opId,
      actorId: actor?.sub,
      before: row,
      after: { journalId: journal.id },
      entity: { table: 'firewall', id },
      safeApply: this.safeApplyFor(row.table),
    });
    await this.journals.markApplied(journal.id);
    return { rule: toDto(updated), journalId: journal.id, ...enq };
  }

  async deleteRule(routerId: string, id: string, opIdIn: string | undefined, actor?: CurrentUserType): Promise<EnqueuedCommand & { journalId: string }> {
    const row = await this.ruleOrThrow(routerId, id);
    if (row.comment?.startsWith('panel-proxy:')) {
      throw new BadRequestException(
        'this rule is managed by the downstream proxy — disable the device proxy instead of deleting the rule directly',
      );
    }
    const deviceId = this.needDeviceId(row);
    const opId = opIdIn ?? newOpId();
    const sentences = [this.removeSentence(row.table, deviceId)];
    const journal = await this.journals.record({
      routerId,
      opId,
      action: 'firewall.rule.delete',
      table: row.table,
      chain: row.chain,
      ruleId: id,
      before: [{ ...row }],
      sentences,
    });
    await this.db.firewallRules.delete({ id });
    const enq = await this.commands.enqueueRos({
      routerId,
      action: 'firewall.rule.delete',
      sentences,
      opId,
      actorId: actor?.sub,
      before: row,
      after: { journalId: journal.id },
      safeApply: this.safeApplyFor(row.table),
    });
    await this.journals.markApplied(journal.id);
    return { journalId: journal.id, ...enq };
  }

  async setRuleDisabled(routerId: string, id: string, disabled: boolean, opIdIn: string | undefined, actor?: CurrentUserType) {
    const row = await this.ruleOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row);
    const opId = opIdIn ?? newOpId();
    const sentences = [this.toggleSentence(row.table, deviceId, disabled)];
    const journal = await this.journals.record({
      routerId,
      opId,
      action: disabled ? 'firewall.rule.disable' : 'firewall.rule.enable',
      table: row.table,
      chain: row.chain,
      ruleId: id,
      before: [{ ...row }],
      sentences,
    });
    const updated = await this.db.firewallRules.update({ id }, { disabled });
    const enq = await this.commands.enqueueRos({
      routerId,
      action: disabled ? 'firewall.rule.disable' : 'firewall.rule.enable',
      sentences,
      opId,
      actorId: actor?.sub,
      before: { disabled: row.disabled },
      after: { disabled, journalId: journal.id },
      entity: { table: 'firewall', id },
      safeApply: this.safeApplyFor(row.table),
    });
    await this.journals.markApplied(journal.id);
    return { rule: toDto(updated), journalId: journal.id, ...enq };
  }

  /**
   * Reorder a rule within its (table, chain).
   * - `beforeId`: move directly before another platform rule.
   * - `toEnd`: move to the end — implemented as moving every rule currently
   *   after it to before it (RouterOS `move` only expresses "before X").
   * `destination=*0` (top) is used when the rule becomes first via beforeId
   * pointing at the current first rule.
   */
  async moveRule(routerId: string, id: string, dto: MoveFirewallRuleDto, actor?: CurrentUserType) {
    const row = await this.ruleOrThrow(routerId, id);
    if (row.table === 'address-list') {
      throw new BadRequestException('address-list entries have no device-side ordering');
    }
    if (dto.beforeId && dto.toEnd) {
      throw new BadRequestException('beforeId and toEnd are mutually exclusive');
    }
    if (!dto.beforeId && !dto.toEnd) {
      throw new BadRequestException('either beforeId or toEnd is required');
    }
    const movedDeviceId = this.needDeviceId(row);
    const siblings = (await this.db.firewallRules.findMany({
      where: { routerId, table: row.table, chain: row.chain },
      orderBy: { order: 'asc' },
    })).filter((r) => r.id !== row.id);

    const sentences: string[][] = [];
    let newOrder: FirewallRuleRow[];
    if (dto.beforeId) {
      const anchor = siblings.find((r) => r.id === dto.beforeId);
      if (!anchor) throw new NotFoundException(`anchor rule ${dto.beforeId} not found in ${row.table}/${row.chain}`);
      const anchorDeviceId = this.needDeviceId(anchor);
      sentences.push(this.moveSentence(row.table, movedDeviceId, anchorDeviceId));
      const idx = siblings.indexOf(anchor);
      newOrder = [...siblings.slice(0, idx), row, ...siblings.slice(idx)];
    } else {
      // toEnd: rules currently after the moved one go before it, preserving order.
      const after = siblings.filter((r) => r.order > row.order);
      for (const other of after) {
        sentences.push(this.moveSentence(row.table, this.needDeviceId(other), movedDeviceId));
      }
      newOrder = [...siblings.filter((r) => r.order <= row.order), ...after, row];
    }

    // Journal BEFORE applying: snapshot the whole chain (order is chain-wide).
    const opId = dto.opId ?? newOpId();
    const journal = await this.journals.record({
      routerId,
      opId,
      action: 'firewall.rule.move',
      table: row.table,
      chain: row.chain,
      ruleId: id,
      before: [row, ...siblings].map((r) => ({ ...r })),
      sentences,
    });
    for (let i = 0; i < newOrder.length; i++) {
      if (newOrder[i].order !== i) await this.db.firewallRules.update({ id: newOrder[i].id }, { order: i });
    }
    const enq = await this.commands.enqueueRos({
      routerId,
      action: 'firewall.rule.move',
      sentences,
      opId,
      actorId: actor?.sub,
      before: { order: row.order },
      after: { order: newOrder.indexOf(row), journalId: journal.id },
      entity: { table: 'firewall', id },
      safeApply: this.safeApplyFor(row.table),
    });
    await this.journals.markApplied(journal.id);
    return { rule: toDto({ ...row, order: newOrder.indexOf(row) }), journalId: journal.id, ...enq };
  }

  // ------------------------------------------------------------- rollback --

  /**
   * Roll back a journaled firewall change.
   *
   * - Snapshotted rules are restored to their before-state (mirror + device).
   * - Rules the journaled op CREATED are REVOKED (`revoked: true`, disabled
   *   on-device) — rollback never hard-deletes a journaled rule.
   * - A rule deleted after the journal is recreated from the snapshot.
   *
   * The rollback itself is audited as `firewall.rollback` (one command);
   * it is not journaled (no recursive journals).
   */
  async rollbackJournal(routerId: string, journalId: string, actor?: CurrentUserType) {
    await this.commands.requireRouter(routerId);
    const journal = await this.journals.get(routerId, journalId);
    if (!journal) throw new NotFoundException(`firewall journal ${journalId} not found`);
    if (journal.status !== 'applied') {
      throw new UnprocessableEntityException(
        `journal ${journalId} has status '${journal.status}' — only 'applied' journals can be rolled back`,
      );
    }
    const before = (Array.isArray(journal.before) ? journal.before : []) as FirewallRuleRow[];
    const createdIds = (Array.isArray(journal.createdRuleIds) ? journal.createdRuleIds : []) as string[];
    const opId = newOpId();
    const sentences: string[][] = [];
    let restored = 0;
    let revoked = 0;

    if (journal.action === 'firewall.rule.move') {
      restored = await this.rollbackMove(routerId, before, sentences);
    } else {
      for (const snap of before) {
        const existing = await this.db.firewallRules.findUnique({ id: snap.id }).catch(() => null);
        if (existing) {
          const { id: _drop, routerId: _dropRouter, ...fields } = snap;
          await this.db.firewallRules.update({ id: snap.id }, { ...fields, revoked: false });
          const deviceId = existing.mikrotikId ?? snap.mikrotikId;
          if (deviceId) {
            sentences.push(this.setSentenceFromRow({ ...snap, mikrotikId: deviceId }, deviceId));
          }
          restored++;
        } else {
          // Deleted after the journal — recreate mirror + device rule.
          const { ...fields } = snap;
          await this.db.firewallRules.create({ ...fields } as NewFirewallRule & { id: string });
          sentences.push(this.addSentenceFromRow(snap));
          restored++;
        }
      }
    }

    // Rules created by the journaled op: revoke, never hard-delete.
    for (const createdId of createdIds) {
      const row = await this.db.firewallRules.findUnique({ id: createdId }).catch(() => null);
      if (!row || row.revoked) continue;
      const updated = await this.db.firewallRules.update({ id: createdId }, { revoked: true, disabled: true });
      if (updated.mikrotikId) {
        sentences.push(this.toggleSentence(updated.table, updated.mikrotikId, true));
      }
      revoked++;
    }

    const enq = await this.commands.enqueueRos({
      routerId,
      action: 'firewall.rollback',
      sentences,
      opId,
      actorId: actor?.sub,
      before: { journalId, action: journal.action },
      after: { restored, revoked },
      safeApply: journal.table === 'filter' ? { verifyAfterMs: SAFE_APPLY_VERIFY_MS } : undefined,
    });
    await this.journals.markRolledBack(journal.id);
    return { journalId: journal.id, restored, revoked, ...enq };
  }

  /**
   * Restore a chain's rule order from a move journal's before-snapshot.
   * Mirror: rewrite `order`. Device: walk the desired order back-to-front,
   * moving each rule before its successor (reconstructs the exact order;
   * the last rule needs no move).
   */
  private async rollbackMove(
    routerId: string,
    before: FirewallRuleRow[],
    sentences: string[][],
  ): Promise<number> {
    const ordered = [...before].sort((a, b) => a.order - b.order);
    let restored = 0;
    for (const snap of ordered) {
      const existing = await this.db.firewallRules.findUnique({ id: snap.id }).catch(() => null);
      if (!existing) continue; // rule deleted after the move — order restore skips it
      if (existing.order !== snap.order) {
        await this.db.firewallRules.update({ id: snap.id }, { order: snap.order });
        restored++;
      }
    }
    for (let i = ordered.length - 2; i >= 0; i--) {
      const rule = ordered[i];
      const successor = ordered[i + 1];
      const existing = await this.db.firewallRules.findUnique({ id: rule.id }).catch(() => null);
      const succExisting = await this.db.firewallRules.findUnique({ id: successor.id }).catch(() => null);
      const deviceId = existing?.mikrotikId ?? rule.mikrotikId;
      const succDeviceId = succExisting?.mikrotikId ?? successor.mikrotikId;
      if (deviceId && succDeviceId) {
        sentences.push(this.moveSentence(rule.table, deviceId, succDeviceId));
      }
    }
    return restored;
  }

  /** Rebuild an add sentence from a mirror-row snapshot (rollback path). */
  private addSentenceFromRow(row: FirewallRuleRow): string[] {
    return this.addSentence(
      {
        table: row.table,
        chain: row.chain,
        action: row.action,
        protocol: row.protocol ?? undefined,
        srcAddress: row.srcAddress ?? undefined,
        dstAddress: row.dstAddress ?? undefined,
        srcPort: row.srcPort ?? undefined,
        dstPort: row.dstPort ?? undefined,
        inInterface: row.inInterface ?? undefined,
        outInterface: row.outInterface ?? undefined,
        toAddresses: row.toAddresses ?? undefined,
        toPorts: row.toPorts ?? undefined,
        comment: row.comment ?? undefined,
        disabled: row.disabled,
      } as CreateFirewallRuleDto,
    );
  }

  /** Rebuild a set sentence from a mirror-row snapshot (rollback path). */
  private setSentenceFromRow(row: FirewallRuleRow, deviceId: string): string[] {
    return this.setSentence(
      row,
      {
        action: row.action,
        protocol: row.protocol ?? undefined,
        srcAddress: row.srcAddress ?? undefined,
        dstAddress: row.dstAddress ?? undefined,
        srcPort: row.srcPort ?? undefined,
        dstPort: row.dstPort ?? undefined,
        inInterface: row.inInterface ?? undefined,
        outInterface: row.outInterface ?? undefined,
        toAddresses: row.toAddresses ?? undefined,
        toPorts: row.toPorts ?? undefined,
        comment: row.comment ?? undefined,
        disabled: row.disabled,
      } as UpdateFirewallRuleDto,
      deviceId,
    );
  }

  // ------------------------------------------------------------- builders --

  private addSentence(dto: CreateFirewallRuleDto, placeBefore?: string): string[] {
    switch (dto.table) {
      case 'filter':
        return filterRuleAdd({ ...ruleInput(dto), placeBefore });
      case 'nat':
        return natRuleAdd({ ...ruleInput(dto), placeBefore });
      case 'mangle':
        return mangleRuleAdd({
          ...ruleInput(dto),
          newPacketMark: dto.newPacketMark,
          newConnectionMark: dto.newConnectionMark,
          newRoutingMark: dto.newRoutingMark,
          placeBefore,
        });
      case 'address-list':
        return addressListAdd({
          list: dto.chain,
          address: dto.srcAddress ?? '',
          comment: dto.comment,
          disabled: dto.disabled,
          timeout: dto.timeout,
        });
      default:
        throw new BadRequestException(`unknown table ${dto.table}`);
    }
  }

  private setSentence(row: FirewallRuleRow, dto: UpdateFirewallRuleDto, deviceId: string): string[] {
    switch (row.table) {
      case 'filter':
        return filterRuleSet(deviceId, patchInput(dto));
      case 'nat':
        return natRuleSet(deviceId, patchInput(dto));
      case 'mangle':
        return mangleRuleSet(deviceId, {
          ...patchInput(dto),
          newPacketMark: dto.newPacketMark,
          newConnectionMark: dto.newConnectionMark,
          newRoutingMark: dto.newRoutingMark,
        });
      case 'address-list':
        return addressListSet(deviceId, {
          list: row.chain,
          address: dto.srcAddress,
          comment: dto.comment,
          disabled: dto.disabled,
          timeout: dto.timeout,
        });
      default:
        throw new BadRequestException(`unknown table ${row.table}`);
    }
  }

  private removeSentence(table: string, deviceId: string): string[] {
    switch (table) {
      case 'filter': return filterRuleRemove(deviceId);
      case 'nat': return natRuleRemove(deviceId);
      case 'mangle': return mangleRuleRemove(deviceId);
      case 'address-list': return addressListRemove(deviceId);
      default: throw new BadRequestException(`unknown table ${table}`);
    }
  }

  private toggleSentence(table: string, deviceId: string, disabled: boolean): string[] {
    switch (table) {
      case 'filter': return disabled ? filterRuleDisable(deviceId) : filterRuleEnable(deviceId);
      case 'nat': return disabled ? natRuleDisable(deviceId) : natRuleEnable(deviceId);
      case 'mangle': return disabled ? mangleRuleDisable(deviceId) : mangleRuleEnable(deviceId);
      case 'address-list': return disabled ? addressListDisable(deviceId) : addressListEnable(deviceId);
      default: throw new BadRequestException(`unknown table ${table}`);
    }
  }

  private moveSentence(table: string, deviceId: string, destination: string): string[] {
    switch (table) {
      case 'filter': return filterRuleMove(deviceId, destination);
      case 'nat': return natRuleMove(deviceId, destination);
      case 'mangle': return mangleRuleMove(deviceId, destination);
      default: throw new BadRequestException(`table ${table} does not support move`);
    }
  }
}

function ruleInput(dto: CreateFirewallRuleDto) {
  return {
    chain: dto.chain,
    action: dto.action,
    protocol: dto.protocol,
    srcAddress: dto.srcAddress,
    dstAddress: dto.dstAddress,
    srcPort: dto.srcPort,
    dstPort: dto.dstPort,
    inInterface: dto.inInterface,
    outInterface: dto.outInterface,
    toAddresses: dto.toAddresses,
    toPorts: dto.toPorts,
    comment: dto.comment,
    disabled: dto.disabled,
  };
}

function patchInput(dto: UpdateFirewallRuleDto) {
  return {
    action: dto.action,
    protocol: dto.protocol,
    srcAddress: dto.srcAddress,
    dstAddress: dto.dstAddress,
    srcPort: dto.srcPort,
    dstPort: dto.dstPort,
    inInterface: dto.inInterface,
    outInterface: dto.outInterface,
    toAddresses: dto.toAddresses,
    toPorts: dto.toPorts,
    comment: dto.comment,
    disabled: dto.disabled,
  };
}

function toDto(r: FirewallRuleRow): FirewallRule {
  return {
    id: r.id,
    routerId: r.routerId,
    table: r.table as FirewallRule['table'],
    chain: r.chain,
    action: r.action,
    order: r.order,
    protocol: r.protocol,
    srcAddress: r.srcAddress,
    dstAddress: r.dstAddress,
    srcPort: r.srcPort,
    dstPort: r.dstPort,
    inInterface: r.inInterface,
    outInterface: r.outInterface,
    toAddresses: r.toAddresses,
    toPorts: r.toPorts,
    comment: r.comment,
    disabled: r.disabled,
    managed: r.managed,
    revoked: r.revoked,
    mikrotikId: r.mikrotikId,
  };
}

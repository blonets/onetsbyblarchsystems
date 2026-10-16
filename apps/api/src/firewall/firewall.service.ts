import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
import type { FirewallRule } from '@mtk/types';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort, type NewFirewallRule } from '../db/database.port.js';
import type { FirewallRuleRow } from '../db/rows.js';
import { RouterCommandsService, type EnqueuedCommand } from '../commands/commands.service.js';
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
 */
@Injectable()
export class FirewallService {
  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    private readonly commands: RouterCommandsService,
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
    const rows = await this.db.firewallRules.findMany({ where, orderBy: { order: 'asc' } });
    return rows.map(toDto);
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
    const row = await this.db.firewallRules.create(data);
    const enq = await this.commands.enqueueRos({
      routerId,
      action: `firewall.rule.create`,
      sentences: [this.addSentence(dto, placeBefore)],
      opId: dto.opId,
      actorId: actor?.sub,
      after: { table: dto.table, chain: dto.chain, action: dto.action },
      entity: { table: 'firewall', id: row.id },
      safeApply: this.safeApplyFor(dto.table),
    });
    return { rule: toDto(row), ...enq };
  }

  async updateRule(routerId: string, id: string, dto: UpdateFirewallRuleDto, actor?: CurrentUserType) {
    const row = await this.ruleOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row);
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
      sentences: [this.setSentence(row, dto, deviceId)],
      opId: dto.opId,
      actorId: actor?.sub,
      before: row,
      entity: { table: 'firewall', id },
      safeApply: this.safeApplyFor(row.table),
    });
    return { rule: toDto(updated), ...enq };
  }

  async deleteRule(routerId: string, id: string, opId: string | undefined, actor?: CurrentUserType): Promise<EnqueuedCommand> {
    const row = await this.ruleOrThrow(routerId, id);
    if (row.comment?.startsWith('panel-proxy:')) {
      throw new BadRequestException(
        'this rule is managed by the downstream proxy — disable the device proxy instead of deleting the rule directly',
      );
    }
    const deviceId = this.needDeviceId(row);
    await this.db.firewallRules.delete({ id });
    return this.commands.enqueueRos({
      routerId,
      action: 'firewall.rule.delete',
      sentences: [this.removeSentence(row.table, deviceId)],
      opId,
      actorId: actor?.sub,
      before: row,
      safeApply: this.safeApplyFor(row.table),
    });
  }

  async setRuleDisabled(routerId: string, id: string, disabled: boolean, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.ruleOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row);
    const updated = await this.db.firewallRules.update({ id }, { disabled });
    const enq = await this.commands.enqueueRos({
      routerId,
      action: disabled ? 'firewall.rule.disable' : 'firewall.rule.enable',
      sentences: [this.toggleSentence(row.table, deviceId, disabled)],
      opId,
      actorId: actor?.sub,
      before: { disabled: row.disabled },
      after: { disabled },
      entity: { table: 'firewall', id },
      safeApply: this.safeApplyFor(row.table),
    });
    return { rule: toDto(updated), ...enq };
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

    for (let i = 0; i < newOrder.length; i++) {
      if (newOrder[i].order !== i) await this.db.firewallRules.update({ id: newOrder[i].id }, { order: i });
    }
    const enq = await this.commands.enqueueRos({
      routerId,
      action: 'firewall.rule.move',
      sentences,
      opId: dto.opId,
      actorId: actor?.sub,
      before: { order: row.order },
      after: { order: newOrder.indexOf(row) },
      entity: { table: 'firewall', id },
      safeApply: this.safeApplyFor(row.table),
    });
    return { rule: toDto({ ...row, order: newOrder.indexOf(row) }), ...enq };
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
    mikrotikId: r.mikrotikId,
  };
}

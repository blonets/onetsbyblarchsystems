import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  queueTreeAdd,
  queueTreeDisable,
  queueTreeEnable,
  queueTreeMove,
  queueTreeRemove,
  queueTreeSet,
  simpleQueueAdd,
  simpleQueueDisable,
  simpleQueueEnable,
  simpleQueueMove,
  simpleQueueRemove,
  simpleQueueSet,
} from '@mtk/ros-api';
import type { QueueItem, QueueKind } from '@mtk/types';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import type { QueueRow } from '../db/rows.js';
import { RouterCommandsService, type EnqueuedCommand } from '../commands/commands.service.js';
import type { CreateQueueDto, MoveQueueDto, UpdateQueueDto } from './dto/queues.dto.js';

/**
 * Queues manager — simple queues + queue trees.
 *
 * Same pattern as hotspot/firewall: mirror row → typed sentences → `commands`
 * queue → result settles audit + reconciles `mikrotikId`.
 *
 * Rate strings are opaque: the device normalizes them
 * (`2M/2M` → `2000000/2000000`), so they are stored as submitted and never
 * compared literally.
 */
@Injectable()
export class QueuesService {
  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    private readonly commands: RouterCommandsService,
  ) {}

  private needDeviceId(row: QueueRow): string {
    if (!row.mikrotikId) {
      throw new UnprocessableEntityException(
        'queue has no device id yet — wait for the add command to complete before mutating it',
      );
    }
    return row.mikrotikId;
  }

  private async queueOrThrow(routerId: string, id: string): Promise<QueueRow> {
    await this.commands.requireRouter(routerId);
    const row = await this.db.queues.findUnique({ id });
    if (!row || row.routerId !== routerId) throw new NotFoundException(`queue ${id} not found`);
    return row;
  }

  async listQueues(routerId: string, kind?: QueueKind): Promise<QueueItem[]> {
    await this.commands.requireRouter(routerId);
    const where: Record<string, unknown> = { routerId };
    if (kind) where.kind = kind;
    const rows = await this.db.queues.findMany({ where, orderBy: { name: 'asc' } });
    return rows.map(toDto);
  }

  async createQueue(routerId: string, dto: CreateQueueDto, actor?: CurrentUserType) {
    await this.commands.requireRouter(routerId);
    if (dto.kind === 'tree' && !dto.parent) {
      throw new UnprocessableEntityException('parent is required for kind=tree');
    }
    if (dto.kind === 'simple' && !dto.target) {
      throw new UnprocessableEntityException('target is required for kind=simple');
    }
    const dupe = await this.db.queues.findFirst({ routerId, kind: dto.kind, name: dto.name });
    if (dupe) throw new UnprocessableEntityException(`queue "${dto.name}" already exists`);

    const row = await this.db.queues.create({
      routerId,
      kind: dto.kind,
      name: dto.name,
      target: dto.target ?? null,
      parent: dto.parent ?? null,
      maxLimit: dto.maxLimit ?? null,
      limitAt: dto.limitAt ?? null,
      priority: dto.priority ?? null,
      disabled: dto.disabled ?? false,
    });

    const sentence =
      dto.kind === 'simple'
        ? simpleQueueAdd({
            name: dto.name,
            target: dto.target as string,
            maxLimit: dto.maxLimit,
            limitAt: dto.limitAt,
            priority: dto.priority === undefined ? undefined : String(dto.priority),
            comment: dto.comment,
            disabled: dto.disabled,
          })
        : queueTreeAdd({
            name: dto.name,
            parent: dto.parent as string,
            packetMark: dto.packetMark,
            maxLimit: dto.maxLimit,
            limitAt: dto.limitAt,
            priority: dto.priority === undefined ? undefined : String(dto.priority),
            comment: dto.comment,
            disabled: dto.disabled,
          });

    const enq = await this.commands.enqueueRos({
      routerId,
      action: `queue.${dto.kind}.create`,
      sentences: [sentence],
      opId: dto.opId,
      actorId: actor?.sub,
      after: { kind: dto.kind, name: dto.name },
      entity: { table: 'queue', id: row.id },
    });
    return { queue: toDto(row), ...enq };
  }

  async updateQueue(routerId: string, id: string, dto: UpdateQueueDto, actor?: CurrentUserType) {
    const row = await this.queueOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row);
    const updated = await this.db.queues.update(
      { id },
      Object.fromEntries(
        Object.entries({
          target: dto.target ?? undefined,
          parent: dto.parent ?? undefined,
          maxLimit: dto.maxLimit ?? undefined,
          limitAt: dto.limitAt ?? undefined,
          priority: dto.priority,
          disabled: dto.disabled,
        }).filter(([, v]) => v !== undefined),
      ),
    );
    const patch = {
      target: dto.target,
      parent: dto.parent,
      packetMark: dto.packetMark,
      maxLimit: dto.maxLimit,
      limitAt: dto.limitAt,
      priority: dto.priority === undefined ? undefined : String(dto.priority),
      comment: dto.comment,
      disabled: dto.disabled,
    };
    const sentence =
      row.kind === 'simple' ? simpleQueueSet(deviceId, patch) : queueTreeSet(deviceId, patch);
    const enq = await this.commands.enqueueRos({
      routerId,
      action: `queue.${row.kind}.update`,
      sentences: [sentence],
      opId: dto.opId,
      actorId: actor?.sub,
      before: row,
      entity: { table: 'queue', id },
    });
    return { queue: toDto(updated), ...enq };
  }

  async deleteQueue(routerId: string, id: string, opId: string | undefined, actor?: CurrentUserType): Promise<EnqueuedCommand> {
    const row = await this.queueOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row);
    await this.db.queues.delete({ id });
    return this.commands.enqueueRos({
      routerId,
      action: `queue.${row.kind}.delete`,
      sentences: [row.kind === 'simple' ? simpleQueueRemove(deviceId) : queueTreeRemove(deviceId)],
      opId,
      actorId: actor?.sub,
      before: row,
    });
  }

  async setQueueDisabled(routerId: string, id: string, disabled: boolean, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.queueOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row);
    const updated = await this.db.queues.update({ id }, { disabled });
    const sentence =
      row.kind === 'simple'
        ? disabled ? simpleQueueDisable(deviceId) : simpleQueueEnable(deviceId)
        : disabled ? queueTreeDisable(deviceId) : queueTreeEnable(deviceId);
    const enq = await this.commands.enqueueRos({
      routerId,
      action: disabled ? `queue.${row.kind}.disable` : `queue.${row.kind}.enable`,
      sentences: [sentence],
      opId,
      actorId: actor?.sub,
      before: { disabled: row.disabled },
      after: { disabled },
      entity: { table: 'queue', id },
    });
    return { queue: toDto(updated), ...enq };
  }

  /**
   * Move a queue before another queue of the same kind (or to the top when
   * `beforeId` is omitted — `destination=*0`).
   */
  async moveQueue(routerId: string, id: string, dto: MoveQueueDto, actor?: CurrentUserType) {
    const row = await this.queueOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row);
    let destination = '*0';
    if (dto.beforeId) {
      const anchor = await this.db.queues.findUnique({ id: dto.beforeId });
      if (!anchor || anchor.routerId !== routerId || anchor.kind !== row.kind) {
        throw new NotFoundException(`anchor queue ${dto.beforeId} not found`);
      }
      destination = this.needDeviceId(anchor);
    }
    const enq = await this.commands.enqueueRos({
      routerId,
      action: `queue.${row.kind}.move`,
      sentences: [row.kind === 'simple' ? simpleQueueMove(deviceId, destination) : queueTreeMove(deviceId, destination)],
      opId: dto.opId,
      actorId: actor?.sub,
      after: { beforeId: dto.beforeId ?? null },
      entity: { table: 'queue', id },
    });
    return enq;
  }
}

function toDto(r: QueueRow): QueueItem {
  return {
    id: r.id,
    routerId: r.routerId,
    kind: r.kind as QueueKind,
    name: r.name,
    target: r.target,
    parent: r.parent,
    maxLimit: r.maxLimit,
    limitAt: r.limitAt,
    priority: r.priority,
    disabled: r.disabled,
    mikrotikId: r.mikrotikId,
  };
}

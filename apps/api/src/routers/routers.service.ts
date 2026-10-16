import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { newOpId, type Paginated, type Router, type RouterStatus } from '@mtk/types';
import { AuditService } from '../audit/audit.service.js';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort, type NewRouter } from '../db/database.port.js';
import type { RouterRow } from '../db/rows.js';
import { JOBS_PORT, type JobsPort } from '../jobs/jobs.module.js';
import { CreateRouterDto, UpdateRouterDto } from './dto/router.dto.js';

/**
 * Routers CRUD + lifecycle.
 *
 * `status` / `lastSeen` are the platform's last-known view, maintained by the
 * worker's connection-manager heartbeats (see monitoring module) — this
 * service never dials a router itself. Decommission is soft: the row stays for
 * history and the hub secret removal goes through the `provision` queue.
 */
@Injectable()
export class RoutersService {
  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    @Inject(JOBS_PORT) private readonly jobs: JobsPort,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateRouterDto, actor?: CurrentUserType): Promise<Router> {
    if (dto.siteId) {
      const site = await this.db.sites.findUnique({ id: dto.siteId });
      if (!site || site.deletedAt) throw new NotFoundException(`site ${dto.siteId} not found`);
    }
    const data: NewRouter = {
      uuid: dto.uuid ?? randomUUID(),
      siteId: dto.siteId ?? null,
      tunnelIp: dto.tunnelIp,
      sstpUsername: dto.sstpUsername,
      sstpPasswordRef: dto.sstpPasswordRef,
      apiPasswordRef: dto.apiPasswordRef,
      apiUsername: dto.apiUsername ?? 'panel-api',
      apiPort: dto.apiPort ?? 8728,
      apiSslPort: dto.apiSslPort ?? 8729,
      winboxPort: dto.winboxPort ?? 8291,
      sshPort: dto.sshPort ?? 22,
      telnetPort: dto.telnetPort ?? 23,
      ftpPort: dto.ftpPort ?? 21,
      wwwPort: dto.wwwPort ?? 80,
      identityName: dto.identityName ?? null,
      boardName: dto.boardName ?? null,
      routerOsVersion: dto.routerOsVersion ?? null,
      status: 'pending',
      tags: dto.tags ?? [],
    };
    const row = await this.db.routers.create(data);
    await this.audit.append({
      actorId: actor?.sub,
      routerId: row.id,
      action: 'router.create',
      entityType: 'router',
      entityId: row.id,
      after: { uuid: row.uuid, tunnelIp: row.tunnelIp },
      result: 'done',
    });
    return toDto(row);
  }

  async findAll(opts: {
    page?: number;
    pageSize?: number;
    siteId?: string;
    status?: RouterStatus;
    tag?: string;
  } = {}): Promise<Paginated<Router>> {
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 50, 500);
    const where: Record<string, unknown> = {};
    if (opts.siteId) where.siteId = opts.siteId;
    if (opts.status) where.status = opts.status;
    const total = opts.tag
      ? (await this.db.routers.findMany({ where })).filter((r) => (r.tags ?? []).includes(opts.tag!)).length
      : await this.db.routers.count(where);
    let rows = await this.db.routers.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...(!opts.tag ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    });
    // Tag filtering is done in the service (not the port contract) so both
    // the Prisma adapter and the in-memory fake behave identically.
    if (opts.tag) {
      rows = rows
        .filter((r) => (r.tags ?? []).includes(opts.tag!))
        .slice((page - 1) * pageSize, page * pageSize);
    }
    return { items: rows.map(toDto), total, page, pageSize };
  }

  /**
   * Resolve a router selector ({ routerIds?, tag? }) to concrete router ids.
   * Used by tag-based bulk operations.
   */
  async resolveSelector(selector: { routerIds?: string[]; tag?: string }): Promise<string[]> {
    const ids = new Set<string>();
    if (selector.routerIds) {
      for (const id of selector.routerIds) {
        const r = await this.db.routers.findUnique({ id });
        if (r && r.status !== 'decommissioned') ids.add(r.id);
      }
    }
    if (selector.tag) {
      const rows = await this.db.routers.findMany({});
      for (const r of rows) {
        if (r.status !== 'decommissioned' && (r.tags ?? []).includes(selector.tag)) ids.add(r.id);
      }
    }
    return [...ids];
  }

  async findOne(id: string): Promise<Router> {
    return toDto(await this.require(id));
  }

  async findByUuid(uuid: string): Promise<Router | null> {
    const row = await this.db.routers.findUnique({ uuid });
    return row ? toDto(row) : null;
  }

  async update(id: string, dto: UpdateRouterDto, actor?: CurrentUserType): Promise<Router> {
    const before = await this.require(id);
    if (dto.siteId !== undefined && dto.siteId !== null) {
      const site = await this.db.sites.findUnique({ id: dto.siteId });
      if (!site || site.deletedAt) throw new NotFoundException(`site ${dto.siteId} not found`);
    }
    const patch: Record<string, unknown> = {};
    for (const k of [
      'siteId', 'apiPort', 'apiSslPort', 'winboxPort', 'sshPort',
      'telnetPort', 'ftpPort', 'wwwPort', 'identityName', 'boardName',
      'routerOsVersion', 'serialNumber', 'status', 'tags',
    ] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    const row = await this.db.routers.update({ id }, patch);
    await this.audit.append({
      actorId: actor?.sub,
      routerId: id,
      action: 'router.update',
      entityType: 'router',
      entityId: id,
      before: { status: before.status },
      after: { status: row.status },
      result: 'done',
    });
    return toDto(row);
  }

  /**
   * Decommission: mark the row, enqueue hub-secret removal + cleanup.
   * The row is kept for audit/history.
   */
  async decommission(id: string, actor?: CurrentUserType): Promise<Router> {
    const row = await this.require(id);
    const opId = newOpId();
    const updated = await this.db.routers.update(
      { id },
      { status: 'decommissioned', decommissionedAt: new Date() },
    );
    await this.jobs.add('provision', 'decommission', {
      kind: 'provision',
      type: 'decommission',
      opId,
      routerId: id,
      sstpUsername: row.sstpUsername,
    }, { jobId: opId });
    await this.audit.append({
      actorId: actor?.sub,
      routerId: id,
      action: 'router.decommission',
      entityType: 'router',
      entityId: id,
      opId,
      result: 'pending',
    });
    return toDto(updated);
  }

  /** Last-known status from the platform's point of view (worker heartbeats). */
  async getStatus(id: string): Promise<{ id: string; status: RouterStatus; lastSeen?: string | null }> {
    const row = await this.require(id);
    return { id: row.id, status: row.status, lastSeen: row.lastSeen?.toISOString() ?? null };
  }

  /** Worker heartbeat path: mark online. Returns true when the status flipped. */
  async markSeen(id: string, info: { version?: string; board?: string } = {}): Promise<boolean> {
    const row = await this.require(id);
    const was = row.status;
    const patch: Record<string, unknown> = { lastSeen: new Date() };
    if (was !== 'online') patch.status = 'online';
    if (info.version) patch.routerOsVersion = info.version;
    if (info.board) patch.boardName = info.board;
    await this.db.routers.update({ id }, patch);
    return was !== 'online';
  }

  /** Worker path: mark offline (downtime ledger is owned by monitoring). */
  async markOffline(id: string): Promise<boolean> {
    const row = await this.require(id);
    if (row.status === 'offline') return false;
    await this.db.routers.update({ id }, { status: 'offline' });
    return true;
  }

  /** Worker registry path: ids of every router still under management. */
  async listIdsForWorker(): Promise<string[]> {
    const rows = await this.db.routers.findMany({});
    return rows.filter((r) => r.status !== 'decommissioned').map((r) => r.id);
  }

  /**
   * Worker path: raw row view including the vault references. Internal use
   * only — the refs must never reach a panel DTO; the internal controller
   * resolves them through the vault at call time.
   */
  async getWorkerView(id: string): Promise<WorkerRouterView> {
    const r = await this.require(id);
    return {
      id: r.id,
      uuid: r.uuid,
      tunnelIp: r.tunnelIp,
      sstpUsername: r.sstpUsername,
      sstpPasswordRef: r.sstpPasswordRef,
      apiUsername: r.apiUsername,
      apiPasswordRef: r.apiPasswordRef,
      apiPort: r.apiPort,
      ftpPort: r.ftpPort,
      identityName: r.identityName,
      status: r.status,
    };
  }

  /**
   * Worker completion report for a decommission. Unlike {@link decommission}
   * this does NOT enqueue hub cleanup — the worker has already removed the
   * hub secret when it reports back; it only flips the row and audits.
   */
  async markDecommissioned(id: string): Promise<void> {
    const row = await this.require(id);
    if (row.status !== 'decommissioned') {
      await this.db.routers.update(
        { id },
        { status: 'decommissioned', decommissionedAt: new Date() },
      );
    }
    await this.audit.append({
      routerId: id,
      action: 'router.decommission',
      entityType: 'router',
      entityId: id,
      result: 'done',
    });
  }

  private async require(id: string): Promise<RouterRow> {
    const row = await this.db.routers.findUnique({ id });
    if (!row) throw new NotFoundException(`router ${id} not found`);
    return row;
  }
}

/** Raw router view for the worker's internal endpoints (includes vault refs). */
export interface WorkerRouterView {
  id: string;
  uuid: string;
  tunnelIp: string;
  sstpUsername: string;
  sstpPasswordRef: string;
  apiUsername: string;
  apiPasswordRef: string;
  apiPort: number;
  ftpPort: number;
  identityName: string | null;
  status: RouterStatus;
}

export function toDto(r: RouterRow): Router {
  return {
    id: r.id,
    uuid: r.uuid,
    siteId: r.siteId,
    tunnelIp: r.tunnelIp,
    sstpUsername: r.sstpUsername,
    apiUsername: r.apiUsername,
    apiPort: r.apiPort,
    apiSslPort: r.apiSslPort,
    winboxPort: r.winboxPort,
    sshPort: r.sshPort,
    telnetPort: r.telnetPort,
    ftpPort: r.ftpPort,
    wwwPort: r.wwwPort,
    status: r.status,
    lastSeen: r.lastSeen?.toISOString() ?? null,
    routerOsVersion: r.routerOsVersion,
    boardName: r.boardName,
    serialNumber: r.serialNumber,
    identityName: r.identityName,
    tags: r.tags ?? [],
    flapCount: r.flapCount,
    pollerShard: r.pollerShard,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    decommissionedAt: r.decommissionedAt?.toISOString() ?? null,
  };
}

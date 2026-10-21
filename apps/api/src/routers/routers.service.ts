import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RosConnection, replyRows } from '@mtk/ros-api';
import { newOpId, type Paginated, type Router, type RouterStatus } from '@mtk/types';
import { AuditService } from '../audit/audit.service.js';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort, type NewRouter } from '../db/database.port.js';
import type { RouterRow } from '../db/rows.js';
import { EventsService } from '../events/events.module.js';
import { JOBS_PORT, type JobsPort } from '../jobs/jobs.module.js';
import {
  ProvisioningService,
  ROS_TRANSPORT_FACTORY,
  type RosTransportFactory,
  defaultTransportFactory,
} from '../provisioning/provisioning.service.js';
import { VAULT_PORT, type VaultPort } from '../vault/vault.port.js';
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
    @Inject(VAULT_PORT) private readonly vault: VaultPort,
    private readonly provisioning: ProvisioningService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    @Optional() @Inject(ROS_TRANSPORT_FACTORY) private readonly transportFactory?: RosTransportFactory,
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
    status?: RouterStatus | 'all';
    tag?: string;
    includeDecommissioned?: boolean;
    q?: string;
  } = {}): Promise<Paginated<Router>> {
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 50, 500);
    const where: Record<string, unknown> = {};
    if (opts.siteId) where.siteId = opts.siteId;
    if (opts.status && opts.status !== 'all') {
      where.status = opts.status;
    }

    let rows = await this.db.routers.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Exclude decommissioned by default unless explicitly requested
    if (opts.status !== 'decommissioned' && opts.status !== 'all' && !opts.includeDecommissioned) {
      if (!opts.status) {
        rows = rows.filter((r) => r.status !== 'decommissioned');
      }
    }

    // Tag filtering
    if (opts.tag) {
      rows = rows.filter((r) => (r.tags ?? []).includes(opts.tag!));
    }

    // Query search filtering
    if (opts.q) {
      const search = opts.q.toLowerCase().trim();
      rows = rows.filter(
        (r) =>
          (r.identityName && r.identityName.toLowerCase().includes(search)) ||
          (r.tunnelIp && r.tunnelIp.toLowerCase().includes(search)) ||
          (r.uuid && r.uuid.toLowerCase().includes(search)) ||
          (r.boardName && r.boardName.toLowerCase().includes(search)) ||
          (r.routerOsVersion && r.routerOsVersion.toLowerCase().includes(search)),
      );
    }

    const total = rows.length;
    const paginatedRows = rows.slice((page - 1) * pageSize, page * pageSize);
    return { items: paginatedRows.map(toDto), total, page, pageSize };
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

  /**
   * Permanently purge a router:
   * 1. Remove Hub PPP secret and disconnect active session
   * 2. Revoke Vault credentials
   * 3. Clean up associated DB entities (hotspot, queues, downtimes, backups, etc.)
   * 4. Remove Router row from database
   * 5. Emit real-time event and audit
   */
  async deletePermanently(id: string, actor?: CurrentUserType): Promise<{ id: string; success: boolean }> {
    const row = await this.require(id);
    const opId = newOpId();

    // 1. Hub cleanup: remove PPP secret and active session
    if (row.sstpUsername) {
      try {
        await this.provisioning.deleteHubSecretByName(row.sstpUsername);
      } catch (err) {
        console.warn(`[routers] deletePermanently: hub cleanup skipped for ${row.sstpUsername}:`, (err as Error).message);
      }
    }

    // 2. Vault cleanup: revoke stored credentials
    if (row.sstpPasswordRef) {
      await this.vault.revoke(row.sstpPasswordRef).catch(() => undefined);
    }
    if (row.apiPasswordRef) {
      await this.vault.revoke(row.apiPasswordRef).catch(() => undefined);
    }

    // 3. Clean up child records (both in Prisma Cascade and in-memory DB)
    try {
      const tokens = await this.db.onboardingTokens.findMany({});
      for (const t of tokens) {
        if (t.routerId === id || t.sstpUsername === row.sstpUsername || t.tunnelIp === row.tunnelIp) {
          await this.db.onboardingTokens.delete({ id: t.id }).catch(() => undefined);
        }
      }
    } catch {}

    await this.db.hotspotUsers.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.hotspotActiveSessions.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.hotspotBatches.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.hotspotWalledGardens.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.hotspotServers.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.hotspotUserProfiles.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.hotspotProfiles.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.firewallRules.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.firewallJournals.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.queues.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.downtimes.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.backups.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.backupSchedules.deleteMany({ routerId: id }).catch(() => undefined);
    await this.db.downstreamDevices.deleteMany({ routerId: id }).catch(() => undefined);

    // 4. Delete the Router row itself
    await this.db.routers.delete({ id });

    // 5. Emit real-time event and audit
    this.events.emitEvent('router.deleted', {
      routerId: id,
      uuid: row.uuid,
      tunnelIp: row.tunnelIp,
      at: new Date().toISOString(),
    });

    await this.audit.append({
      actorId: actor?.sub,
      action: 'router.purge',
      entityType: 'router',
      entityId: id,
      opId,
      before: { uuid: row.uuid, tunnelIp: row.tunnelIp, sstpUsername: row.sstpUsername },
      result: 'done',
    });

    return { id, success: true };
  }

  /**
   * Live test connection to a router:
   * Dials the router via ros-api on its tunnelIp and apiPort, validates credentials,
   * measures round-trip latency, updates status and system resource info.
   */
  async testConnection(id: string): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    details?: {
      identity?: string;
      version?: string;
      board?: string;
      uptime?: string;
      cpu?: number;
    };
  }> {
    const router = await this.require(id);
    const start = Date.now();
    try {
      const apiPassword = await this.vault.retrieve(router.apiPasswordRef);
      const factory = this.transportFactory ?? defaultTransportFactory;
      const transport = factory(router.tunnelIp, router.apiPort);
      const conn = new RosConnection(transport);

      try {
        await conn.connect();
        await conn.login(router.apiUsername, apiPassword);
        const latencyMs = Date.now() - start;

        let version: string | undefined;
        let board: string | undefined;
        let uptime: string | undefined;
        let cpu: number | undefined;
        let identity: string | undefined;

        try {
          const res = replyRows(await conn.talk(['/system/resource/print']));
          if (res[0]) {
            version = res[0]['version'];
            board = res[0]['board-name'];
            uptime = res[0]['uptime'];
            cpu = res[0]['cpu-load'] ? Number(res[0]['cpu-load']) : undefined;
          }
        } catch {}

        try {
          const idRes = replyRows(await conn.talk(['/system/identity/print']));
          if (idRes[0]) {
            identity = idRes[0]['name'];
          }
        } catch {}

        // Mark router as seen & online
        await this.db.routers.update(
          { id },
          {
            status: 'online',
            lastSeen: new Date(),
            ...(version ? { routerOsVersion: version } : {}),
            ...(board ? { boardName: board } : {}),
            ...(identity ? { identityName: identity } : {}),
          },
        );

        this.events.emitEvent('router.online', {
          routerId: id,
          uuid: router.uuid,
          tunnelIp: router.tunnelIp,
          at: new Date().toISOString(),
        });

        return {
          ok: true,
          latencyMs,
          message: 'Connection successful',
          details: { identity, version, board, uptime, cpu },
        };
      } finally {
        await conn.close().catch(() => undefined);
      }
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        ok: false,
        latencyMs,
        message: (err as Error).message || 'Connection failed',
      };
    }
  }

  /**
   * Synchronize hardware, version, identity, and serial number from the physical device.
   */
  async sync(id: string, actor?: CurrentUserType): Promise<{
    ok: boolean;
    message: string;
    router: Router;
  }> {
    const testRes = await this.testConnection(id);
    if (!testRes.ok) {
      return {
        ok: false,
        message: `Sync failed: ${testRes.message}`,
        router: toDto(await this.require(id)),
      };
    }

    const updated = await this.require(id);
    await this.audit.append({
      actorId: actor?.sub,
      routerId: id,
      action: 'router.sync',
      entityType: 'router',
      entityId: id,
      after: { lastSeen: updated.lastSeen, version: updated.routerOsVersion, board: updated.boardName },
      result: 'done',
    });

    return {
      ok: true,
      message: 'Router synchronized successfully',
      router: toDto(updated),
    };
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

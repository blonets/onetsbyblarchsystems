import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  fleetResult,
  type ActiveHotspotSession,
  type DowntimeEntry,
  type FleetResult,
  type MetricPoint,
  type MetricsIngestBatch,
  type MetricType,
  type RevenueToday,
  type RouterStatus,
  type RouterStatusPush,
} from '@mtk/types';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import { METRICS_STORE, type MetricsStore } from '../db/metrics-store.js';
import { EventsService } from '../events/events.module.js';
import { REALTIME_PORT, type RealtimePort } from '../realtime/realtime.port.js';
import { RoutersService } from '../routers/routers.service.js';

export interface HeartbeatInput {
  status: 'pending' | 'online' | 'offline' | 'suspect';
  cause?: string;
}

export interface SessionReport {
  username: string;
  address?: string | null;
  macAddress?: string | null;
  uptime?: string | null;
  server?: string | null;
}

export interface BulkSelector {
  routerIds?: string[];
  tag?: string;
}

/**
 * Monitoring — metrics ingest (from the worker pollers), heartbeat handling
 * with the downtime ledger, and read APIs for dashboards.
 *
 * The downtime ledger: one row per offline episode. Opened when the
 * connection-manager reports a router going offline (missed heartbeats),
 * closed on reconnect with `endedAt` + `durationS`.
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    @Inject(METRICS_STORE) private readonly metrics: MetricsStore,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
    private readonly events: EventsService,
    private readonly config: ConfigService,
    private readonly routers: RoutersService,
  ) {}

  // ------------------------------------------------------------- ingest --

  /**
   * Worker/internal endpoint: store a batch of poller metrics and refresh
   * `lastSeen` for every router that reported in.
   */
  async ingest(batch: MetricsIngestBatch): Promise<{ stored: number }> {
    await this.metrics.insertBatch(batch);
    const routerIds = new Set<string>();
    for (const m of batch.cpu ?? []) routerIds.add(m.routerId);
    for (const m of batch.mem ?? []) routerIds.add(m.routerId);
    for (const m of batch.traffic ?? []) routerIds.add(m.routerId);
    for (const m of batch.hotspotActive ?? []) routerIds.add(m.routerId);
    const now = new Date();
    for (const routerId of routerIds) {
      await this.db.routers.update({ id: routerId }, { lastSeen: now }).catch(() => undefined);
    }
    const stored =
      (batch.cpu?.length ?? 0) +
      (batch.mem?.length ?? 0) +
      (batch.traffic?.length ?? 0) +
      (batch.hotspotActive?.length ?? 0);
    return { stored };
  }

  // ----------------------------------------------------------- heartbeat --

  /**
   * Worker/internal endpoint: connection-manager heartbeat for one router.
   * Drives status transitions, the downtime ledger, bus events and the
   * realtime `router.status` push.
   */
  async heartbeat(routerId: string, input: HeartbeatInput): Promise<{ status: RouterStatus }> {
    const router = await this.db.routers.findUnique({ id: routerId });
    if (!router) throw new NotFoundException(`router ${routerId} not found`);
    const now = new Date();
    const prev = router.status as RouterStatus;

    if (prev === input.status) {
      await this.db.routers.update({ id: routerId }, { lastSeen: now });
      return { status: prev };
    }

    const updated = await this.db.routers.update({ id: routerId }, { status: input.status, lastSeen: now });
    const push: RouterStatusPush = {
      routerId,
      status: updated.status as RouterStatus,
      lastSeen: now.toISOString(),
    };
    this.realtime.emitToRouter(routerId, 'router.status', push);
    if (router.siteId) this.realtime.emitToSite(router.siteId, 'router.status', push);

    const at = now.toISOString();
    if (input.status === 'offline' && prev !== 'offline') {
      await this.db.downtimes.create({ routerId, cause: input.cause ?? 'heartbeat-missed' });
      this.events.emitEvent('router.offline', {
        routerId, uuid: router.uuid, at, cause: input.cause,
      });
      this.logger.warn(`router ${routerId} went offline (cause=${input.cause ?? 'heartbeat-missed'})`);
    } else if (input.status === 'online' && prev === 'offline') {
      await this.closeOpenDowntimes(routerId, now);
      this.events.emitEvent('router.online', {
        routerId, uuid: router.uuid, tunnelIp: router.tunnelIp, at,
      });
    }
    return { status: updated.status as RouterStatus };
  }

  private async closeOpenDowntimes(routerId: string, now: Date): Promise<void> {
    const open = await this.db.downtimes.findMany({ where: { routerId, endedAt: null } });
    for (const d of open) {
      const durationS = Math.max(0, Math.round((now.getTime() - d.startedAt.getTime()) / 1000));
      await this.db.downtimes.update({ id: d.id }, { endedAt: now, durationS }).catch(() => undefined);
    }
  }

  // --------------------------------------------------------------- reads --

  /**
   * Worker/internal endpoint: replace the router's reported active hotspot
   * sessions wholesale. The poller reports the full `/ip/hotspot/active`
   * list each cycle; this table is a read model for session search, not
   * history — stale rows are deleted, not kept.
   */
  async ingestSessions(routerId: string, sessions: SessionReport[]): Promise<{ stored: number }> {
    const router = await this.db.routers.findUnique({ id: routerId });
    if (!router) throw new NotFoundException(`router ${routerId} not found`);
    await this.db.hotspotActiveSessions.deleteMany({ routerId });
    const now = new Date();
    for (const s of sessions) {
      await this.db.hotspotActiveSessions.create({
        routerId,
        username: s.username,
        address: s.address ?? null,
        macAddress: s.macAddress ?? null,
        uptime: s.uptime ?? null,
        server: s.server ?? null,
      });
    }
    await this.db.routers.update({ id: routerId }, { lastSeen: now }).catch(() => undefined);
    return { stored: sessions.length };
  }

  /**
   * Session lookup: which router(s) a user is online on, by username and/or
   * IP. Aggregates the worker-reported active sessions.
   */
  async searchSessions(q: { username?: string; ip?: string }): Promise<ActiveHotspotSession[]> {
    if (!q.username && !q.ip) return [];
    const rows = await this.db.hotspotActiveSessions.findMany({});
    const uname = q.username?.toLowerCase();
    const hits = rows.filter((r) => {
      if (uname && r.username.toLowerCase() !== uname) return false;
      if (q.ip && r.address !== q.ip) return false;
      return true;
    });
    return hits.map((r) => ({
      routerId: r.routerId,
      username: r.username,
      address: r.address,
      macAddress: r.macAddress,
      uptime: r.uptime,
      server: r.server,
      reportedAt: r.reportedAt.toISOString(),
    }));
  }

  /**
   * Revenue tile: voucher-mode (`vc`) users whose FIRST login happened today
   * (UTC day) × their profile's face value. Profiles without a price count
   * as 0 — the tile is honest, never faked.
   */
  async revenueToday(now: Date = new Date()): Promise<RevenueToday> {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const users = await this.db.hotspotUsers.findMany({ where: { mode: 'vc' } });
    const redeemed = users.filter((u) => u.firstLoginAt && u.firstLoginAt >= start);
    const profiles = new Map(
      (await this.db.hotspotUserProfiles.findMany({})).map((p) => [p.id, p]),
    );
    let amount = 0;
    for (const u of redeemed) {
      const price = u.profileId ? profiles.get(u.profileId)?.price ?? null : null;
      amount += price ?? 0;
    }
    return {
      vouchersRedeemed: redeemed.length,
      amount: Math.round(amount * 100) / 100,
      currency: this.config.get<string>('REVENUE_CURRENCY') ?? 'EGP',
    };
  }

  /**
   * Bulk status read over a router selector ({ routerIds?, tag? }).
   * Returns a FleetResult — one entry per router; a failure is recorded on
   * its item and never stops the remaining routers.
   */
  async bulkStatus(selector: BulkSelector): Promise<FleetResult<{ status: RouterStatus; lastSeen: string | null }>> {
    const ids = await this.routers.resolveSelector(selector);
    return fleetResult(
      ids.map((routerId) => ({
        routerId,
        run: async () => {
          const row = await this.db.routers.findUnique({ id: routerId });
          if (!row) throw new NotFoundException(`router ${routerId} not found`);
          return {
            status: row.status as RouterStatus,
            lastSeen: row.lastSeen ? row.lastSeen.toISOString() : null,
          };
        },
      })),
    );
  }

  async getMetrics(
    routerId: string,
    type: MetricType,
    from: Date,
    to: Date,
    opts: { iface?: string; limit?: number } = {},
  ): Promise<MetricPoint[]> {
    const router = await this.db.routers.findUnique({ id: routerId });
    if (!router) throw new NotFoundException(`router ${routerId} not found`);
    return this.metrics.query(type, routerId, from, to, opts);
  }

  async listDowntime(routerId: string, page = 1, pageSize = 50): Promise<{ items: DowntimeEntry[]; total: number }> {
    const router = await this.db.routers.findUnique({ id: routerId });
    if (!router) throw new NotFoundException(`router ${routerId} not found`);
    const size = Math.min(pageSize, 500);
    const total = await this.db.downtimes.count({ routerId });
    const rows = await this.db.downtimes.findMany({
      where: { routerId },
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * size,
      take: size,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        routerId: r.routerId,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt ? r.endedAt.toISOString() : null,
        durationS: r.durationS,
        cause: r.cause,
      })),
      total,
    };
  }
}

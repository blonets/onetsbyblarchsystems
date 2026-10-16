import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  DowntimeEntry,
  MetricPoint,
  MetricsIngestBatch,
  MetricType,
  RouterStatus,
  RouterStatusPush,
} from '@mtk/types';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import { METRICS_STORE, type MetricsStore } from '../db/metrics-store.js';
import { EventsService } from '../events/events.module.js';
import { REALTIME_PORT, type RealtimePort } from '../realtime/realtime.port.js';

export interface HeartbeatInput {
  status: 'pending' | 'online' | 'offline' | 'suspect';
  cause?: string;
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

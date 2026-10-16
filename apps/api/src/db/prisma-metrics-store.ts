import type { MetricsIngestBatch, MetricPoint, MetricType } from '@mtk/types';
import type { PrismaService } from './prisma.service.js';
import type { MetricsStore } from './metrics-store.js';

/**
 * TimescaleDB-backed {@link MetricsStore} using Prisma raw queries.
 * Inserts go through `unnest`-based batch statements (COPY-style throughput
 * without a dedicated driver); reads hit the hypertables directly.
 */
export class PrismaMetricsStore implements MetricsStore {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): {
    $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>;
    $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<MetricPoint[]>;
  } {
    return this.prisma.db;
  }

  async insertBatch(batch: MetricsIngestBatch): Promise<void> {
    const db = this.db;
    if (batch.cpu?.length) {
      const ts = batch.cpu.map((p) => new Date(p.ts));
      const ids = batch.cpu.map((p) => p.routerId);
      const vals = batch.cpu.map((p) => p.cpuPct);
      await db.$executeRaw`
        INSERT INTO metric_cpu (ts, router_id, cpu_pct)
        SELECT * FROM unnest(${ts}::timestamptz[], ${ids}::text[], ${vals}::float8[])`;
    }
    if (batch.mem?.length) {
      const ts = batch.mem.map((p) => new Date(p.ts));
      const ids = batch.mem.map((p) => p.routerId);
      const total = batch.mem.map((p) => BigInt(p.totalKb));
      const free = batch.mem.map((p) => BigInt(p.freeKb));
      await db.$executeRaw`
        INSERT INTO metric_mem (ts, router_id, total_kb, free_kb)
        SELECT * FROM unnest(${ts}::timestamptz[], ${ids}::text[], ${total}::bigint[], ${free}::bigint[])`;
    }
    if (batch.traffic?.length) {
      const ts = batch.traffic.map((p) => new Date(p.ts));
      const ids = batch.traffic.map((p) => p.routerId);
      const ifaces = batch.traffic.map((p) => p.iface);
      const rx = batch.traffic.map((p) => BigInt(p.rxBps));
      const tx = batch.traffic.map((p) => BigInt(p.txBps));
      await db.$executeRaw`
        INSERT INTO metric_traffic (ts, router_id, iface, rx_bps, tx_bps)
        SELECT * FROM unnest(${ts}::timestamptz[], ${ids}::text[], ${ifaces}::text[], ${rx}::bigint[], ${tx}::bigint[])`;
    }
    if (batch.hotspotActive?.length) {
      const ts = batch.hotspotActive.map((p) => new Date(p.ts));
      const ids = batch.hotspotActive.map((p) => p.routerId);
      const n = batch.hotspotActive.map((p) => p.activeN);
      await db.$executeRaw`
        INSERT INTO metric_hotspot_active (ts, router_id, active_n)
        SELECT * FROM unnest(${ts}::timestamptz[], ${ids}::text[], ${n}::int[])`;
    }
  }

  async query(
    type: MetricType,
    routerId: string,
    from: Date,
    to: Date,
    opts: { iface?: string; limit?: number } = {},
  ): Promise<MetricPoint[]> {
    const db = this.db;
    const limit = opts.limit ?? 1000;
    switch (type) {
      case 'cpu':
        return db.$queryRaw`
          SELECT ts::text AS ts, cpu_pct AS "cpuPct" FROM metric_cpu
          WHERE router_id = ${routerId} AND ts >= ${from} AND ts <= ${to}
          ORDER BY ts DESC LIMIT ${limit}`;
      case 'mem':
        return db.$queryRaw`
          SELECT ts::text AS ts, total_kb::text AS "totalKb", free_kb::text AS "freeKb" FROM metric_mem
          WHERE router_id = ${routerId} AND ts >= ${from} AND ts <= ${to}
          ORDER BY ts DESC LIMIT ${limit}`;
      case 'traffic':
        if (opts.iface) {
          return db.$queryRaw`
            SELECT ts::text AS ts, iface, rx_bps::text AS "rxBps", tx_bps::text AS "txBps" FROM metric_traffic
            WHERE router_id = ${routerId} AND iface = ${opts.iface} AND ts >= ${from} AND ts <= ${to}
            ORDER BY ts DESC LIMIT ${limit}`;
        }
        return db.$queryRaw`
          SELECT ts::text AS ts, iface, rx_bps::text AS "rxBps", tx_bps::text AS "txBps" FROM metric_traffic
          WHERE router_id = ${routerId} AND ts >= ${from} AND ts <= ${to}
          ORDER BY ts DESC LIMIT ${limit}`;
      case 'hotspot_active':
        return db.$queryRaw`
          SELECT ts::text AS ts, active_n AS "activeN" FROM metric_hotspot_active
          WHERE router_id = ${routerId} AND ts >= ${from} AND ts <= ${to}
          ORDER BY ts DESC LIMIT ${limit}`;
    }
  }
}

import type {
  CpuMetric,
  HotspotActiveMetric,
  MemMetric,
  MetricPoint,
  MetricType,
  MetricsIngestBatch,
  TrafficMetric,
} from '@mtk/types';

/**
 * Write-mostly store for the TimescaleDB hypertables (`metric_cpu`,
 * `metric_mem`, `metric_traffic`, `metric_hotspot_active` — see migration
 * `0002_timescale`). The poller inserts in batches; dashboards read rollups.
 */
export interface MetricsStore {
  insertBatch(batch: MetricsIngestBatch): Promise<void>;
  query(
    type: MetricType,
    routerId: string,
    from: Date,
    to: Date,
    opts?: { iface?: string; limit?: number },
  ): Promise<MetricPoint[]>;
}

export const METRICS_STORE = Symbol('METRICS_STORE');

/** In-memory metrics store (tests / DB-less dev). Bounded to 50k points. */
export class InMemoryMetricsStore implements MetricsStore {
  private readonly cpu: CpuMetric[] = [];
  private readonly mem: MemMetric[] = [];
  private readonly traffic: TrafficMetric[] = [];
  private readonly hotspotActive: HotspotActiveMetric[] = [];

  async insertBatch(batch: MetricsIngestBatch): Promise<void> {
    if (batch.cpu) this.cpu.push(...batch.cpu);
    if (batch.mem) this.mem.push(...batch.mem);
    if (batch.traffic) this.traffic.push(...batch.traffic);
    if (batch.hotspotActive) this.hotspotActive.push(...batch.hotspotActive);
    for (const arr of [this.cpu, this.mem, this.traffic, this.hotspotActive]) {
      if (arr.length > 50_000) arr.splice(0, arr.length - 50_000);
    }
  }

  async query(
    type: MetricType,
    routerId: string,
    from: Date,
    to: Date,
    opts: { iface?: string; limit?: number } = {},
  ): Promise<MetricPoint[]> {
    const inRange = (ts: string): boolean => {
      const t = new Date(ts).getTime();
      return t >= from.getTime() && t <= to.getTime();
    };
    const limit = opts.limit ?? 1000;
    switch (type) {
      case 'cpu':
        return this.cpu
          .filter((p) => p.routerId === routerId && inRange(p.ts))
          .slice(-limit)
          .map((p) => ({ ts: p.ts, cpuPct: p.cpuPct }));
      case 'mem':
        return this.mem
          .filter((p) => p.routerId === routerId && inRange(p.ts))
          .slice(-limit)
          .map((p) => ({ ts: p.ts, totalKb: p.totalKb, freeKb: p.freeKb }));
      case 'traffic':
        return this.traffic
          .filter((p) => p.routerId === routerId && inRange(p.ts) && (!opts.iface || p.iface === opts.iface))
          .slice(-limit)
          .map((p) => ({ ts: p.ts, iface: p.iface, rxBps: p.rxBps, txBps: p.txBps }));
      case 'hotspot_active':
        return this.hotspotActive
          .filter((p) => p.routerId === routerId && inRange(p.ts))
          .slice(-limit)
          .map((p) => ({ ts: p.ts, activeN: p.activeN }));
    }
  }
}

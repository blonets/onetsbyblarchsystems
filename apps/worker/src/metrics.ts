/**
 * Metrics collection: normalization, rate tracking, ingest.
 *
 * Pollers collect raw `/system/resource/print` rows, `/interface/monitor-traffic`
 * samples and `/ip/hotspot/active` counts, normalize them into the canonical
 * {@link MetricsIngestBatch} (`cpu` / `mem` / `traffic` / `hotspot_active`),
 * and hand the batch to a {@link MetricsIngest}. The deploy-time ingest
 * enqueues the batch on the `metrics-ingest` BullMQ queue for the API to
 * persist (TimescaleDB DDL: `migrations/001-metrics.sql`).
 */

import type { MetricsIngestBatch } from '@mtk/types';

/** Parse RouterOS uptime ("1d2h3m4s", "12:34:56", "5m") into seconds. */
export function parseUptimeSeconds(uptime: string | undefined): number | undefined {
  if (!uptime) return undefined;
  const clock = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(uptime.trim());
  if (clock) {
    return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }
  const parts = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(
    uptime.trim(),
  );
  if (!parts || parts[0] === '') return undefined;
  const [, w, d, h, m, s] = parts;
  return (
    Number(w ?? 0) * 604800 +
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(m ?? 0) * 60 +
    Number(s ?? 0)
  );
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Normalize one poll cycle's raw rows into a canonical metrics-ingest batch.
 *
 * `monitor-traffic =once` (verified live on RouterOS 6.49.17) reports
 * per-second rates directly (`rx-bits-per-second` / `tx-bits-per-second`) —
 * cumulative counters (`rx-bytes` / `tx-bytes`) only appear in continuous
 * mode. Rates are taken from the snapshot when present; the supplied
 * {@link RateTracker} derives them from cumulative counters as a fallback
 * (e.g. scripted fixtures).
 */
export function normalizeMetrics(args: {
  ts: string;
  routerId: string;
  resource: Record<string, string>;
  traffic: Record<string, string>[];
  hotspotActive: number;
  hotspotUsers: number;
  tracker: RateTracker;
}): MetricsIngestBatch {
  const { ts, routerId, resource, traffic, hotspotActive, tracker } = args;
  const batch: MetricsIngestBatch = {};

  const cpuPct = num(resource['cpu-load']);
  if (cpuPct !== undefined) batch.cpu = [{ ts, routerId, cpuPct }];

  const totalMem = num(resource['total-memory']);
  const freeMem = num(resource['free-memory']);
  if (totalMem !== undefined || freeMem !== undefined) {
    batch.mem = [
      {
        ts,
        routerId,
        // resource reports bytes; the canonical mem metric is kilobytes
        totalKb: Math.round((totalMem ?? 0) / 1024),
        freeKb: Math.round((freeMem ?? 0) / 1024),
      },
    ];
  }

  const trafficRows = traffic
    .map((row) => {
      const iface = row['name'];
      if (!iface) return undefined;
      // `=once` snapshots carry per-second rates directly (live-verified).
      const rxBpsOnce = num(row['rx-bits-per-second']);
      const txBpsOnce = num(row['tx-bits-per-second']);
      if (rxBpsOnce !== undefined && txBpsOnce !== undefined) {
        return { ts, routerId, iface, rxBps: Math.round(rxBpsOnce), txBps: Math.round(txBpsOnce) };
      }
      // Fallback: derive from cumulative counters (continuous mode / fixtures).
      const rxBytes = num(row['rx-bytes']) ?? 0;
      const txBytes = num(row['tx-bytes']) ?? 0;
      const { rxBps, txBps } = tracker.rate(routerId, iface, ts, rxBytes, txBytes);
      return { ts, routerId, iface, rxBps, txBps };
    })
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (trafficRows.length > 0) batch.traffic = trafficRows;

  batch.hotspotActive = [{ ts, routerId, activeN: hotspotActive }];

  return batch;
}

export interface MetricsIngest {
  ingest(batch: MetricsIngestBatch): Promise<void>;
}

/** In-memory ingest for tests: collects batches per router. */
export class InMemoryMetricsIngest implements MetricsIngest {
  readonly batches: MetricsIngestBatch[] = [];

  async ingest(batch: MetricsIngestBatch): Promise<void> {
    this.batches.push(batch);
  }

  latestFor(routerId: string): MetricsIngestBatch | undefined {
    return [...this.batches]
      .reverse()
      .find(
        (b) =>
          b.cpu?.[0]?.routerId === routerId ||
          b.mem?.[0]?.routerId === routerId ||
          b.traffic?.[0]?.routerId === routerId ||
          b.hotspotActive?.[0]?.routerId === routerId,
      );
  }

  clear(): void {
    this.batches.length = 0;
  }
}

/**
 * Per-interface cumulative-byte → bits/sec tracker.
 * Continuous (non-`=once`) `monitor-traffic` reports cumulative counters;
 * rates are derived from the delta over the previous sample. Counter resets
 * (reboot) yield 0 rather than a negative spike.
 */
export class RateTracker {
  private readonly prev = new Map<string, { ts: number; rx: number; tx: number }>();

  rate(
    routerId: string,
    iface: string,
    tsIso: string,
    rxBytes: number,
    txBytes: number,
  ): { rxBps: number; txBps: number } {
    const key = `${routerId}\u0000${iface}`;
    const ts = Date.parse(tsIso);
    const last = this.prev.get(key);
    this.prev.set(key, { ts, rx: rxBytes, tx: txBytes });
    if (!last || ts <= last.ts) return { rxBps: 0, txBps: 0 };
    const dt = (ts - last.ts) / 1000;
    const rxBps = rxBytes >= last.rx ? ((rxBytes - last.rx) * 8) / dt : 0;
    const txBps = txBytes >= last.tx ? ((txBytes - last.tx) * 8) / dt : 0;
    return { rxBps: Math.round(rxBps), txBps: Math.round(txBps) };
  }
}

/**
 * Poller gap detection (ARCH §4/§5): when the wall-clock gap between two
 * completed polls for a router exceeds 2× the expected cadence, the poller
 * missed cycles (replica crash, Redis stall, …). Gaps are recorded so
 * dashboards can annotate them instead of interpolating it.
 */
export class GapTracker {
  private readonly lastPoll = new Map<string, number>();
  readonly gaps: Array<{ routerId: string; at: string; gapSec: number }> = [];

  /**
   * Record a completed poll at `nowMs`. Returns the gap in seconds when it
   * exceeds `2 * cadenceSec`, otherwise null.
   */
  observe(routerId: string, nowMs: number, cadenceSec: number): number | null {
    const last = this.lastPoll.get(routerId);
    this.lastPoll.set(routerId, nowMs);
    if (last === undefined) return null;
    const gapSec = (nowMs - last) / 1000;
    if (gapSec > 2 * cadenceSec) {
      this.gaps.push({ routerId, at: new Date(nowMs).toISOString(), gapSec });
      return gapSec;
    }
    return null;
  }
}

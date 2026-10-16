/**
 * Sharded metrics poller.
 *
 * One tick per shard every 60 s (BullMQ repeatable `poll-tick` on the
 * worker-internal `poll` queue). For each owned router
 * (`fnv1a(uuid) % shardCount`, staggered inside the tick) it collects,
 * normalizes and ingests:
 * - `/system/resource/print` → cpu %, memory
 * - `/interface/print` → interface names, then `/interface/monitor-traffic
 *   =interface=<name> =once` per interface → per-second rx/tx bps
 *   (live-verified on 6.49.17: the bare aggregate call returns one nameless
 *   row, and `=once` reports rates, not cumulative counters)
 * - `/ip/hotspot/active/print` → active session count
 * - `/ip/hotspot/user/print` → provisioned hotspot user count
 *
 * Normalized batches use the canonical {@link MetricsIngestBatch} shape and
 * are handed to the {@link MetricsIngest} (deploy-time: enqueued on the
 * `metrics-ingest` queue for the API to persist).
 *
 * A single dead router never kills the tick: failures are counted, fed to the
 * health monitor (3 missed heartbeats → offline + downtime ledger), and
 * reported. Poller gaps (>2× cadence between completed polls) are recorded so
 * dashboards can annotate missing data instead of interpolating it.
 */

import type { Job } from 'bullmq';
import { replyRows, resourcePrint, hotspotUserList, interfaceList } from '@mtk/ros-api';
import type { ConnectionManager } from '../connection-manager.js';
import { selectShardRouterIds } from '../sharding.js';
import { hotspotActiveList, interfaceMonitorTrafficOnce } from '../ros-ext.js';
import {
  GapTracker,
  RateTracker,
  normalizeMetrics,
  type MetricsIngest,
} from '../metrics.js';

export interface PollerJobData {
  shardIndex: number;
  shardCount: number;
}

export interface PollerDeps {
  manager: ConnectionManager;
  listRouterIds: () => Promise<string[]>;
  ingest: MetricsIngest;
  /** expected cadence in seconds (default 60) — used for gap detection */
  cadenceSec?: number;
  /** max ms of random stagger between routers inside one tick (default 2000) */
  staggerMs?: number;
  /** activity callback so the health monitor counts polls as heartbeats */
  noteActivity?: (routerId: string) => void;
  now?: () => number;
}

export interface PollerResult {
  polled: number;
  failed: number;
  gaps: Array<{ routerId: string; gapSec: number }>;
}

export function createPollerProcessor(deps: PollerDeps) {
  const cadenceSec = deps.cadenceSec ?? 60;
  const staggerMs = deps.staggerMs ?? 2000;
  const now = deps.now ?? Date.now;
  const tracker = new RateTracker();
  const gaps = new GapTracker();

  return async (job: Job<PollerJobData>): Promise<PollerResult> => {
    const { shardIndex, shardCount } = job.data;
    const mine = selectShardRouterIds(await deps.listRouterIds(), shardIndex, shardCount);
    let failed = 0;
    const gapHits: PollerResult['gaps'] = [];

    for (const routerId of mine) {
      if (staggerMs > 0) {
        await sleep(Math.random() * staggerMs);
      }
      const tickStart = now();
      try {
        const batch = await pollRouter(deps.manager, routerId, tracker, now);
        await deps.ingest.ingest(batch);
        deps.manager.recordProbe(routerId, true);
        deps.noteActivity?.(routerId);
        const gapSec = gaps.observe(routerId, tickStart, cadenceSec);
        if (gapSec !== null) gapHits.push({ routerId, gapSec });
      } catch (err) {
        failed++;
        deps.manager.recordProbe(routerId, false);
        deps.manager.reportFailure(routerId, (err as Error).message);
      }
    }
    return { polled: mine.length - failed, failed, gaps: gapHits };
  };
}

/** One poll cycle against a single router. Exported for live validation. */
export async function pollRouter(
  manager: ConnectionManager,
  routerId: string,
  tracker: RateTracker,
  now: () => number = Date.now,
) {
  const ts = new Date(now()).toISOString();
  return manager.execute(routerId, async (conn) => {
    // Sequential: one session carries one in-flight command at a time.
    const resourceReplies = await conn.talk(resourcePrint());
    // monitor-traffic without =interface= returns ONE aggregate row with no
    // name (and =once gives rates, not counters) — verified live on 6.49.17.
    // So list interfaces first, then snapshot each one for per-interface rows.
    const ifaceRows = replyRows(await conn.talk(interfaceList()));
    const ifaces = ifaceRows.map((r) => r['name']).filter((n): n is string => !!n);
    const trafficRows: Record<string, string>[] = [];
    if (ifaces.length === 0) {
      trafficRows.push(...replyRows(await conn.talk(interfaceMonitorTrafficOnce())));
    } else {
      for (const iface of ifaces) {
        trafficRows.push(...replyRows(await conn.talk(interfaceMonitorTrafficOnce(iface))));
      }
    }
    const activeReplies = await conn.talk(hotspotActiveList());
    const userReplies = await conn.talk(hotspotUserList());
    return normalizeMetrics({
      ts,
      routerId,
      resource: replyRows(resourceReplies)[0] ?? {},
      traffic: trafficRows,
      hotspotActive: replyRows(activeReplies).length,
      hotspotUsers: replyRows(userReplies).length,
      tracker,
    });
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

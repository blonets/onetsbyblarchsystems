import type { Job } from 'bullmq';
import { replyRows, resourcePrint } from '@mtk/ros-api';
import type { ConnectionManager } from '../connection-manager.js';
import { selectShardRouterIds } from '../sharding.js';

export interface PollerJobData {
  shardIndex: number;
  shardCount: number;
}

export interface PollerDeps {
  manager: ConnectionManager;
  /** TODO: fetch live router ids from the API/DB (Router table). */
  listRouterIds: () => Promise<string[]>;
  /** TODO: write to the RouterMetric TimescaleDB hypertable. */
  recordMetrics: (routerId: string, metrics: Record<string, string>) => Promise<void>;
}

/**
 * Poll tick for one shard: for every owned router, ensure a session and read
 * `/system/resource/print`. Failures are recorded in the downtime ledger and
 * counted — a single dead router never kills the tick.
 */
export function createPollerProcessor(deps: PollerDeps) {
  return async (job: Job<PollerJobData>): Promise<{ polled: number; failed: number }> => {
    const { shardIndex, shardCount } = job.data;
    const mine = selectShardRouterIds(await deps.listRouterIds(), shardIndex, shardCount);
    let failed = 0;
    for (const routerId of mine) {
      try {
        const conn = await deps.manager.ensure(routerId);
        const replies = await conn.talk(resourcePrint());
        const row = replyRows(replies)[0] ?? {};
        await deps.recordMetrics(routerId, row);
      } catch (err) {
        failed++;
        deps.manager.reportFailure(routerId, (err as Error).message);
      }
    }
    return { polled: mine.length - failed, failed };
  };
}

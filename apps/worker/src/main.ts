import { Queue, Worker } from 'bullmq';
import { ConnectionManager } from './connection-manager.js';
import { createBackupProcessor } from './jobs/backup.job.js';
import { createPollerProcessor } from './jobs/poller.job.js';

async function main(): Promise<void> {
  const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
  const shardIndex = Number(process.env.WORKER_SHARD_INDEX ?? 0);
  const shardCount = Number(process.env.WORKER_SHARD_COUNT ?? 1);

  // TODO: build the real connection factory — resolve each router's tunnel IP +
  // apiPort from the API/DB, connect over the SSTP tunnel with backoff
  // (RosConnection.withReconnect), and log in with the vaulted per-router API
  // credentials. Each site router gets its own API user on first provision.
  const manager = new ConnectionManager(async (routerId: string) => {
    throw new Error(`TODO: connection factory not wired for router ${routerId}`);
  });

  const poller = new Worker(
    'mtk-poll',
    createPollerProcessor({
      manager,
      listRouterIds: async () => {
        throw new Error('TODO: list router ids from the API/DB');
      },
      recordMetrics: async () => {
        // TODO: write to the RouterMetric TimescaleDB hypertable
      },
    }),
    { connection },
  );

  const backups = new Worker(
    'mtk-backup',
    createBackupProcessor({
      manager,
      storeBackup: async () => {
        throw new Error('TODO: object storage not wired');
      },
    }),
    { connection },
  );

  // Repeatable poll schedule owned by this replica's shard.
  const pollQueue = new Queue('mtk-poll', { connection });
  await pollQueue.upsertJobScheduler(
    'poll-tick',
    { every: Number(process.env.POLL_INTERVAL_MS ?? 60_000) },
    { data: { shardIndex, shardCount } },
  );

  const shutdown = async (): Promise<void> => {
    await Promise.all([poller.close(), backups.close(), pollQueue.close()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  // eslint-disable-next-line no-console
  console.log(`@mtk/worker up (shard ${shardIndex}/${shardCount})`);
}

void main();

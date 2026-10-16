/**
 * @mtk/worker entrypoint — wires every queue, the connection manager, the
 * health monitor, and the schedulers.
 *
 * Queue names and job/event shapes are the canonical contracts from
 * `@mtk/types` (the API enqueues to these exact names):
 * commands, provision, backup, metrics-ingest, quota, notify.
 * The poller is worker-internal (`poll` queue, repeatable `poll-tick`); the
 * hotspot expiry sweep is worker-internal too (`expiry` queue, repeatable
 * `expiry-sweep-tick` every 15 min).
 *
 * Schedulers owned by this replica:
 * - `poll-tick` every 60 s → polls this replica's shard → `metrics-ingest`
 * - `quota-tick` every 5 min → one `quota` job per owned router
 * - `expiry-sweep-tick` every 15 min → one `hotspot-expiry-sweep` job per owned router
 * - `backup-janitor` daily 03:30 → retention cleanup
 * - per-router `backup-<id>` daily 02:00–05:00 staggered (ARCH §3.4)
 *
 * Environment:
 *   REDIS_URL, DATABASE_URL (deploy-time repositories),
 *   WORKER_SHARD_INDEX / WORKER_SHARD_COUNT,
 *   API_BASE_URL + WORKER_SERVICE_TOKEN (router registry, audit, results),
 *   BACKUP_KMS_KEY (64 hex chars), BACKUP_KMS_KEY_ID, BACKUP_DIR,
 *   HUB_ROUTER_ID, ALLOW_HUB_MUTATIONS=1 (provisioning; default off),
 *   ALLOW_BINARY_RESTORE=1 (explicit opt-in).
 *
 * Credentials discipline: router passwords are NEVER read from files — the
 * registry resolves them from the runtime environment / vault only.
 */

import { Queue, Worker } from 'bullmq';
import { RosConnection, TcpTransport } from '@mtk/ros-api';
import { newOpId, type BackupJob, type QuotaJob } from '@mtk/types';
import { ConnectionManager } from './connection-manager.js';
import { HealthMonitor } from './health-monitor.js';
import { QUEUES, BullMqEventBus } from './queues.js';
import { HttpRouterRegistry, type RouterRegistry } from './registry.js';
import type { MetricsIngest } from './metrics.js';
import { InMemoryDowntimeRepository } from './downtime.js';
import { PostgresDowntimeRepository, pool } from './postgres-metrics.js';
import { InMemoryAuditSink, HttpAuditSink } from './audit.js';
import { FilesystemObjectStore } from './object-store.js';
import { InMemoryBackupIndex, backupCronForRouter } from './jobs/backup.job.js';
import { PostgresBackupIndex } from './postgres-metrics.js';
import { createPollerProcessor } from './jobs/poller.job.js';
import {
  createBackupProcessor,
  createBackupJanitorProcessor,
} from './jobs/backup.job.js';
import { createRestoreProcessor } from './jobs/restore.job.js';
import { createCommandsProcessor, HttpResultReporter } from './jobs/commands.job.js';
import { createQuotaProcessor } from './jobs/quota.job.js';
import {
  createExpirySweepProcessor,
  HttpHotspotUserDirectory,
  type HotspotExpirySweepJob,
} from './jobs/expiry-sweep.job.js';
import { createProvisionProcessor } from './jobs/provision.job.js';
import { selectShardRouterIds } from './sharding.js';

const log = (...args: unknown[]): void => {
  // eslint-disable-next-line no-console
  console.log('[worker]', ...args);
};

/** Build a logged-in ros-api session for one router (modern login first). */
function makeConnectionFactory(registry: RouterRegistry) {
  return async (routerId: string): Promise<RosConnection> => {
    const ep = await registry.getEndpoint(routerId);
    const conn = new RosConnection(
      new TcpTransport({ host: ep.host, port: ep.apiPort, connectTimeoutMs: 10_000 }),
      { loginMode: 'auto' }, // modern first, MD5-challenge fallback for pre-6.43
    );
    await conn.connect();
    try {
      await conn.login(ep.username, ep.password);
    } catch (err) {
      await conn.close().catch(() => undefined);
      throw err;
    }
    return conn;
  };
}

async function main(): Promise<void> {
  const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
  const shardIndex = Number(process.env.WORKER_SHARD_INDEX ?? 0);
  const shardCount = Number(process.env.WORKER_SHARD_COUNT ?? 1);
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
  const serviceToken = process.env.WORKER_SERVICE_TOKEN ?? '';
  const usePostgres = !!process.env.DATABASE_URL;
  // The hub CHR id — the expiry sweep (like everything except provisioning)
  // must never run against it.
  const hubRouterId = process.env.HUB_ROUTER_ID ?? 'hub';

  const registry: RouterRegistry = new HttpRouterRegistry(apiBase, serviceToken);
  const manager = new ConnectionManager(makeConnectionFactory(registry));
  // The hub CHR gets its own manager so provision jobs never contend with
  // site-router sessions (and can use the hub's own credentials).
  const hub = new ConnectionManager(makeConnectionFactory(registry));

  const downtime = usePostgres
    ? new PostgresDowntimeRepository(pool())
    : new InMemoryDowntimeRepository();
  const audit = serviceToken
    ? new HttpAuditSink(apiBase, serviceToken)
    : new InMemoryAuditSink();
  const reporter = serviceToken
    ? new HttpResultReporter(apiBase, serviceToken)
    : undefined;

  // Bridge manager status events → canonical bus events on the notify queue
  // and → the downtime ledger repository.
  const notifyQueue = new Queue(QUEUES.notify, { connection });
  const events = new BullMqEventBus(notifyQueue);
  const enrich = async (routerId: string): Promise<{ uuid: string; tunnelIp: string }> => {
    try {
      const ep = await registry.getEndpoint(routerId);
      return { uuid: ep.uuid, tunnelIp: ep.host };
    } catch {
      return { uuid: routerId, tunnelIp: '' };
    }
  };
  manager.on('router.online', (p: { routerId: string; at: string }) => {
    void (async () => {
      const { uuid, tunnelIp } = await enrich(p.routerId);
      await events
        .emit({ event: 'router.online', payload: { routerId: p.routerId, uuid, tunnelIp, at: p.at } })
        .catch((err) => log('notify emit failed', err));
      await downtime.close(p.routerId, p.at).catch((err) => log('downtime close failed', err));
    })();
  });
  manager.on('router.offline', (p: { routerId: string; at: string; reason?: string }) => {
    void (async () => {
      const { uuid } = await enrich(p.routerId);
      await events
        .emit({
          event: 'router.offline',
          payload: { routerId: p.routerId, uuid, at: p.at, cause: p.reason },
        })
        .catch((err) => log('notify emit failed', err));
      await downtime.open(p.routerId, p.at, p.reason).catch((err) => log('downtime open failed', err));
    })();
  });

  const listRouterIds = (): Promise<string[]> => registry.listRouterIds();
  const myRouters = async (): Promise<string[]> =>
    selectShardRouterIds(await listRouterIds(), shardIndex, shardCount);

  // Health monitor: 30 s ping, 3 misses → offline + downtime ledger.
  const health = new HealthMonitor(manager, listRouterIds);
  health.start();

  // Metrics ingest: canonical batches → metrics-ingest queue for the API.
  const metricsIngestQueue = new Queue(QUEUES.metricsIngest, { connection });
  const ingest: MetricsIngest = {
    ingest: async (batch) => {
      await metricsIngestQueue.add('metrics-ingest', batch, {
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
  };

  const workers: Worker[] = [];
  const queues: Queue[] = [notifyQueue, metricsIngestQueue];

  // --- poller (worker-internal queue) ------------------------------------------
  // One worker dispatches both the poll tick and the quota-tick driver.
  const pollProcessor = createPollerProcessor({
    manager,
    listRouterIds,
    ingest,
    noteActivity: (id) => health.noteActivity(id),
  });
  const enqueueQuotaTick = async (): Promise<void> => {
    for (const routerId of await myRouters()) {
      const job: QuotaJob = { kind: 'quota', opId: newOpId(), routerId };
      await quotaQueue.add(`quota-${routerId}`, job, {
        jobId: `quota-tick-${routerId}`,
        removeOnComplete: 100,
        removeOnFail: 200,
      });
    }
  };
  // v7 never disables expired hotspot users — the sweep enforces expiry
  // (disable + kick; remove when the user's expiryMode calls for it).
  const enqueueExpirySweepTick = async (): Promise<void> => {
    for (const routerId of await myRouters()) {
      const job: HotspotExpirySweepJob = {
        kind: 'hotspot-expiry-sweep',
        opId: newOpId(),
        routerId,
      };
      await expiryQueue.add('hotspot-expiry-sweep', job, {
        jobId: `expiry-sweep-tick-${routerId}`,
        removeOnComplete: 100,
        removeOnFail: 200,
      });
    }
  };
  workers.push(
    new Worker(
      QUEUES.poll,
      async (job) => {
        if (job.name === 'quota-tick') return enqueueQuotaTick();
        if (job.name === 'expiry-sweep-tick') return enqueueExpirySweepTick();
        return pollProcessor(job as never);
      },
      { connection, concurrency: 1 },
    ),
  );
  const pollQueue = new Queue(QUEUES.poll, { connection });
  queues.push(pollQueue);
  await pollQueue.upsertJobScheduler(
    'poll-tick',
    { every: Number(process.env.POLL_INTERVAL_MS ?? 60_000) },
    { data: { shardIndex, shardCount } },
  );

  // --- commands ------------------------------------------------------------------
  workers.push(
    new Worker(QUEUES.commands, createCommandsProcessor({ manager, audit, reporter }), {
      connection,
      concurrency: 8, // per-router serialization is enforced by RouterMutex
    }),
  );

  // --- quota (one canonical QuotaJob per owned router, every 5 min) ---------------
  const quotaQueue = new Queue(QUEUES.quota, { connection });
  queues.push(quotaQueue);
  workers.push(
    new Worker(QUEUES.quota, createQuotaProcessor({ manager, audit, events }), {
      connection,
      concurrency: 4,
    }),
  );
  // quota-tick is driven by the poll-queue dispatcher above (enqueueQuotaTick).
  await pollQueue.upsertJobScheduler(
    'quota-tick',
    { every: Number(process.env.QUOTA_INTERVAL_MS ?? 300_000) },
    { name: 'quota-tick', data: {} },
  );
  // expiry-sweep-tick is driven by the same dispatcher (enqueueExpirySweepTick).
  await pollQueue.upsertJobScheduler(
    'expiry-sweep-tick',
    { every: Number(process.env.EXPIRY_SWEEP_INTERVAL_MS ?? 900_000) },
    { name: 'expiry-sweep-tick', data: {} },
  );

  // --- hotspot expiry sweep (v7 never disables expired users; one job per ----
  // --- owned router every 15 min, worker-internal `expiry` queue) -------------
  const expiryQueue = new Queue(QUEUES.expiry, { connection });
  queues.push(expiryQueue);
  workers.push(
    new Worker(
      QUEUES.expiry,
      createExpirySweepProcessor({
        manager,
        users: new HttpHotspotUserDirectory(apiBase, serviceToken),
        audit,
        events,
        // Never sweep the hub CHR (or any other guarded id).
        skipRouterIds: [hubRouterId],
      }),
      { connection, concurrency: 4 },
    ),
  );

  // --- backups ----------------------------------------------------------------------
  const store = new FilesystemObjectStore(process.env.BACKUP_DIR ?? './var/backups');
  const backupIndex = usePostgres ? new PostgresBackupIndex(pool()) : new InMemoryBackupIndex();
  const ftpCredentials = async (routerId: string) => {
    const ep = await registry.getEndpoint(routerId);
    // FTP uses the same vaulted credentials as the API user; the port comes
    // from the router record (hub CHR: 8921).
    const ftpPort = Number(process.env[`FTP_PORT_${routerId}`] ?? 21);
    return {
      host: ep.host,
      port: ftpPort,
      user: process.env[`FTP_USER_${routerId}`] ?? ep.username,
      password: ep.password,
    };
  };
  const backupDeps = { manager, ftpCredentials, store, index: backupIndex, audit, events };
  const restoreDeps = {
    ...backupDeps,
    allowBinaryRestore: process.env.ALLOW_BINARY_RESTORE === '1',
  };
  const backupProcessor = createBackupProcessor(backupDeps);
  const restoreProcessor = createRestoreProcessor(restoreDeps);
  workers.push(
    new Worker(
      QUEUES.backup,
      async (job) => {
        const data = job.data as BackupJob;
        // restore requests ride the backup queue via restoreBackupId
        if (data.restoreBackupId) return restoreProcessor(job as never);
        if (job.name === 'janitor') {
          return createBackupJanitorProcessor({ store, index: backupIndex, audit })();
        }
        return backupProcessor(job as never);
      },
      { connection, concurrency: Number(process.env.BACKUP_CONCURRENCY ?? 4) },
    ),
  );
  const backupQueue = new Queue(QUEUES.backup, { connection });
  queues.push(backupQueue);
  // per-router staggered daily backups (02:00–05:00) + weekly binary + janitor
  for (const routerId of await myRouters()) {
    const exportJob: BackupJob = {
      kind: 'backup', opId: newOpId(), routerId, backupType: 'export',
    };
    await backupQueue.upsertJobScheduler(`backup-${routerId}`, {
      pattern: backupCronForRouter(routerId),
    }, { name: 'backup', data: exportJob });
    const binaryJob: BackupJob = {
      kind: 'backup', opId: newOpId(), routerId, backupType: 'binary',
    };
    await backupQueue.upsertJobScheduler(
      `backup-bin-${routerId}`,
      { pattern: '0 3 * * 0' }, // weekly, Sunday 03:00 — bounds FTP + storage load
      { name: 'backup', data: binaryJob },
    );
  }
  await backupQueue.upsertJobScheduler(
    'backup-janitor',
    { pattern: '30 3 * * *' },
    { name: 'janitor', data: {} },
  );

  // --- provision ----------------------------------------------------------------------
  workers.push(
    new Worker(
      QUEUES.provision,
      createProvisionProcessor({
        manager,
        hub,
        hubRouterId,
        routerInfo: async (routerId) => {
          // deploy-time: the API owns sstpUsername/uuid per router
          const res = await fetch(
            `${apiBase}/internal/worker/routers/${encodeURIComponent(routerId)}/provision-info`,
            { headers: { authorization: `Bearer ${serviceToken}` } },
          );
          if (!res.ok) throw new Error(`provision info failed: HTTP ${res.status}`);
          return (await res.json()) as { sstpUsername: string; uuid: string };
        },
        secrets: {
          freshSecrets: async (routerId) => {
            const res = await fetch(
              `${apiBase}/internal/worker/routers/${encodeURIComponent(routerId)}/fresh-secrets`,
              {
                method: 'POST',
                headers: { authorization: `Bearer ${serviceToken}` },
              },
            );
            if (!res.ok) throw new Error(`fresh secrets failed: HTTP ${res.status}`);
            return (await res.json()) as { sstpPassword: string; apiPassword: string };
          },
        },
        markDecommissioned: async (routerId) => {
          await fetch(`${apiBase}/internal/worker/routers/${encodeURIComponent(routerId)}/decommission`, {
            method: 'POST',
            headers: { authorization: `Bearer ${serviceToken}` },
          });
        },
        audit,
        events,
        allowHubMutations: process.env.ALLOW_HUB_MUTATIONS === '1',
      }),
      { connection, concurrency: 1 },
    ),
  );

  const shutdown = async (): Promise<void> => {
    log('shutting down');
    health.stop();
    await Promise.all([
      ...workers.map((w) => w.close()),
      ...queues.map((q) => q.close()),
    ]);
    await manager.dropAll();
    await hub.dropAll();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  log(`up (shard ${shardIndex}/${shardCount}, api=${apiBase})`);
}

void main();

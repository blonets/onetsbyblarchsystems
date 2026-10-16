import { randomUUID } from 'node:crypto';
import { Global, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobPayload, QueueName } from '@mtk/types';

export const QUEUE_NAMES: QueueName[] = [
  'commands',
  'provision',
  'backup',
  'metrics-ingest',
  'quota',
  'notify',
];

export interface EnqueueOptions {
  /** BullMQ job id — defaults to a random UUID. Pass opId for idempotency. */
  jobId?: string;
  /** Delay before the job becomes runnable (ms). */
  delay?: number;
  /** Attempts for BullMQ (fake ignores, records it). */
  attempts?: number;
}

export interface QueuedJob {
  id: string;
  queue: QueueName;
  name: string;
  data: JobPayload;
}

/**
 * Queue port. The API never opens router connections and never executes
 * device commands itself — everything router-touching is enqueued here for
 * the worker.
 */
export interface JobsPort {
  add(queue: QueueName, name: string, data: JobPayload, opts?: EnqueueOptions): Promise<QueuedJob>;
  /** Test/dev helper: jobs currently held by the fake. Real driver returns []. */
  pending(queue: QueueName): QueuedJob[];
}

export const JOBS_PORT = Symbol('JOBS_PORT');

/** In-memory queue (tests / Redis-less dev). `pending()` exposes the jobs. */
export class InMemoryJobs implements JobsPort {
  private readonly jobs = new Map<QueueName, QueuedJob[]>();

  async add(queue: QueueName, name: string, data: JobPayload, opts: EnqueueOptions = {}): Promise<QueuedJob> {
    const job: QueuedJob = { id: opts.jobId ?? randomUUID(), queue, name, data };
    const list = this.jobs.get(queue) ?? [];
    list.push(job);
    this.jobs.set(queue, list);
    return job;
  }

  pending(queue: QueueName): QueuedJob[] {
    return [...(this.jobs.get(queue) ?? [])];
  }

  /** Test helper: remove all held jobs. */
  clear(): void {
    this.jobs.clear();
  }
}

/**
 * BullMQ-backed queue port. Queues are created lazily per name over a shared
 * ioredis connection. BullMQ/ioredis are imported lazily so the module also
 * loads when Redis is absent (the factory below picks the fake instead).
 */
export class BullMqJobs implements JobsPort, OnModuleDestroy {
  private readonly logger = new Logger(BullMqJobs.name);
  private readonly queues = new Map<QueueName, any>();
  private connection: any;

  constructor(private readonly redisUrl: string) {}

  private async connectionOf(): Promise<any> {
    if (!this.connection) {
      const { default: IORedis } = await import('ioredis');
      this.connection = new IORedis(this.redisUrl, { maxRetriesPerRequest: null });
      this.connection.on('error', (err: Error) => this.logger.error(`redis error: ${err.message}`));
    }
    return this.connection;
  }

  private async queueOf(queue: QueueName): Promise<any> {
    let q = this.queues.get(queue);
    if (!q) {
      const { Queue } = await import('bullmq');
      q = new Queue(queue, { connection: await this.connectionOf() });
      this.queues.set(queue, q);
    }
    return q;
  }

  async add(queue: QueueName, name: string, data: JobPayload, opts: EnqueueOptions = {}): Promise<QueuedJob> {
    const q = await this.queueOf(queue);
    const job = await q.add(name, data, {
      jobId: opts.jobId,
      delay: opts.delay,
      attempts: opts.attempts ?? 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    return { id: String(job.id), queue, name, data };
  }

  pending(): QueuedJob[] {
    return [];
  }

  async onModuleDestroy(): Promise<void> {
    for (const q of this.queues.values()) await q.close().catch(() => undefined);
    await this.connection?.quit().catch(() => undefined);
  }
}

/**
 * Jobs module (global).
 * `JOBS_DRIVER=redis` (or `REDIS_URL` set) → BullMQ; otherwise the in-memory
 * fake. The fake is also what unit tests inject directly.
 */
@Global()
@Module({
  providers: [
    {
      provide: JOBS_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): JobsPort => {
        const driver = config.get('JOBS_DRIVER') ?? (config.get('REDIS_URL') ? 'redis' : 'memory');
        if (driver === 'redis') {
          const url = config.getOrThrow<string>('REDIS_URL');
          return new BullMqJobs(url);
        }
        new Logger('JobsModule').warn('JOBS_DRIVER=memory — jobs are held in-process and executed by nothing. Set REDIS_URL for the real worker.');
        return new InMemoryJobs();
      },
    },
  ],
  exports: [JOBS_PORT],
})
export class JobsModule {}

/**
 * BullMQ queue names and the platform event bus.
 *
 * Queue names are the canonical {@link QueueName} contract from `@mtk/types`
 * (the API enqueues to these exact names — never rename unilaterally):
 * commands, provision, backup, metrics-ingest, quota, notify.
 *
 * The poller is worker-internal (no canonical job type): each replica owns a
 * `poll` queue with a repeatable `poll-tick` job for its shard.
 *
 * Events published to the `notify` queue use the canonical {@link BusEventName}
 * + {@link BusEventPayload} contract; the API matches them against
 * notification rules and pushes Socket.IO updates.
 */

import type { Queue } from 'bullmq';
import type { BusEventName, BusEventPayload, QueueName } from '@mtk/types';

export const QUEUES = {
  poll: 'poll',
  commands: 'commands',
  provision: 'provision',
  backup: 'backup',
  metricsIngest: 'metrics-ingest',
  quota: 'quota',
  notify: 'notify',
} as const satisfies Record<string, QueueName | 'poll'>;

/** One bus event with its canonical payload. */
export type WorkerBusEvent = {
  [K in BusEventName]: { event: K; payload: BusEventPayload[K] };
}[BusEventName];

export interface EventBus {
  emit(event: WorkerBusEvent): Promise<void>;
}

/** Real implementation: publishes bus events to the `notify` BullMQ queue. */
export class BullMqEventBus implements EventBus {
  constructor(private readonly notifyQueue: Queue) {}

  async emit(event: WorkerBusEvent): Promise<void> {
    await this.notifyQueue.add(`event:${event.event}`, event, {
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
}

/** In-memory bus for tests. */
export class InMemoryEventBus implements EventBus {
  readonly events: WorkerBusEvent[] = [];

  async emit(event: WorkerBusEvent): Promise<void> {
    this.events.push(event);
  }

  ofType<K extends BusEventName>(type: K): Array<{ event: K; payload: BusEventPayload[K] }> {
    return this.events.filter((e) => e.event === type) as Array<{
      event: K;
      payload: BusEventPayload[K];
    }>;
  }

  clear(): void {
    this.events.length = 0;
  }
}

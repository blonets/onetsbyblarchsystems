/**
 * OpId idempotency store.
 *
 * Every command job carries a platform `opId`. The store guarantees:
 * - a duplicate delivery of a completed op returns the recorded result instead
 *   of re-executing against the router
 * - an in-flight op is visible as `running` so concurrent duplicates can wait
 *   rather than double-apply
 *
 * The in-memory store is process-local (fine for tests and single-replica
 * shards). Multi-replica deployments should swap in the Redis implementation
 * (BullMQ jobId = opId gives cross-replica dedupe at enqueue time; the store
 * here covers the execute window).
 */

export type OpState = 'running' | 'done' | 'failed';

export interface OpRecord {
  opId: string;
  state: OpState;
  result?: unknown;
  error?: string;
  startedAt: string;
  endedAt?: string;
}

export interface IdempotencyStore {
  /** Atomically claim `opId`; returns the existing record when already claimed. */
  claim(opId: string): Promise<{ claimed: boolean; existing?: OpRecord }>;
  complete(opId: string, result?: unknown): Promise<void>;
  fail(opId: string, error: string): Promise<void>;
  get(opId: string): Promise<OpRecord | undefined>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly ops = new Map<string, OpRecord>();

  async claim(opId: string): Promise<{ claimed: boolean; existing?: OpRecord }> {
    const existing = this.ops.get(opId);
    if (existing) return { claimed: false, existing };
    this.ops.set(opId, { opId, state: 'running', startedAt: new Date().toISOString() });
    return { claimed: true };
  }

  async complete(opId: string, result?: unknown): Promise<void> {
    const rec = this.ops.get(opId);
    if (rec) {
      rec.state = 'done';
      rec.result = result;
      rec.endedAt = new Date().toISOString();
    }
  }

  async fail(opId: string, error: string): Promise<void> {
    const rec = this.ops.get(opId);
    if (rec) {
      rec.state = 'failed';
      rec.error = error;
      rec.endedAt = new Date().toISOString();
    }
  }

  async get(opId: string): Promise<OpRecord | undefined> {
    return this.ops.get(opId);
  }
}

/**
 * Per-router mutex — serializes work for one router (ARCH §4: RouterOS API is
 * effectively single-threaded per connection, so commands run with
 * per-router concurrency = 1).
 *
 * Implemented as a per-key promise chain: `run(key, fn)` waits for the
 * previous task for `key` to settle before starting `fn`. A rejected task
 * does not poison the chain. Process-local; for multi-replica deployments
 * pair with BullMQ jobId = opId dedupe at enqueue time.
 */
export class RouterMutex {
  private readonly state = new Map<string, { tail: Promise<unknown>; waiters: number }>();

  async run<T>(routerId: string, fn: () => Promise<T>): Promise<T> {
    let s = this.state.get(routerId);
    if (!s) {
      s = { tail: Promise.resolve(), waiters: 0 };
      this.state.set(routerId, s);
    }
    s.waiters++;
    const prev = s.tail;
    const entry = s;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    entry.tail = prev.then(() => current);
    await prev;
    try {
      return await fn();
    } finally {
      entry.waiters--;
      release();
      if (entry.waiters === 0) this.state.delete(routerId);
    }
  }

  /** For tests: number of router keys currently tracked. */
  trackedKeys(): number {
    return this.state.size;
  }
}

import { describe, expect, it } from 'vitest';
import { RouterMutex } from '../src/router-mutex.js';
import { InMemoryIdempotencyStore } from '../src/idempotency.js';

describe('RouterMutex', () => {
  it('serializes work per router but not across routers', async () => {
    const mutex = new RouterMutex();
    const order: string[] = [];
    const slow = (id: string, ms: number) =>
      mutex.run(id, async () => {
        order.push(`start-${id}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end-${id}`);
      });
    await Promise.all([slow('r1', 30), slow('r1', 10), slow('r2', 20)]);
    // r1's two tasks never overlap
    const r1Events = order.filter((e) => e.endsWith('r1'));
    expect(r1Events).toEqual(['start-r1', 'end-r1', 'start-r1', 'end-r1']);
    expect(mutex.trackedKeys()).toBe(0); // chain collapses after use
  });

  it('does not poison the chain on rejection', async () => {
    const mutex = new RouterMutex();
    await expect(mutex.run('r1', async () => { throw new Error('bad'); })).rejects.toThrow('bad');
    const result = await mutex.run('r1', async () => 'recovered');
    expect(result).toBe('recovered');
  });
});

describe('InMemoryIdempotencyStore', () => {
  it('claims once, dedupes afterwards', async () => {
    const store = new InMemoryIdempotencyStore();
    expect((await store.claim('op-1')).claimed).toBe(true);
    const again = await store.claim('op-1');
    expect(again.claimed).toBe(false);
    expect(again.existing?.state).toBe('running');
    await store.complete('op-1', { rows: 2 });
    const rec = await store.get('op-1');
    expect(rec?.state).toBe('done');
    expect(rec?.result).toEqual({ rows: 2 });
  });

  it('records failures', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.claim('op-2');
    await store.fail('op-2', 'trap');
    expect((await store.get('op-2'))?.state).toBe('failed');
  });
});

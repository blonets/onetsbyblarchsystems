import { describe, expect, it } from 'vitest';
import { selectShardRouterIds, shardForRouter } from '../src/sharding.js';

describe('shardForRouter', () => {
  it('is deterministic', () => {
    expect(shardForRouter('router-uuid-1', 8)).toBe(shardForRouter('router-uuid-1', 8));
  });

  it('stays within [0, shardCount)', () => {
    for (let i = 0; i < 200; i++) {
      const s = shardForRouter(`r-${i}`, 8);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(8);
    }
  });

  it('distributes across all shards', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(shardForRouter(`router-${i}`, 8));
    expect(seen.size).toBe(8);
  });

  it('rejects invalid shard counts', () => {
    expect(() => shardForRouter('r', 0)).toThrow();
    expect(() => shardForRouter('r', 1.5)).toThrow();
  });
});

describe('selectShardRouterIds', () => {
  it('partitions the fleet across shards with no overlap and no loss', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `router-${i}`);
    const shardCount = 4;
    const parts = Array.from({ length: shardCount }, (_, shardIndex) =>
      selectShardRouterIds(ids, shardIndex, shardCount),
    );
    const all = parts.flat().sort();
    expect(all).toEqual([...ids].sort());
    expect(new Set(all).size).toBe(ids.length); // no duplicates
    for (const part of parts) expect(part.length).toBeGreaterThan(0);
  });
});

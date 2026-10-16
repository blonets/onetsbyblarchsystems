/**
 * Deterministic sharding of poll work across worker replicas.
 * Router ids are hashed (FNV-1a) so every replica agrees on ownership without
 * coordination; adding replicas only reshuffles, never duplicates, work.
 */

/** FNV-1a 32-bit hash → shard index in [0, shardCount). Stable across restarts. */
export function shardForRouter(routerId: string, shardCount: number): number {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error('shardCount must be a positive integer');
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < routerId.length; i++) {
    h ^= routerId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % shardCount;
}

/** Keep only the router ids owned by `shardIndex`. */
export function selectShardRouterIds(
  routerIds: string[],
  shardIndex: number,
  shardCount: number,
): string[] {
  return routerIds.filter((id) => shardForRouter(id, shardCount) === shardIndex);
}

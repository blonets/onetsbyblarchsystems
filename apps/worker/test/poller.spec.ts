import { describe, expect, it } from 'vitest';
import { RosConnection } from '@mtk/ros-api';
import { ConnectionManager } from '../src/connection-manager.js';
import { createPollerProcessor } from '../src/jobs/poller.job.js';
import { InMemoryMetricsIngest, RateTracker } from '../src/metrics.js';
import { pollRouter } from '../src/jobs/poller.job.js';
import { ScriptedTransport, mapHandler, reDone } from './helpers.js';

const pollHandler = (words: string[]): string[][] => {
  const cmd = words[0] ?? '';
  if (cmd === '/interface/print') {
    return reDone([{ '.id': '*1', name: 'ether1' }, { '.id': '*2', name: 'sstp-out1' }]);
  }
  if (cmd === '/interface/monitor-traffic') {
    // live-verified on 6.49.17: =once reports per-second rates directly
    const iface = words.find((w) => w.startsWith('=interface='))?.slice('=interface='.length);
    const rows = [
      { name: 'ether1', 'rx-bits-per-second': '8000000', 'tx-bits-per-second': '16000000' },
      { name: 'sstp-out1', 'rx-bits-per-second': '4000', 'tx-bits-per-second': '4800' },
    ].filter((r) => !iface || r.name === iface);
    return reDone(rows);
  }
  const rest = mapHandler({
    '/system/resource/print': reDone([
      {
        'board-name': 'CHR', version: '6.49.17', 'cpu-load': '9',
        'free-memory': '800000000', 'total-memory': '1073741824', uptime: '2d3h',
      },
    ]),
    '/ip/hotspot/active/print': reDone([
      { '.id': '*1', user: 'u1' },
      { '.id': '*2', user: 'u2' },
    ]),
    '/ip/hotspot/user/print': reDone([
      { '.id': '*1', name: 'u1' },
      { '.id': '*2', name: 'u2' },
      { '.id': '*3', name: 'u3' },
    ]),
  });
  return rest(words);
};

function setup(handler = pollHandler) {
  const manager = new ConnectionManager(
    async () => {
      const conn = new RosConnection(new ScriptedTransport(handler));
      await conn.connect();
      return conn;
    },
    { backoff: { maxAttempts: 1 }, sleep: async () => {} },
  );
  const ingest = new InMemoryMetricsIngest();
  return { manager, ingest };
}

describe('poller processor', () => {
  it('collects and normalizes a full poll cycle', async () => {
    const { manager, ingest } = setup();
    const process = createPollerProcessor({
      manager, listRouterIds: async () => ['r1'], ingest, staggerMs: 0,
    });
    const result = await process({ data: { shardIndex: 0, shardCount: 1 } } as never);
    expect(result).toMatchObject({ polled: 1, failed: 0 });
    const batch = ingest.latestFor('r1');
    expect(batch).toBeDefined();
    expect(batch!.cpu?.[0]).toMatchObject({ routerId: 'r1', cpuPct: 9 });
    expect(batch!.hotspotActive?.[0]).toMatchObject({ routerId: 'r1', activeN: 2 });
    expect(batch!.traffic).toHaveLength(2);
    expect(batch!.traffic?.[0]).toMatchObject({ iface: 'ether1' });
  });

  it('a dead router fails the tick without killing it', async () => {
    const deadHandler = (words: string[]) => {
      if (words[0] === '/system/resource/print') throw new Error('socket hangup');
      return pollHandler(words);
    };
    const manager = new ConnectionManager(
      async () => {
        const conn = new RosConnection(new ScriptedTransport(deadHandler));
        await conn.connect();
        return conn;
      },
      { backoff: { maxAttempts: 1 }, sleep: async () => {} },
    );
    const ingest = new InMemoryMetricsIngest();
    const process = createPollerProcessor({
      manager, listRouterIds: async () => ['r1'], ingest, staggerMs: 0,
    });
    const result = await process({ data: { shardIndex: 0, shardCount: 1 } } as never);
    expect(result).toMatchObject({ polled: 0, failed: 1 });
    // the failure is recorded in the downtime ledger via reportFailure
    expect(manager.getDowntime('r1')).toHaveLength(1);
    expect(ingest.latestFor('r1')).toBeUndefined();
  });

  it('only polls routers owned by the shard', async () => {
    const { manager, ingest } = setup(pollHandler);
    const process = createPollerProcessor({
      manager, listRouterIds: async () => ['a', 'b', 'c'], ingest, staggerMs: 0,
    });
    // find a shard that owns exactly one of them deterministically
    const { shardForRouter } = await import('../src/sharding.js');
    const shard = shardForRouter('a', 4);
    const result = await process({ data: { shardIndex: shard, shardCount: 4 } } as never);
    const owned = ['a', 'b', 'c'].filter((id) => shardForRouter(id, 4) === shard).length;
    expect(result.polled).toBe(owned);
  });
});

describe('pollRouter', () => {
  it('reports per-second rates from =once snapshots (live-verified shape)', async () => {
    const { manager } = setup();
    const tracker = new RateTracker();
    let now = Date.parse('2026-10-16T00:00:00.000Z');
    const first = await pollRouter(manager, 'r1', tracker, () => now);
    // =once snapshots report rates directly — no baseline sample needed
    expect(first.traffic).toHaveLength(2);
    expect(first.traffic?.[0]).toMatchObject({ iface: 'ether1', rxBps: 8000000, txBps: 16000000 });
    now += 10_000;
    const second = await pollRouter(manager, 'r1', tracker, () => now);
    expect(second.traffic?.[0]?.rxBps).toBe(8000000);
  });
});

describe('poller gap detection', () => {
  it('records a gap when polls are missed', async () => {
    const { manager, ingest } = setup();
    let now = 1_000_000;
    const process = createPollerProcessor({
      manager, listRouterIds: async () => ['r1'], ingest,
      staggerMs: 0, cadenceSec: 60, now: () => now,
    });
    await process({ data: { shardIndex: 0, shardCount: 1 } } as never);
    now += 30_000; // on cadence
    const r2 = await process({ data: { shardIndex: 0, shardCount: 1 } } as never);
    expect(r2.gaps).toHaveLength(0);
    now += 400_000; // missed several ticks
    const r3 = await process({ data: { shardIndex: 0, shardCount: 1 } } as never);
    expect(r3.gaps).toHaveLength(1);
    expect(r3.gaps[0]!.gapSec).toBeCloseTo(400, 0);
  });
});

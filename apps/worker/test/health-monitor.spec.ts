import { describe, expect, it } from 'vitest';
import { RosConnection } from '@mtk/ros-api';
import { ConnectionManager } from '../src/connection-manager.js';
import { HealthMonitor } from '../src/health-monitor.js';
import { ScriptedTransport, mapHandler, done } from './helpers.js';

const pingHandler = mapHandler({ '/system/identity/print': done() });

function setup(handler = pingHandler) {
  const transports: ScriptedTransport[] = [];
  const manager = new ConnectionManager(
    async () => {
      const t = new ScriptedTransport(handler);
      transports.push(t);
      const conn = new RosConnection(t);
      await conn.connect();
      return conn;
    },
    { backoff: { maxAttempts: 1 }, sleep: async () => {} },
  );
  const ids = ['r1'];
  const monitor = new HealthMonitor(manager, async () => ids, { intervalMs: 30_000 });
  return { manager, monitor, transports, ids };
}

describe('HealthMonitor', () => {
  it('successful pings keep the router online with no downtime', async () => {
    const { manager, monitor } = setup();
    const events: string[] = [];
    manager.on('router.online', () => events.push('online'));
    manager.on('router.offline', () => events.push('offline'));
    expect(await monitor.probeAll()).toEqual({ ok: 1, missed: 0 });
    expect(await monitor.probeAll()).toEqual({ ok: 1, missed: 0 });
    expect(events).toEqual(['online']); // single establish, no offline
    expect(manager.getDowntime('r1')).toHaveLength(0);
  });

  it('opens downtime after 3 consecutive misses', async () => {
    let fail = false;
    const handler = (words: string[]) => {
      if (fail) throw new Error('socket hangup');
      return pingHandler(words);
    };
    const { manager, monitor } = setup(handler);
    await monitor.probeAll(); // healthy baseline
    fail = true;
    await monitor.probeAll();
    expect(monitor.missCount('r1')).toBe(1);
    expect(manager.getDowntime('r1')).toHaveLength(0); // not yet
    await monitor.probeAll();
    expect(manager.getDowntime('r1')).toHaveLength(0);
    await monitor.probeAll(); // third miss
    const entries = manager.getDowntime('r1');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.cause).toContain('missed 3 heartbeats');
    expect(entries[0]!.endedAt).toBeUndefined();
  });

  it('closes downtime on recovery and re-emits online', async () => {
    let fail = false;
    const handler = (words: string[]) => {
      if (fail) throw new Error('socket hangup');
      return pingHandler(words);
    };
    const { manager, monitor } = setup(handler);
    const events: string[] = [];
    manager.on('router.online', () => events.push('online'));
    manager.on('router.offline', () => events.push('offline'));
    await monitor.probeAll();
    fail = true;
    await monitor.probeAll();
    await monitor.probeAll();
    await monitor.probeAll();
    expect(events).toContain('offline');
    fail = false;
    await monitor.probeAll();
    const entries = manager.getDowntime('r1');
    expect(entries[0]!.endedAt).toBeDefined();
    expect(entries[0]!.durationS).toBeGreaterThanOrEqual(0);
    expect(events[events.length - 1]).toBe('online');
    expect(monitor.missCount('r1')).toBe(0);
  });

  it('noteActivity counts as a heartbeat', async () => {
    const { monitor } = setup();
    await monitor.probeAll();
    monitor.noteActivity('r1');
    expect(monitor.missCount('r1')).toBe(0);
  });
});

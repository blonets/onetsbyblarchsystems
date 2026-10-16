import { describe, expect, it, vi } from 'vitest';
import { RosConnection, RosTrapError } from '@mtk/ros-api';
import { ConnectionManager } from '../src/connection-manager.js';
import { ScriptedTransport, mapHandler, done, reDone, trap } from './helpers.js';

const makeManager = (handler: (words: string[]) => string[][], now = { t: 1_000_000 }) => {
  const transports: ScriptedTransport[] = [];
  const manager = new ConnectionManager(
    async () => {
      const t = new ScriptedTransport(handler);
      transports.push(t);
      const conn = new RosConnection(t);
      await conn.connect();
      return conn;
    },
    { now: () => now.t, backoff: { maxAttempts: 2, baseMs: 1, maxMs: 2, jitter: false }, sleep: async () => {} },
  );
  return { manager, transports };
};

describe('ConnectionManager (extended)', () => {
  it('emits router.online on establish and router.offline on drop', async () => {
    const { manager, transports } = makeManager(mapHandler({ '/system/identity/print': done() }));
    const events: string[] = [];
    manager.on('router.online', () => events.push('online'));
    manager.on('router.offline', () => events.push('offline'));
    await manager.ensure('r1');
    expect(events).toEqual(['online']);
    transports[0]!.drop();
    expect(events).toEqual(['online', 'offline']);
    await manager.ensure('r1');
    expect(events).toEqual(['online', 'offline', 'online']);
  });

  it('retries the factory with backoff until it succeeds', async () => {
    let calls = 0;
    const manager = new ConnectionManager(
      async () => {
        calls++;
        if (calls < 3) throw new Error('dial refused');
        const conn = new RosConnection(new ScriptedTransport(mapHandler({})));
        await conn.connect();
        return conn;
      },
      { backoff: { maxAttempts: 5, baseMs: 1, maxMs: 2, jitter: false }, sleep: async () => {} },
    );
    await manager.ensure('r1');
    expect(calls).toBe(3);
  });

  it('does not retry auth failures', async () => {
    let calls = 0;
    const manager = new ConnectionManager(
      async () => {
        calls++;
        throw new Error('login failed: invalid user name or password');
      },
      { backoff: { maxAttempts: 5, baseMs: 1, jitter: false }, sleep: async () => {} },
    );
    await expect(manager.ensure('r1')).rejects.toThrow('login failed');
    expect(calls).toBe(1);
  });

  it('execute() retries once after a session-level failure', async () => {
    let talks = 0;
    const { manager } = makeManager((words) => {
      if (words[0] === '/ping') {
        talks++;
        if (talks === 1) return [['!fatal', '=message=session dead']];
        return done();
      }
      return done();
    });
    const replies = await manager.execute('r1', (conn) => conn.talk(['/ping']));
    expect(replies[replies.length - 1]!.type).toBe('done');
    expect(talks).toBe(2);
  });

  it('execute() does not retry deterministic traps', async () => {
    const { manager } = makeManager(() => trap('no such item'));
    await expect(manager.execute('r1', (conn) => conn.talk(['/nope']))).rejects.toBeInstanceOf(
      RosTrapError,
    );
  });

  it('recordProbe(true) closes downtime and re-emits online', async () => {
    const now = { t: 1_000_000 };
    const { manager, transports } = makeManager(mapHandler({}), now);
    const events: string[] = [];
    manager.on('router.online', () => events.push('online'));
    manager.on('router.offline', () => events.push('offline'));
    await manager.ensure('r1');
    transports[0]!.drop();
    now.t += 60_000;
    manager.recordProbe('r1', false); // a miss: not yet an outage declaration
    manager.markUnreachable('r1', 'missed 3 heartbeats');
    expect(manager.getDowntime('r1')).toHaveLength(1);
    now.t += 30_000;
    manager.recordProbe('r1', true); // recovery
    const entries = manager.getDowntime('r1');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.endedAt).toBe(new Date(now.t).toISOString());
    expect(entries[0]!.durationS).toBe(90);
    expect(events).toEqual(['online', 'offline', 'online']);
  });

  it('dropAll closes every session', async () => {
    const { manager, transports } = makeManager(mapHandler({}));
    await manager.ensure('r1');
    await manager.ensure('r2');
    await manager.dropAll();
    expect(transports.every((t) => !t.isConnected())).toBe(true);
    expect(manager.knownRouterIds()).toHaveLength(0);
  });
});

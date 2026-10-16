import { describe, expect, it } from 'vitest';
import { RosConnection } from '@mtk/ros-api';
import { ConnectionManager } from '../src/connection-manager.js';
import {
  createQuotaProcessor,
  evaluateSession,
  parseBytes,
} from '../src/jobs/quota.job.js';
import { InMemoryAuditSink } from '../src/audit.js';
import { InMemoryEventBus } from '../src/queues.js';
import { ScriptedTransport, mapHandler, reDone } from './helpers.js';

describe('parseBytes', () => {
  it('parses RouterOS byte sizes', () => {
    expect(parseBytes('512K')).toBe(512 * 1024);
    expect(parseBytes('5M')).toBe(5 * 1024 ** 2);
    expect(parseBytes('1.5G')).toBe(Math.floor(1.5 * 1024 ** 3));
    expect(parseBytes('100')).toBe(100);
    expect(parseBytes(undefined)).toBeUndefined();
    expect(parseBytes('junk')).toBeUndefined();
  });
});

describe('evaluateSession', () => {
  it('flags uptime over limit', () => {
    const hit = evaluateSession(
      { 'limit-uptime': '10s' },
      { user: 'g1', uptime: '15s', 'bytes-in': '0', 'bytes-out': '0' },
      undefined,
    );
    expect(hit?.reason).toBe('uptime');
  });
  it('flags bytes-total over limit', () => {
    const hit = evaluateSession(
      { 'limit-bytes-total': '1M' },
      { user: 'g1', uptime: '1s', 'bytes-in': String(600_000), 'bytes-out': String(500_000) },
      undefined,
    );
    expect(hit?.reason).toBe('bytes-total');
  });
  it('flags profile session-timeout', () => {
    const hit = evaluateSession({}, { user: 'g1', uptime: '2h' }, 3600);
    expect(hit?.reason).toBe('session-timeout');
  });
  it('passes users within limits', () => {
    expect(
      evaluateSession(
        { 'limit-uptime': '1d', 'limit-bytes-total': '1G' },
        { user: 'g1', uptime: '1h', 'bytes-in': '100', 'bytes-out': '200' },
        7200,
      ),
    ).toBeNull();
  });
});

function setupQuota(sessions: Array<Record<string, string>>) {
  const sent: string[][][] = [];
  const manager = new ConnectionManager(
    async () => {
      const t = new ScriptedTransport(
        mapHandler({
          '/ip/hotspot/user/print': reDone([
            { '.id': '*1', name: 'over-user', server: 'hs', profile: 'default', disabled: 'no', dynamic: 'no', 'limit-uptime': '10s' },
            { '.id': '*2', name: 'fine-user', server: 'hs', profile: 'default', disabled: 'no', dynamic: 'no', 'limit-uptime': '1d' },
            { '.id': '*3', name: 'already-off', server: 'hs', profile: 'default', disabled: 'yes', dynamic: 'no' },
          ]),
          '/ip/hotspot/user/profile/print': reDone([
            { '.id': '*10', name: 'default', 'session-timeout': '1d' },
          ]),
          '/ip/hotspot/active/print': reDone(sessions),
          '/ip/hotspot/user/disable': [['!done']],
          '/ip/hotspot/active/remove': [['!done']],
        }),
      );
      sent.push(t.sent);
      const conn = new RosConnection(t);
      await conn.connect();
      return conn;
    },
    { backoff: { maxAttempts: 1 }, sleep: async () => {} },
  );
  const audit = new InMemoryAuditSink();
  const events = new InMemoryEventBus();
  const process = createQuotaProcessor({ manager, audit, events });
  return { process, audit, events, sent };
}

describe('quota processor', () => {
  it('disables over-quota users and kicks their sessions', async () => {
    const { process, audit, events, sent } = setupQuota([
      { '.id': '*A', user: 'over-user', uptime: '1h', 'bytes-in': '0', 'bytes-out': '0' },
      { '.id': '*B', user: 'fine-user', uptime: '1h', 'bytes-in': '0', 'bytes-out': '0' },
    ]);
    const result = await process({ data: { kind: 'quota', opId: 'q-1', routerId: 'r1' } } as never);
    expect(result.routerId).toBe('r1');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      user: 'over-user', reason: 'uptime', action: 'disabled+kicked',
    });
    const allSent = sent[0]!; // sentences (string[][]), not flattened
    expect(allSent.some((w) => w[0] === '/ip/hotspot/user/disable' && w[1] === '=.id=*1')).toBe(true);
    expect(allSent.some((w) => w[0] === '/ip/hotspot/active/remove' && w[1] === '=.id=*A')).toBe(true);
    // fine-user and already-disabled users untouched
    expect(allSent.some((w) => w.includes('=.id=*2'))).toBe(false);
    expect(events.ofType('quota.exceeded')).toHaveLength(1);
    expect(audit.events.some((e) => e.action === 'quota.enforce')).toBe(true);
  });

  it('takes no action when nobody is over quota', async () => {
    const { process, events } = setupQuota([]);
    const result = await process({ data: { kind: 'quota', opId: 'q-2', routerId: 'r1' } } as never);
    expect(result.violations).toHaveLength(0);
    expect(events.ofType('quota.exceeded')).toHaveLength(0);
  });

  it('dry-run evaluates without disabling', async () => {
    const manager = new ConnectionManager(
      async () => {
        const conn = new RosConnection(
          new ScriptedTransport(
            mapHandler({
              '/ip/hotspot/user/print': reDone([
                { '.id': '*1', name: 'over-user', server: 'hs', profile: 'default', disabled: 'no', dynamic: 'no', 'limit-uptime': '10s' },
              ]),
              '/ip/hotspot/user/profile/print': reDone([]),
              '/ip/hotspot/active/print': reDone([
                { '.id': '*A', user: 'over-user', uptime: '1h', 'bytes-in': '0', 'bytes-out': '0' },
              ]),
            }),
          ),
        );
        await conn.connect();
        return conn;
      },
      { backoff: { maxAttempts: 1 }, sleep: async () => {} },
    );
    const process = createQuotaProcessor({ manager, dryRun: true });
    const result = await process({ data: { kind: 'quota', opId: 'q-3', routerId: 'r1' } } as never);
    expect(result.violations[0]!.action).toBe('dry-run');
  });
});

import { describe, expect, it } from 'vitest';
import { RosConnection } from '@mtk/ros-api';
import { ConnectionManager } from '../src/connection-manager.js';
import {
  createExpirySweepProcessor,
  HttpHotspotUserDirectory,
  isExpired,
  normalizeExpiryMode,
  type ExpirySweepUser,
} from '../src/jobs/expiry-sweep.job.js';
import { InMemoryAuditSink } from '../src/audit.js';
import { InMemoryEventBus } from '../src/queues.js';
import { ScriptedTransport, mapHandler, reDone, trap } from './helpers.js';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const PAST = '2026-10-15T12:00:00.000Z';
const FUTURE = '2026-10-17T12:00:00.000Z';

describe('normalizeExpiryMode', () => {
  it('passes through known modes and defaults unknown/absent to disable', () => {
    expect(normalizeExpiryMode('disable')).toBe('disable');
    expect(normalizeExpiryMode('remove')).toBe('remove');
    expect(normalizeExpiryMode('remove+notify')).toBe('remove+notify');
    expect(normalizeExpiryMode(undefined)).toBe('disable');
    expect(normalizeExpiryMode(null)).toBe('disable');
    expect(normalizeExpiryMode('nuke')).toBe('disable');
  });
});

describe('isExpired', () => {
  it('flags past timestamps, passes future/invalid/absent', () => {
    expect(isExpired(PAST, NOW)).toBe(true);
    expect(isExpired(new Date(NOW).toISOString(), NOW)).toBe(true); // boundary: at == now
    expect(isExpired(FUTURE, NOW)).toBe(false);
    expect(isExpired(undefined, NOW)).toBe(false);
    expect(isExpired(null, NOW)).toBe(false);
    expect(isExpired('not-a-date', NOW)).toBe(false);
  });
});

interface FixtureOpts {
  users: Array<Record<string, string>>;
  sessions: Array<Record<string, string>>;
  directory: ExpirySweepUser[];
  servers?: Array<Record<string, string>>;
  printTrap?: string;
  skipRouterIds?: string[];
  dryRun?: boolean;
}

function setupSweep(opts: FixtureOpts) {
  const sent: string[][][] = [];
  const manager = new ConnectionManager(
    async () => {
      const t = new ScriptedTransport(
        mapHandler({
          '/ip/hotspot/print': opts.printTrap
            ? trap(opts.printTrap)
            : reDone(opts.servers ?? [{ '.id': '*S', name: 'hotspot1' }]),
          '/ip/hotspot/user/print': reDone(opts.users),
          '/ip/hotspot/active/print': reDone(opts.sessions),
          '/ip/hotspot/user/disable': [['!done']],
          '/ip/hotspot/active/remove': [['!done']],
          '/ip/hotspot/user/remove': [['!done']],
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
  const process = createExpirySweepProcessor({
    manager,
    users: { listUsers: async () => opts.directory },
    audit,
    events,
    now: () => NOW,
    dryRun: opts.dryRun,
    skipRouterIds: opts.skipRouterIds,
  });
  return { process, audit, events, sent };
}

const platformUser = (over: Partial<ExpirySweepUser>): ExpirySweepUser => ({
  name: 'guest-1',
  expiresAt: PAST,
  ...over,
});

describe('expiry sweep processor', () => {
  it('disables a past-expiry user and kicks its session, raising an alert', async () => {
    const { process, audit, events, sent } = setupSweep({
      users: [
        { '.id': '*1', name: 'guest-1', disabled: 'no', dynamic: 'no' },
        { '.id': '*2', name: 'guest-2', disabled: 'no', dynamic: 'no' }, // future expiry
        { '.id': '*3', name: 'manual-user', disabled: 'no', dynamic: 'no' }, // not in directory
      ],
      sessions: [
        { '.id': '*A', user: 'guest-1', address: '10.0.0.5', uptime: '2h' },
        { '.id': '*B', user: 'manual-user', address: '10.0.0.6', uptime: '1h' },
      ],
      directory: [
        platformUser({ name: 'guest-1' }),
        platformUser({ name: 'guest-2', expiresAt: FUTURE }),
      ],
    });
    const result = await process({
      data: { kind: 'hotspot-expiry-sweep', opId: 'e-1', routerId: 'r1' },
    } as never);

    expect(result.skipped).toBe(false);
    expect(result.evaluated).toBe(1);
    expect(result.swept).toHaveLength(1);
    expect(result.swept[0]).toMatchObject({
      user: 'guest-1', mode: 'disable', hadActiveSession: true, action: 'disabled+kicked',
    });

    const allSent = sent[0]!;
    expect(allSent.some((w) => w[0] === '/ip/hotspot/user/disable' && w[1] === '=.id=*1')).toBe(true);
    expect(allSent.some((w) => w[0] === '/ip/hotspot/active/remove' && w[1] === '=.id=*A')).toBe(true);
    // future-expiry and router-only users untouched
    expect(allSent.some((w) => w.includes('=.id=*2'))).toBe(false);
    expect(allSent.some((w) => w[0] === '/ip/hotspot/active/remove' && w[1] === '=.id=*B')).toBe(false);

    // "expired but still connected" is never silent
    const alerts = events.ofType('alert.raised');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload.severity).toBe('warning');
    expect(alerts[0]!.payload.message).toContain('guest-1');
    expect(alerts[0]!.payload.message).toContain('r1');
    expect(audit.events.some((e) => e.action === 'hotspot.expiry.enforce')).toBe(true);
  });

  it('removes the user for mode=remove', async () => {
    const { process, events, sent } = setupSweep({
      users: [{ '.id': '*1', name: 'guest-1', disabled: 'no', dynamic: 'no' }],
      sessions: [],
      directory: [platformUser({ name: 'guest-1', expiryMode: 'remove' })],
    });
    const result = await process({
      data: { kind: 'hotspot-expiry-sweep', opId: 'e-2', routerId: 'r1' },
    } as never);
    expect(result.swept[0]).toMatchObject({ action: 'disabled+removed' });
    const allSent = sent[0]!;
    expect(allSent.some((w) => w[0] === '/ip/hotspot/user/remove' && w[1] === '=.id=*1')).toBe(true);
    // no active session → no "still connected" alert, and remove alone doesn't notify
    expect(events.ofType('alert.raised')).toHaveLength(0);
  });

  it('remove+notify removes and notifies even without an active session', async () => {
    const { process, events, sent } = setupSweep({
      users: [{ '.id': '*1', name: 'guest-1', disabled: 'yes', dynamic: 'no' }],
      sessions: [],
      directory: [platformUser({ name: 'guest-1', expiryMode: 'remove+notify' })],
    });
    const result = await process({
      data: { kind: 'hotspot-expiry-sweep', opId: 'e-3', routerId: 'r1' },
    } as never);
    expect(result.swept[0]).toMatchObject({ action: 'removed' });
    expect(sent[0]!.some((w) => w[0] === '/ip/hotspot/user/remove')).toBe(true);
    const alerts = events.ofType('alert.raised');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload.severity).toBe('info');
    expect(alerts[0]!.payload.message).toContain('guest-1');
    expect(alerts[0]!.payload.message).toContain('remove+notify');
  });

  it('leaves already-enforced users alone (no audit noise)', async () => {
    const { process, audit, events, sent } = setupSweep({
      users: [{ '.id': '*1', name: 'guest-1', disabled: 'yes', dynamic: 'no' }],
      sessions: [],
      directory: [platformUser({ name: 'guest-1' })],
    });
    const result = await process({
      data: { kind: 'hotspot-expiry-sweep', opId: 'e-4', routerId: 'r1' },
    } as never);
    expect(result.swept).toHaveLength(0);
    expect(audit.events).toHaveLength(0);
    expect(events.ofType('alert.raised')).toHaveLength(0);
    expect(sent[0]!.some((w) => w[0] === '/ip/hotspot/user/disable')).toBe(false);
  });

  it('treats unknown expiry modes as disable', async () => {
    const { process, sent } = setupSweep({
      users: [{ '.id': '*1', name: 'guest-1', disabled: 'no', dynamic: 'no' }],
      sessions: [],
      directory: [platformUser({ name: 'guest-1', expiryMode: 'vaporize' })],
    });
    const result = await process({
      data: { kind: 'hotspot-expiry-sweep', opId: 'e-5', routerId: 'r1' },
    } as never);
    expect(result.swept[0]).toMatchObject({ mode: 'disable', action: 'disabled' });
    expect(sent[0]!.some((w) => w[0] === '/ip/hotspot/user/remove')).toBe(false);
  });

  it('skips the hub without touching the router', async () => {
    const { process, sent } = setupSweep({
      users: [{ '.id': '*1', name: 'guest-1', disabled: 'no', dynamic: 'no' }],
      sessions: [],
      directory: [platformUser({ name: 'guest-1' })],
      skipRouterIds: ['hub'],
    });
    const result = await process({
      data: { kind: 'hotspot-expiry-sweep', opId: 'e-6', routerId: 'hub' },
    } as never);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('hub-guard');
    expect(sent).toHaveLength(0); // no session was even opened
  });

  it('skips routers with no hotspot server quietly', async () => {
    const { process, audit, events } = setupSweep({
      users: [],
      sessions: [],
      servers: [],
      directory: [platformUser({ name: 'guest-1' })],
    });
    const result = await process({
      data: { kind: 'hotspot-expiry-sweep', opId: 'e-7', routerId: 'r1' },
    } as never);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('no-hotspot');
    expect(audit.events).toHaveLength(0);
    expect(events.ofType('alert.raised')).toHaveLength(0);
  });

  it('skips routers without the hotspot package (trap, not a failure)', async () => {
    const { process } = setupSweep({
      users: [],
      sessions: [],
      printTrap: 'no such command',
      directory: [platformUser({ name: 'guest-1' })],
    });
    const result = await process({
      data: { kind: 'hotspot-expiry-sweep', opId: 'e-8', routerId: 'r1' },
    } as never);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('no-hotspot-package');
  });

  it('dry-run evaluates without mutating', async () => {
    const { process, audit, sent } = setupSweep({
      users: [{ '.id': '*1', name: 'guest-1', disabled: 'no', dynamic: 'no' }],
      sessions: [{ '.id': '*A', user: 'guest-1', uptime: '2h' }],
      directory: [platformUser({ name: 'guest-1' })],
      dryRun: true,
    });
    const result = await process({
      data: { kind: 'hotspot-expiry-sweep', opId: 'e-9', routerId: 'r1' },
    } as never);
    expect(result.swept[0]).toMatchObject({ action: 'dry-run' });
    expect(sent[0]!.some((w) => w[0] === '/ip/hotspot/user/disable')).toBe(false);
    expect(sent[0]!.some((w) => w[0] === '/ip/hotspot/active/remove')).toBe(false);
    expect(audit.events.some((e) => e.action === 'hotspot.expiry.evaluate')).toBe(true);
  });
});

describe('HttpHotspotUserDirectory', () => {
  it('returns users on 200 and [] on 404', async () => {
    const dir = new HttpHotspotUserDirectory(
      'http://api',
      'token',
      (async (url: string | URL | Request) => {
        if (String(url).endsWith('/routers/r1/hotspot-users')) {
          return new Response(
            JSON.stringify({ users: [{ name: 'guest-1', expiresAt: PAST }] }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 404 });
      }) as typeof fetch,
    );
    expect(await dir.listUsers('r1')).toEqual([{ name: 'guest-1', expiresAt: PAST }]);
    expect(await dir.listUsers('r2')).toEqual([]);
  });

  it('throws on non-404 errors', async () => {
    const dir = new HttpHotspotUserDirectory(
      'http://api',
      'token',
      (async () => new Response('{}', { status: 500 })) as typeof fetch,
    );
    await expect(dir.listUsers('r1')).rejects.toThrow(/HTTP 500/);
  });
});

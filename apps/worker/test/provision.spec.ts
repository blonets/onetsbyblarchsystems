import { describe, expect, it } from 'vitest';
import { RosConnection } from '@mtk/ros-api';
import type { ProvisionJob } from '@mtk/types';
import { ConnectionManager } from '../src/connection-manager.js';
import { createProvisionProcessor } from '../src/jobs/provision.job.js';
import { InMemoryAuditSink } from '../src/audit.js';
import { InMemoryEventBus } from '../src/queues.js';
import { ScriptedTransport, mapHandler, reDone, done } from './helpers.js';

function makeManager(handler: (words: string[]) => string[][]) {
  return new ConnectionManager(
    async () => {
      const conn = new RosConnection(new ScriptedTransport(handler));
      await conn.connect();
      return conn;
    },
    { backoff: { maxAttempts: 1 }, sleep: async () => {} },
  );
}

function setup(
  hubHandler: (words: string[]) => string[][],
  routerHandler: (words: string[]) => string[][] = () => done(),
) {
  const manager = makeManager(routerHandler);
  const hub = makeManager(hubHandler);
  const audit = new InMemoryAuditSink();
  const events = new InMemoryEventBus();
  const process = createProvisionProcessor({
    manager,
    hub,
    hubRouterId: 'hub',
    routerInfo: async () => ({ sstpUsername: 'site-001', uuid: 'uuid-001' }),
    secrets: {
      freshSecrets: async () => ({ sstpPassword: 'new-sstp', apiPassword: 'new-api' }),
    },
    markDecommissioned: async () => {},
    audit,
    events,
    allowHubMutations: true,
  });
  return { process, audit, events };
}

const jobOf = (data: ProvisionJob) => ({ data }) as never;

describe('provision processor', () => {
  it('verify-tunnel passes when PPP is active and the panel-uuid stamp matches', async () => {
    const { process, events } = setup(
      mapHandler({
        '/ppp/active/print': reDone([{ name: 'site-001', service: 'sstp' }]),
      }),
      mapHandler({
        '/system/note/print': reDone([{ note: 'panel-uuid:uuid-001' }]),
      }),
    );
    const result = await process(
      jobOf({ kind: 'provision', type: 'verify-tunnel', opId: 'p-1', routerId: 'r1' }),
    );
    expect(result).toMatchObject({ type: 'verify-tunnel', routerId: 'r1', ok: true });
    expect(events.ofType('router.online')).toHaveLength(1);
  });

  it('verify-tunnel fails loudly when the uuid stamp is missing', async () => {
    const { process, events } = setup(
      mapHandler({
        '/ppp/active/print': reDone([{ name: 'site-001' }]),
      }),
      mapHandler({
        '/system/note/print': reDone([{ note: 'something else' }]),
      }),
    );
    const result = await process(
      jobOf({ kind: 'provision', type: 'verify-tunnel', opId: 'p-2', routerId: 'r1' }),
    );
    expect(result.ok).toBe(false);
    expect(events.ofType('router.online')).toHaveLength(0);
  });

  it('rotate-secrets rotates the router API user password then the hub SSTP secret', async () => {
    const hubSent: string[][] = [];
    const { process, audit } = setup(
      (words) => {
        hubSent.push(words);
        if (words[0] === '/ppp/secret/print') return reDone([{ '.id': '*7', name: 'site-001' }]);
        return done();
      },
      mapHandler({
        '/user/print': reDone([{ '.id': '*1', name: 'panel-api' }]),
        '/user/set': done(),
      }),
    );
    const result = await process(
      jobOf({ kind: 'provision', type: 'rotate-secrets', opId: 'p-3', routerId: 'r1' }),
    );
    expect(result.ok).toBe(true);
    expect(hubSent.some((w) => w[0] === '/ppp/secret/set' && w[1] === '=.id=*7')).toBe(true);
    expect(audit.events.some((e) => e.action === 'provision.rotate-secrets' && e.result === 'done')).toBe(
      true,
    );
  });

  it('refuses hub mutations for non-disposable usernames in tests', async () => {
    const manager = makeManager(() => done());
    const hub = makeManager(() => done());
    const audit = new InMemoryAuditSink();
    const events = new InMemoryEventBus();
    const process = createProvisionProcessor({
      manager,
      hub,
      hubRouterId: 'hub',
      routerInfo: async () => ({ sstpUsername: 'sstp-test-01', uuid: 'uuid-001' }),
      secrets: { freshSecrets: async () => ({ sstpPassword: 'x', apiPassword: 'y' }) },
      audit,
      events,
      // allowHubMutations: false → guard is active
    });
    await expect(
      process(jobOf({ kind: 'provision', type: 'rotate-secrets', opId: 'p-4', routerId: 'r1' })),
    ).rejects.toThrow(/non-disposable/);
  });
});

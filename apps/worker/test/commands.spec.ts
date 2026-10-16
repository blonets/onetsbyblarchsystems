import { describe, expect, it } from 'vitest';
import { RosConnection } from '@mtk/ros-api';
import type { RosCommandJob } from '@mtk/types';
import { ConnectionManager } from '../src/connection-manager.js';
import {
  createCommandsProcessor,
  CommandFailedError,
  isRetryableTrap,
  InMemoryResultReporter,
} from '../src/jobs/commands.job.js';
import { InMemoryIdempotencyStore } from '../src/idempotency.js';
import { InMemoryAuditSink } from '../src/audit.js';
import { RouterMutex } from '../src/router-mutex.js';
import { ScriptedTransport, reDone, trap } from './helpers.js';

function setup(handler: (words: string[]) => string[][]) {
  const manager = new ConnectionManager(
    async () => {
      const conn = new RosConnection(new ScriptedTransport(handler));
      await conn.connect();
      return conn;
    },
    { backoff: { maxAttempts: 1 }, sleep: async () => {} },
  );
  const idempotency = new InMemoryIdempotencyStore();
  const audit = new InMemoryAuditSink();
  const reporter = new InMemoryResultReporter();
  const process = createCommandsProcessor({
    manager,
    mutex: new RouterMutex(),
    idempotency,
    audit,
    reporter,
    retryBaseMs: 1,
    sleep: async () => {},
  });
  return { process, idempotency, audit, reporter };
}

const jobOf = (data: RosCommandJob) => ({ data }) as never;

describe('commands processor', () => {
  it('executes a sentence batch and records audit + result + idempotency', async () => {
    const { process, idempotency, audit, reporter } = setup((words) =>
      words[0] === '/ip/hotspot/user/print'
        ? reDone([{ '.id': '*1', name: 'guest1' }])
        : reDone([]),
    );
    const result = await process(
      jobOf({
        kind: 'ros', opId: 'op-1', routerId: 'r1',
        sentences: [
          ['/ip/hotspot/user/add', '=name=guest1'],
          ['/ip/hotspot/user/print', '?name=guest1'],
        ],
      }),
    );
    expect(result).toMatchObject({ opId: 'op-1', rows: 1, attempts: 1 });
    expect((await idempotency.get('op-1'))?.state).toBe('done');
    const statuses = audit.forOp('op-1').map((e) => e.result);
    expect(statuses).toEqual(['pending', 'done']);
    expect(reporter.results).toHaveLength(1);
    expect(reporter.results[0]).toMatchObject({ opId: 'op-1', ok: true });
    expect(reporter.results[0]!.rows).toHaveLength(1);
  });

  it('captures ret attribute from !done on add commands', async () => {
    const { process, reporter } = setup((words) =>
      words[0] === '/ip/hotspot/user/add'
        ? [['!done', '=ret=*5']]
        : reDone([]),
    );
    const result = await process(
      jobOf({
        kind: 'ros', opId: 'op-add-ret', routerId: 'r1',
        sentences: [['/ip/hotspot/user/add', '=name=test-user']],
      }),
    );
    expect(result).toMatchObject({ opId: 'op-add-ret', rows: 1 });
    expect(reporter.results[0]).toMatchObject({
      opId: 'op-add-ret',
      ok: true,
      rows: [expect.objectContaining({ '.id': '*5', ret: '*5' })],
    });
  });

  it('dedupes duplicate deliveries of a completed op', async () => {
    let calls = 0;
    const { process } = setup(() => {
      calls++;
      return reDone([]);
    });
    const data: RosCommandJob = {
      kind: 'ros', opId: 'op-dup', routerId: 'r1',
      sentences: [['/ip/hotspot/user/add', '=name=x']],
    };
    const first = await process(jobOf(data));
    const second = await process(jobOf(data));
    expect(calls).toBe(1);
    expect(second.deduped).toBe(true);
    expect(second.opId).toBe(first.opId);
  });

  it('fails fast on deterministic traps', async () => {
    const { process, audit, reporter } = setup(() => trap('already have such item'));
    await expect(
      process(
        jobOf({
          kind: 'ros', opId: 'op-trap', routerId: 'r1',
          sentences: [['/ip/hotspot/user/add']],
        }),
      ),
    ).rejects.toBeInstanceOf(CommandFailedError);
    const statuses = audit.forOp('op-trap').map((e) => e.result);
    expect(statuses).toEqual(['pending', 'failed']); // no retries
    expect(reporter.results[0]).toMatchObject({ opId: 'op-trap', ok: false });
  });

  it('retries retryable traps up to maxAttempts', async () => {
    let calls = 0;
    const { process } = setup(() => {
      calls++;
      return calls < 3 ? trap('timeout talking to device') : reDone([]);
    });
    const result = await process(
      jobOf({
        kind: 'ros', opId: 'op-retry', routerId: 'r1',
        sentences: [['/queue/simple/set']],
      }),
    );
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it('runs the safe-apply path and reports revert on loss', async () => {
    const { process, reporter } = setup((words) => {
      if (words[0] === '/ip/firewall/filter/print') {
        return reDone([{ '.id': '*1', chain: 'input', action: 'accept' }]);
      }
      if (words[0] === '/ip/firewall/filter/add') return [['!done', '=ret=*99']];
      if (words[0] === '/ip/firewall/filter/remove') return [['!done']];
      return [['!done']];
    });
    // checkReachability is exercised through safeApplyFirewallChange's real
    // path in safe-apply.spec.ts; here we force the verify path via a tiny
    // verifyAfterMs and a stubbed drop/ensure by using maxAttempts: 1 and a
    // manager whose ensure always works (reachable → no revert).
    const result = await process(
      jobOf({
        kind: 'ros', opId: 'op-safe', routerId: 'r1',
        sentences: [['/ip/firewall/filter/add', '=chain=input', '=action=drop']],
        safeApply: { verifyAfterMs: 0 },
      }),
    );
    expect(result.reverted).toBe(false);
    expect(reporter.results[0]!.ok).toBe(true);
  });
});

describe('isRetryableTrap', () => {
  it('classifies traps', () => {
    expect(isRetryableTrap('timeout while talking to device')).toBe(true);
    expect(isRetryableTrap('action failed: already have such item')).toBe(false);
    expect(isRetryableTrap('no such item')).toBe(false);
  });
});

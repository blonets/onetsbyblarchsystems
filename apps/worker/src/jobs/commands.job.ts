/**
 * `commands` queue — typed, idempotent, single-router config commands.
 *
 * Consumes the canonical {@link RosCommandJob} contract (the API enqueues):
 * a batch of ros-api sentences executed in order on one router.
 *
 * - Every job carries a platform `opId`: duplicate deliveries return the
 *   recorded result instead of re-executing (idempotency store).
 * - Per-router concurrency = 1 via {@link RouterMutex} (RouterOS API is
 *   effectively single-threaded per connection).
 * - Execution goes through `manager.execute()` → session drop + re-login +
 *   exactly one retry on session-level failure.
 * - `!trap` policy: retryable traps (busy/timeout/contention) are retried with
 *   backoff up to `maxAttempts`; deterministic traps (bad input, no such
 *   item, duplicates) fail fast.
 * - `safeApply`: for firewall filter changes — delegates to the safe-apply
 *   watchdog (snapshot → apply → fresh reachability check → auto-revert).
 * - Settlement is reported via {@link ResultReporter} as a
 *   {@link CommandResultPayload} (the API reconciles mirrors from `rows`)
 *   and recorded as a canonical {@link AuditEvent}.
 */

import type { Job } from 'bullmq';
import { RosTrapError, replyRows } from '@mtk/ros-api';
import type { CommandResultPayload, RosCommandJob } from '@mtk/types';
import type { ConnectionManager } from '../connection-manager.js';
import { RouterMutex } from '../router-mutex.js';
import { InMemoryIdempotencyStore, type IdempotencyStore } from '../idempotency.js';
import { InMemoryAuditSink, makeAuditEvent, type AuditSink } from '../audit.js';
import { safeApplyFirewallChange } from './safe-apply.js';

export interface CommandsDeps {
  manager: ConnectionManager;
  mutex?: RouterMutex;
  idempotency?: IdempotencyStore;
  audit?: AuditSink;
  reporter?: ResultReporter;
  /** base backoff between trap retries in ms (default 1000) */
  retryBaseMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CommandResult {
  opId: string;
  rows: number;
  attempts: number;
  reverted?: boolean;
  deduped?: boolean;
}

/** Posted to the API when a command job settles. */
export interface ResultReporter {
  report(result: CommandResultPayload): Promise<void>;
}

/** In-memory reporter for tests. */
export class InMemoryResultReporter implements ResultReporter {
  readonly results: CommandResultPayload[] = [];
  async report(result: CommandResultPayload): Promise<void> {
    this.results.push(result);
  }
}

/** HTTP reporter: POST /internal/commands/results (deploy-time wiring). */
export class HttpResultReporter implements ResultReporter {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async report(result: CommandResultPayload): Promise<void> {
    await this.fetchImpl(`${this.baseUrl}/internal/commands/results`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.serviceToken}`,
      },
      body: JSON.stringify(result),
    });
  }
}

/** Deterministic (non-retryable) trap — fail fast instead of retrying. */
export class CommandFailedError extends Error {
  constructor(
    readonly opId: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommandFailedError';
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Traps worth retrying: contention/timeout, not bad input. */
export function isRetryableTrap(message: string): boolean {
  return /timeout|timed out|busy|try again|in progress|interrupted|failure: /i.test(message);
}

export function createCommandsProcessor(deps: CommandsDeps) {
  const mutex = deps.mutex ?? new RouterMutex();
  const idempotency = deps.idempotency ?? new InMemoryIdempotencyStore();
  const audit = deps.audit ?? new InMemoryAuditSink();
  const reporter = deps.reporter ?? new InMemoryResultReporter();
  const retryBaseMs = deps.retryBaseMs ?? 1000;
  const maxAttempts = deps.maxAttempts ?? 3;
  const sleep = deps.sleep ?? defaultSleep;

  const auditIt = (
    opId: string,
    routerId: string,
    result: 'pending' | 'done' | 'failed',
    extra: Record<string, unknown> = {},
  ): Promise<void> =>
    audit.record(
      makeAuditEvent({
        actorType: 'system', action: 'ros.command', entityType: 'router',
        entityId: routerId, opId, result, ...extra,
      }),
    );

  return async (job: Job<RosCommandJob>): Promise<CommandResult> => {
    const { opId, routerId, sentences } = job.data;

    const { claimed, existing } = await idempotency.claim(opId);
    if (!claimed) {
      if (existing?.state === 'done') {
        return { ...(existing.result as CommandResult), deduped: true };
      }
      throw new Error(`op ${opId} is already ${existing?.state} — duplicate delivery`);
    }

    return mutex.run(routerId, async () => {
      await auditIt(opId, routerId, 'pending');
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const exec = job.data.safeApply
            ? await safeApplyFirewallChange(
                { manager: deps.manager, audit, sleep },
                {
                  routerId, opId,
                  verifyAfterMs: job.data.safeApply.verifyAfterMs,
                  apply: async (talk) => {
                    const rows: Record<string, string>[] = [];
                    for (const sentence of sentences) rows.push(...(await talk(sentence)));
                    return rows;
                  },
                },
              )
            : await deps.manager.execute(
                routerId,
                async (conn) => {
                  const rows: Record<string, string>[] = [];
                  for (const sentence of sentences) {
                    rows.push(...replyRows(await conn.talk(sentence)));
                  }
                  return { rows: rows.length, reverted: false, allRows: rows };
                },
                { opId },
              );
          const result: CommandResult = {
            opId, rows: exec.rows, attempts: attempt, reverted: exec.reverted,
          };
          await idempotency.complete(opId, result);
          await auditIt(opId, routerId, 'done', {
            after: { rows: exec.rows, attempts: attempt, reverted: exec.reverted },
          });
          await reporter.report({ opId, ok: true, rows: exec.allRows });
          return result;
        } catch (err) {
          lastError = err;
          const message = (err as Error).message;
          if (err instanceof RosTrapError && !isRetryableTrap(message)) {
            return failFast(opId, routerId, message);
          }
          if (attempt < maxAttempts) await sleep(retryBaseMs * 2 ** (attempt - 1));
        }
      }
      const message = (lastError as Error)?.message ?? 'command failed';
      return failFast(opId, routerId, message);
    });
  };

  async function failFast(opId: string, routerId: string, message: string): Promise<never> {
    await idempotency.fail(opId, message);
    await auditIt(opId, routerId, 'failed', { error: message });
    await reporter.report({ opId, ok: false, error: message });
    throw new CommandFailedError(opId, message);
  }
}

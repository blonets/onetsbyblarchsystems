/**
 * Audit sink — every mutating worker action records a canonical
 * {@link AuditEvent} (ARCH §6): who, what, router, before/after, opId.
 *
 * The worker always acts as `actorType: 'system'`; human actors are recorded
 * on the `actorId` the API passes through the job.
 */

import { newOpId, type AuditEvent } from '@mtk/types';

export interface AuditSink {
  record(entry: AuditEvent): Promise<void>;
}

/** Build an AuditEvent with generated id/createdAt. */
export function makeAuditEvent(
  init: Omit<AuditEvent, 'id' | 'createdAt'> & { createdAt?: string },
): AuditEvent {
  const { createdAt, ...rest } = init;
  return {
    ...rest,
    id: newOpId(),
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

/** In-memory sink for tests. */
export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async record(entry: AuditEvent): Promise<void> {
    this.events.push(entry);
  }

  forOp(opId: string): AuditEvent[] {
    return this.events.filter((e) => e.opId === opId);
  }
}

/**
 * HTTP sink posting to the API's audit endpoint (deploy-time wiring).
 * Failures are swallowed — audit must never break the action it records.
 */
export class HttpAuditSink implements AuditSink {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async record(entry: AuditEvent): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl}/internal/worker/audit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-key': this.serviceToken,
        },
        body: JSON.stringify(entry),
      });
    } catch {
      // audit is best-effort from the worker's perspective
    }
  }
}

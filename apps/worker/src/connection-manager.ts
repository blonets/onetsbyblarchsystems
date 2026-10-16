/**
 * ConnectionManager — one persistent ros-api session per router.
 *
 * - `ensure(routerId)` returns the live session, dialing it (with exponential
 *   backoff + jitter) through the injected factory when missing or dead.
 * - Login order is enforced by `@mtk/ros-api`: modern `/login` first, MD5
 *   challenge fallback for pre-6.43 devices (live-validated on 6.49.17 CHR).
 * - Transport close → session marked offline, downtime entry opened, and
 *   `router.offline` emitted. Next `ensure()` re-dials and re-logs-in, then
 *   closes the downtime entry and emits `router.online`.
 * - `execute(routerId, op, { opId })`: runs a command against the session;
 *   on session-level failure it drops the session, re-establishes it once and
 *   retries the command a single time (idempotent by opId).
 * - Heartbeat probes feed `recordProbe(routerId, ok)`; the health monitor
 *   (health-monitor.ts) owns the 3-missed-pings → offline policy.
 *
 * Emitted events: `router.online`, `router.offline`.
 */

import { EventEmitter } from 'node:events';
import { RosConnection, RosFatalError, RosTrapError, RosError } from '@mtk/ros-api';
import { newOpId, type DowntimeEntry } from '@mtk/types';
import { withBackoff, type BackoffOptions } from './backoff.js';

/**
 * Builds a live, logged-in ros-api session for a router.
 * Intended implementation: resolve the router's tunnel IP + apiPort + vaulted
 * credentials via the RouterRegistry, connect over the SSTP tunnel with
 * backoff, and log in (ros-api tries modern first, legacy fallback).
 */
export type ConnectionFactory = (routerId: string) => Promise<RosConnection>;

export interface ConnectionManagerOptions {
  /** clock, injectable for deterministic tests */
  now?: () => number;
  /** reconnect backoff applied inside `ensure` */
  backoff?: BackoffOptions;
  /** `sleep` override for deterministic backoff tests */
  sleep?: (ms: number) => Promise<void>;
}

export type RouterStatusEvent = 'router.online' | 'router.offline';

interface Session {
  conn: RosConnection;
  online: boolean;
}

export class ConnectionManager extends EventEmitter {
  private readonly sessions = new Map<string, Session>();
  private readonly downtime = new Map<string, DowntimeEntry[]>();
  private readonly establishing = new Map<string, Promise<RosConnection>>();
  private readonly now: () => number;
  private readonly backoff: BackoffOptions;
  private readonly sleep?: (ms: number) => Promise<void>;

  constructor(
    private readonly factory: ConnectionFactory,
    options: ConnectionManagerOptions = {},
  ) {
    super();
    this.now = options.now ?? Date.now;
    this.backoff = options.backoff ?? { maxAttempts: 6, baseMs: 1000, maxMs: 60_000 };
    this.sleep = options.sleep;
  }

  /**
   * Return the live session for a router, establishing it (via the factory)
   * when missing or dead. Concurrent callers share one establishment attempt.
   * Wires transport-close → offline + downtime ledger.
   */
  async ensure(routerId: string): Promise<RosConnection> {
    const existing = this.sessions.get(routerId);
    if (existing && existing.online && existing.conn.connected) return existing.conn;

    let pending = this.establishing.get(routerId);
    if (!pending) {
      pending = this.establish(routerId);
      this.establishing.set(routerId, pending);
      try {
        await pending;
      } finally {
        this.establishing.delete(routerId);
      }
    } else {
      await pending;
    }
    const session = this.sessions.get(routerId);
    if (!session) throw new RosError(`failed to establish session for ${routerId}`);
    return session.conn;
  }

  private async establish(routerId: string): Promise<RosConnection> {
    const { value: conn } = await withBackoff(
      () => this.factory(routerId),
      this.backoff,
      this.sleep ? { sleep: this.sleep, random: () => 0.75 } : {},
      // do not retry auth failures: a bad password never heals with backoff
      (err) => !/login|auth|password/i.test((err as Error)?.message ?? ''),
    );
    conn.onTransportClose(() => this.handleClose(routerId, 'transport closed'));
    this.sessions.set(routerId, { conn, online: true });
    this.closeDowntime(routerId);
    this.emit('router.online', { routerId, at: new Date(this.now()).toISOString() });
    return conn;
  }

  /**
   * Run `op` against the router's session. When the session is dead
   * (`!fatal`, transport error, closed socket), the session is dropped,
   * re-established once, and `op` is retried exactly once. Callers must make
   * `op` idempotent (keyed by `opId`) — see jobs/commands.job.ts.
   */
  async execute<T>(
    routerId: string,
    op: (conn: RosConnection) => Promise<T>,
    opts: { opId?: string } = {},
  ): Promise<T> {
    const conn = await this.ensure(routerId);
    try {
      return await op(conn);
    } catch (err) {
      if (!isSessionFailure(err)) throw err;
      // Session-level failure: drop, re-establish, retry once.
      await this.drop(routerId);
      const fresh = await this.ensure(routerId);
      try {
        return await op(fresh);
      } catch (retryErr) {
        this.reportFailure(routerId, (retryErr as Error).message, opts.opId);
        throw retryErr;
      }
    }
  }

  /**
   * Record one heartbeat probe result. A success resets the miss counter and
   * closes any open downtime row. Misses are only counted here — the health
   * monitor decides when misses become an outage.
   */
  recordProbe(routerId: string, ok: boolean): void {
    if (ok) {
      const session = this.sessions.get(routerId);
      const wasOffline = session !== undefined && !session.online;
      if (session) session.online = true;
      this.closeDowntime(routerId);
      if (wasOffline) {
        this.emit('router.online', { routerId, at: new Date(this.now()).toISOString() });
      }
    }
  }

  /** Explicitly mark a router unreachable (health monitor after 3 missed pings). */
  markUnreachable(routerId: string, reason: string): void {
    this.handleClose(routerId, reason);
  }

  /** Record an operation failure against a router (e.g. a poller op threw). */
  reportFailure(routerId: string, reason: string, _opId?: string): void {
    this.handleClose(routerId, reason);
  }

  /** Drop a session entirely (router decommissioned or session poisoned). */
  async drop(routerId: string): Promise<void> {
    const session = this.sessions.get(routerId);
    this.sessions.delete(routerId);
    if (session) await session.conn.close().catch(() => undefined);
  }

  /** Drop every known session (shutdown). */
  async dropAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.drop(id)));
  }

  /** Live session if one exists (no dialing). */
  peek(routerId: string): RosConnection | undefined {
    const session = this.sessions.get(routerId);
    return session?.online && session.conn.connected ? session.conn : undefined;
  }

  /** Router ids with a known session entry. */
  knownRouterIds(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Downtime entries, oldest first, in the canonical {@link DowntimeEntry}
   * shape. Still-open outages carry a running `durationS` computed against
   * the injected clock.
   */
  getDowntime(routerId: string): DowntimeEntry[] {
    const entries = this.downtime.get(routerId) ?? [];
    const now = this.now();
    return entries.map((e) =>
      e.endedAt
        ? e
        : { ...e, durationS: Math.floor((now - Date.parse(e.startedAt)) / 1000) },
    );
  }

  private handleClose(routerId: string, reason: string): void {
    const session = this.sessions.get(routerId);
    const wasOnline = !session || session.online;
    if (session) session.online = false;
    const entries = this.downtime.get(routerId) ?? [];
    const open = entries[entries.length - 1];
    if (!open || open.endedAt) {
      entries.push({
        id: newOpId(),
        routerId,
        startedAt: new Date(this.now()).toISOString(),
        cause: reason,
      });
      this.downtime.set(routerId, entries);
    }
    if (wasOnline) {
      this.emit('router.offline', {
        routerId,
        at: new Date(this.now()).toISOString(),
        reason,
      });
    }
  }

  private closeDowntime(routerId: string): void {
    const entries = this.downtime.get(routerId);
    const open = entries?.[entries.length - 1];
    if (open && !open.endedAt) {
      const at = this.now();
      open.endedAt = new Date(at).toISOString();
      open.durationS = Math.floor((at - Date.parse(open.startedAt)) / 1000);
    }
  }
}

/** Session-level failures justify drop + re-login + one retry. */
function isSessionFailure(err: unknown): boolean {
  if (err instanceof RosFatalError) return true;
  // A !trap is a command rejection on a LIVE session — never a session failure,
  // even when its message mentions timeouts.
  if (err instanceof RosTrapError) return false;
  const msg = (err as Error)?.message ?? '';
  return /socket|econnreset|epipe|etimedout|timeout|closed|not connected/i.test(msg);
}

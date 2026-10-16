import { RosConnection } from '@mtk/ros-api';
import type { DowntimeEntry } from '@mtk/types';

/**
 * Builds a live, logged-in ros-api session for a router.
 * Intended implementation: resolve the router's tunnel IP + apiPort from the
 * API/DB, connect over the SSTP tunnel with backoff, and log in with the
 * vaulted per-router API credentials.
 */
export type ConnectionFactory = (routerId: string) => Promise<RosConnection>;

export interface ConnectionManagerOptions {
  /** clock, injectable for deterministic tests */
  now?: () => number;
}

interface Session {
  conn: RosConnection;
  online: boolean;
}

/**
 * Keeps one persistent ros-api session per router and maintains the downtime
 * ledger: every disconnect opens an entry, every reconnect closes it with a
 * duration. Persistence to the TimescaleDB DowntimeLedger hypertable is a TODO
 * (see the inline notes) — the in-memory ledger is the source of truth until then.
 */
export class ConnectionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly downtime = new Map<string, DowntimeEntry[]>();
  private readonly now: () => number;

  constructor(
    private readonly factory: ConnectionFactory,
    options: ConnectionManagerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Return the live session for a router, establishing it (via the factory)
   * when missing or dead. Wires transport-close → downtime ledger.
   */
  async ensure(routerId: string): Promise<RosConnection> {
    const existing = this.sessions.get(routerId);
    if (existing && existing.conn.connected) return existing.conn;

    const conn = await this.factory(routerId);
    conn.onTransportClose(() => this.handleClose(routerId, 'transport closed'));
    this.sessions.set(routerId, { conn, online: true });
    this.closeDowntime(routerId);
    return conn;
  }

  /** Record an operation failure against a router (e.g. a poller op threw). */
  reportFailure(routerId: string, reason: string): void {
    this.handleClose(routerId, reason);
  }

  /** Drop a session entirely (router decommissioned). */
  async drop(routerId: string): Promise<void> {
    const session = this.sessions.get(routerId);
    this.sessions.delete(routerId);
    if (session) await session.conn.close().catch(() => undefined);
  }

  /**
   * Downtime entries, oldest first. Still-open outages carry a running
   * `durationMs` computed against the injected clock.
   */
  getDowntime(routerId: string): DowntimeEntry[] {
    const entries = this.downtime.get(routerId) ?? [];
    const now = this.now();
    return entries.map((e) =>
      e.reconnectedAt ? e : { ...e, durationMs: now - Date.parse(e.disconnectedAt) },
    );
  }

  private handleClose(routerId: string, reason: string): void {
    const session = this.sessions.get(routerId);
    if (session) session.online = false;
    const entries = this.downtime.get(routerId) ?? [];
    const open = entries[entries.length - 1];
    if (open && !open.reconnectedAt) return; // this outage is already being tracked
    entries.push({
      routerId,
      disconnectedAt: new Date(this.now()).toISOString(),
      reason,
    });
    this.downtime.set(routerId, entries);
    // TODO: persist the opened window to the DowntimeLedger hypertable.
  }

  private closeDowntime(routerId: string): void {
    const entries = this.downtime.get(routerId);
    const open = entries?.[entries.length - 1];
    if (open && !open.reconnectedAt) {
      const at = this.now();
      open.reconnectedAt = new Date(at).toISOString();
      open.durationMs = at - Date.parse(open.disconnectedAt);
      // TODO: persist the closed window to the DowntimeLedger hypertable.
    }
  }
}

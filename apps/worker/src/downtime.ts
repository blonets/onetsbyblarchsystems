/**
 * Downtime ledger repository (canonical {@link DowntimeEntry} shape).
 *
 * Rules (ARCH §3.3, §5):
 * - a router is declared offline after 3 consecutive missed heartbeats
 *   (see health-monitor.ts); that opens a ledger row with `startedAt`
 * - the next successful heartbeat reconnect closes the row with `endedAt`
 *   and the computed `durationS`
 *
 * The in-memory implementation backs unit tests and single-process runs;
 * the SQL DDL in `migrations/001-metrics.sql` defines the table the
 * API/Prisma layer persists these rows to at deploy time.
 */

import { newOpId, type DowntimeEntry } from '@mtk/types';

export interface DowntimeRepository {
  /** Open rows keyed by router id. */
  open(routerId: string, startedAt: string, cause?: string): Promise<void>;
  /** Close the open row; resolves with the closed entry or null when none open. */
  close(routerId: string, endedAt: string): Promise<DowntimeEntry | null>;
  /** All entries for a router, oldest first. */
  list(routerId: string): Promise<DowntimeEntry[]>;
}

export class InMemoryDowntimeRepository implements DowntimeRepository {
  private readonly entries = new Map<string, DowntimeEntry[]>();

  async open(routerId: string, startedAt: string, cause?: string): Promise<void> {
    const rows = this.entries.get(routerId) ?? [];
    const open = rows[rows.length - 1];
    if (open && !open.endedAt) return; // already tracking this outage
    rows.push({ id: newOpId(), routerId, startedAt, cause: cause ?? null });
    this.entries.set(routerId, rows);
  }

  async close(routerId: string, endedAt: string): Promise<DowntimeEntry | null> {
    const rows = this.entries.get(routerId);
    const open = rows?.[rows.length - 1];
    if (!open || open.endedAt) return null;
    open.endedAt = endedAt;
    open.durationS = Math.floor(
      (Date.parse(endedAt) - Date.parse(open.startedAt)) / 1000,
    );
    return open;
  }

  async list(routerId: string): Promise<DowntimeEntry[]> {
    return [...(this.entries.get(routerId) ?? [])];
  }
}

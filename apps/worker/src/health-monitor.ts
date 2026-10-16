/**
 * Health monitor — the 30 s heartbeat that decides router up/down.
 *
 * Every `intervalMs` (default 30 000) it pings each known router with a
 * lightweight `/system/identity/print`. Policy (ARCH §3.3):
 * - 3 consecutive missed pings → `manager.markUnreachable()` → downtime row
 *   opens (startedAt), `router.offline` emitted
 * - next successful ping → `manager.recordProbe(ok)` closes the row with
 *   `endedAt` + duration and emits `router.online`
 *
 * A missed ping is any throw (timeout, trap, transport error). Successful
 * polls from the poller shard also count as heartbeats via `noteActivity()`,
 * so a healthy router under poll load is never double-probed.
 */

import { healthPing } from './ros-ext.js';
import type { ConnectionManager } from './connection-manager.js';

export interface HealthMonitorOptions {
  intervalMs?: number;
  /** consecutive misses before a router is declared offline (default 3) */
  missThreshold?: number;
  /** clock override for tests */
  now?: () => number;
}

export class HealthMonitor {
  private readonly misses = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly intervalMs: number;
  private readonly missThreshold: number;

  constructor(
    private readonly manager: ConnectionManager,
    private readonly listRouterIds: () => Promise<string[]>,
    options: HealthMonitorOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 30_000;
    this.missThreshold = options.missThreshold ?? 3;
  }

  /** Start the 30 s loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async (): Promise<void> => {
      if (!this.running) return;
      try {
        await this.probeAll();
      } finally {
        if (this.running) this.timer = setTimeout(tick, this.intervalMs);
      }
    };
    this.timer = setTimeout(tick, this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** One probe sweep — also callable directly in tests / live validation. */
  async probeAll(): Promise<{ ok: number; missed: number }> {
    const ids = await this.listRouterIds();
    let ok = 0;
    let missed = 0;
    for (const routerId of ids) {
      try {
        const conn = await this.manager.ensure(routerId);
        await conn.talk(healthPing());
        this.misses.set(routerId, 0);
        this.manager.recordProbe(routerId, true);
        ok++;
      } catch (err) {
        missed++;
        const count = (this.misses.get(routerId) ?? 0) + 1;
        this.misses.set(routerId, count);
        this.manager.recordProbe(routerId, false);
        if (count >= this.missThreshold) {
          this.manager.markUnreachable(routerId, `missed ${count} heartbeats`);
        }
      }
    }
    return { ok, missed };
  }

  /** External activity (e.g. a successful poll) counts as a heartbeat. */
  noteActivity(routerId: string): void {
    this.misses.set(routerId, 0);
    this.manager.recordProbe(routerId, true);
  }

  missCount(routerId: string): number {
    return this.misses.get(routerId) ?? 0;
  }
}

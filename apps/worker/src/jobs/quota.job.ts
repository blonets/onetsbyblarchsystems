/**
 * Quota enforcer — consumes the canonical {@link QuotaJob} (one router per
 * job; the scheduler enqueues one per router per shard every 5 min).
 *
 * Reads hotspot users + profiles + active sessions, computes usage against
 * limits, and enforces:
 * - user `limit-uptime` exceeded by an active session → disable user + kick session
 * - user `limit-bytes-total` / `limit-bytes-in` / `limit-bytes-out` exceeded → disable
 * - profile `session-timeout` exceeded by an active session → kick (RouterOS
 *   usually disconnects these itself; the enforcer closes the gap and records it)
 *
 * Over-quota actions emit the canonical `quota.exceeded` bus event and are
 * recorded as canonical {@link AuditEvent}s. Users are never deleted —
 * disabling is reversible, and an operator re-enables them.
 */

import type { Job } from 'bullmq';
import {
  hotspotProfileList,
  hotspotUserDisable,
  hotspotUserList,
  parseHotspotProfiles,
  replyRows,
  type RosConnection,
} from '@mtk/ros-api';
import type { QuotaJob } from '@mtk/types';
import type { ConnectionManager } from '../connection-manager.js';
import { hotspotActiveList, hotspotActiveRemove, type HotspotActiveSession } from '../ros-ext.js';
import { parseUptimeSeconds } from '../metrics.js';
import type { AuditSink } from '../audit.js';
import { InMemoryAuditSink, makeAuditEvent } from '../audit.js';
import type { EventBus } from '../queues.js';
import { InMemoryEventBus } from '../queues.js';

export interface QuotaDeps {
  manager: ConnectionManager;
  audit?: AuditSink;
  events?: EventBus;
  now?: () => number;
  /** dry run: evaluate and report, take no enforcement action */
  dryRun?: boolean;
}

export interface QuotaViolation {
  routerId: string;
  user: string;
  userId: string;
  reason: 'uptime' | 'bytes-total' | 'bytes-in' | 'bytes-out' | 'session-timeout';
  limit: string;
  used: string;
  action: 'disabled' | 'kicked' | 'disabled+kicked' | 'dry-run';
}

export interface QuotaResult {
  routerId: string;
  evaluated: number;
  violations: QuotaViolation[];
}

interface RawUser extends Record<string, string> {
  '.id': string;
  name: string;
}

/** Parse "5M"/"1G"/"512K" byte sizes. */
export function parseBytes(size: string | undefined): number | undefined {
  if (!size) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*([KMGT]?)$/i.exec(size.trim());
  if (!m) return undefined;
  const mult = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[
    m[2].toUpperCase()
  ] as number;
  return Math.floor(Number(m[1]) * mult);
}

export function createQuotaProcessor(deps: QuotaDeps) {
  const audit = deps.audit ?? new InMemoryAuditSink();
  const events = deps.events ?? new InMemoryEventBus();
  const now = deps.now ?? Date.now;
  const dryRun = deps.dryRun ?? false;
  const at = () => new Date(now()).toISOString();

  return async (job: Job<QuotaJob>): Promise<QuotaResult> => {
    const { opId, routerId } = job.data;
    const violations: QuotaViolation[] = [];
    try {
      await deps.manager.execute(routerId, async (conn) => {
        const users = replyRows(await conn.talk(hotspotUserList())) as RawUser[];
        const profiles = parseHotspotProfiles(await conn.talk(hotspotProfileList()));
        const sessions = replyRows(await conn.talk(hotspotActiveList())) as HotspotActiveSession[];
        const byUser = new Map<string, HotspotActiveSession[]>();
        for (const s of sessions) {
          if (!s.user) continue;
          const list = byUser.get(s.user) ?? [];
          list.push(s);
          byUser.set(s.user, list);
        }
        const profileTimeout = new Map(
          profiles.map((p) => [p.name, parseUptimeSeconds(p.sessionTimeout)]),
        );

        for (const user of users) {
          if (user['disabled'] === 'yes' || user['dynamic'] === 'yes') continue;
          const active = byUser.get(user.name) ?? [];
          for (const session of active) {
            const hit = evaluateSession(user, session, profileTimeout.get(user['profile'] ?? ''));
            if (!hit) continue;
            const action = await enforce(opId, routerId, user, session, hit, conn);
            violations.push({
              routerId, user: user.name, userId: user['.id'],
              reason: hit.reason, limit: hit.limit, used: hit.used, action,
            });
          }
        }
      });
    } catch (err) {
      deps.manager.reportFailure(routerId, `quota: ${(err as Error).message}`);
      throw err;
    }
    return { routerId, evaluated: violations.length, violations };
  };

  async function enforce(
    opId: string,
    routerId: string,
    user: RawUser,
    session: HotspotActiveSession,
    hit: { reason: QuotaViolation['reason']; limit: string; used: string },
    conn: RosConnection,
  ): Promise<QuotaViolation['action']> {
    const detail = { user: user.name, reason: hit.reason, limit: hit.limit, used: hit.used };
    if (dryRun) {
      await audit.record(
        makeAuditEvent({
          actorType: 'system', action: 'quota.evaluate', entityType: 'router',
          entityId: routerId, opId, result: 'done', after: detail,
        }),
      );
      return 'dry-run';
    }
    // Disable the user (reversible; operators re-enable) and kick the session.
    await conn.talk(hotspotUserDisable(user['.id']));
    if (session['.id']) {
      await conn.talk(hotspotActiveRemove(session['.id']));
    }
    await audit.record(
      makeAuditEvent({
        actorType: 'system', action: 'quota.enforce', entityType: 'router',
        entityId: routerId, opId, result: 'done',
        after: { ...detail, action: 'disabled+kicked' },
      }),
    );
    await events.emit({
      event: 'quota.exceeded',
      payload: { routerId, username: user.name, at: at() },
    });
    return session['.id'] ? 'disabled+kicked' : 'disabled';
  }
}

interface QuotaHit {
  reason: QuotaViolation['reason'];
  limit: string;
  used: string;
}

/** Evaluate one active session against the user's limits + profile timeout. */
export function evaluateSession(
  user: Record<string, string>,
  session: HotspotActiveSession,
  profileSessionTimeoutSec: number | undefined,
): QuotaHit | null {
  const uptimeSec = parseUptimeSeconds(session['uptime']);
  const bytesIn = Number(session['bytes-in'] ?? 0);
  const bytesOut = Number(session['bytes-out'] ?? 0);

  const limitUptimeSec = parseUptimeSeconds(user['limit-uptime']);
  if (limitUptimeSec !== undefined && uptimeSec !== undefined && uptimeSec >= limitUptimeSec) {
    return { reason: 'uptime', limit: user['limit-uptime'], used: session['uptime'] ?? '' };
  }
  const limitTotal = parseBytes(user['limit-bytes-total']);
  if (limitTotal !== undefined && bytesIn + bytesOut >= limitTotal) {
    return {
      reason: 'bytes-total', limit: user['limit-bytes-total'],
      used: String(bytesIn + bytesOut),
    };
  }
  const limitIn = parseBytes(user['limit-bytes-in']);
  if (limitIn !== undefined && bytesIn >= limitIn) {
    return { reason: 'bytes-in', limit: user['limit-bytes-in'], used: String(bytesIn) };
  }
  const limitOut = parseBytes(user['limit-bytes-out']);
  if (limitOut !== undefined && bytesOut >= limitOut) {
    return { reason: 'bytes-out', limit: user['limit-bytes-out'], used: String(bytesOut) };
  }
  if (
    profileSessionTimeoutSec !== undefined &&
    uptimeSec !== undefined &&
    uptimeSec >= profileSessionTimeoutSec
  ) {
    return {
      reason: 'session-timeout',
      limit: String(profileSessionTimeoutSec),
      used: session['uptime'] ?? '',
    };
  }
  return null;
}

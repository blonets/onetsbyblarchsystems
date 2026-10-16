/**
 * Hotspot expiry sweep — consumes the worker-internal {@link HotspotExpirySweepJob}
 * (one router per job; a repeatable `expiry-sweep-tick` on the poll queue fans
 * one out per shard router every 15 min).
 *
 * RouterOS v7 does NOT actually disable expired hotspot users, so the platform
 * enforces expiry itself:
 * - user past `expiresAt` → `/ip/hotspot/user/disable` + kick active sessions
 *   via `/ip/hotspot/active/remove`
 * - expiryMode `remove` → additionally `/ip/hotspot/user/remove` (removed
 *   immediately, same run; the row is gone rather than lingering disabled —
 *   the backend semantics were not landed yet when this was written, so the
 *   conservative choice is documented here for the backend to align on)
 * - expiryMode `remove+notify` → `remove` + an operator notification
 *   (`alert.raised`, which the notifications module fans out per rules)
 * - ANY past-expiry user with an active session → `alert.raised` ("expired but
 *   still connected") with router/user/session details. Enforcement still
 *   happens (same posture as the quota enforcer's `quota.exceeded`), but it is
 *   never silent: the operator must see it.
 *
 * The API's user records are the expiry source of truth: only users the API
 * manages are touched (matched by device row `name`). Router-only users
 * (e.g. `default-trial`, manual entries) are never touched. Routers with no
 * hotspot server (or no hotspot package at all) are skipped quietly — not
 * reported as failures. The hub is skipped via `skipRouterIds` and must never
 * be swept.
 */

import type { Job } from 'bullmq';
import {
  hotspotServerList,
  hotspotUserDisable,
  hotspotUserList,
  hotspotUserRemove,
  replyRows,
  RosTrapError,
  type RosConnection,
} from '@mtk/ros-api';
import type { ConnectionManager } from '../connection-manager.js';
import { hotspotActiveList, hotspotActiveRemove, type HotspotActiveSession } from '../ros-ext.js';
import type { AuditSink } from '../audit.js';
import { InMemoryAuditSink, makeAuditEvent } from '../audit.js';
import type { EventBus } from '../queues.js';
import { InMemoryEventBus } from '../queues.js';

/** Worker-internal job payload: one router per job (fanned out by the tick). */
export interface HotspotExpirySweepJob {
  kind: 'hotspot-expiry-sweep';
  opId: string;
  routerId: string;
}

/** Post-expiry policy for a hotspot user. Unknown values are treated as 'disable'. */
export type HotspotExpiryMode = 'disable' | 'remove' | 'remove+notify';

/** One platform (API) hotspot-user record, as the sweep consumes it. */
export interface ExpirySweepUser {
  name: string;
  /** ISO-8601; null/undefined = no expiry → never swept. */
  expiresAt?: string | null;
  /** Defaults to 'disable' when absent. */
  expiryMode?: string | null;
  disabled?: boolean;
}

/**
 * Source of the API's hotspot user records for one router (the expiry source
 * of truth).
 *
 * Default HTTP implementation: `GET /internal/worker/routers/:id/hotspot-users`
 * with the worker service bearer token (mirrors the provision-info pattern in
 * main.ts). Contract for the API side:
 * `{ users: Array<{ name, expiresAt, expiryMode, disabled }> }`.
 * A 404 means "no hotspot data for this router" → treated as no users.
 */
export interface HotspotUserDirectory {
  listUsers(routerId: string): Promise<ExpirySweepUser[]>;
}

export class HttpHotspotUserDirectory implements HotspotUserDirectory {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listUsers(routerId: string): Promise<ExpirySweepUser[]> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/internal/worker/routers/${encodeURIComponent(routerId)}/hotspot-users`,
      { headers: { authorization: `Bearer ${this.serviceToken}` } },
    );
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`hotspot user directory fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as { users?: ExpirySweepUser[] };
    return body.users ?? [];
  }
}

export interface ExpirySweepDeps {
  manager: ConnectionManager;
  users: HotspotUserDirectory;
  audit?: AuditSink;
  events?: EventBus;
  now?: () => number;
  /** dry run: evaluate and report, take no enforcement action */
  dryRun?: boolean;
  /** router ids the sweep must never touch (the hub, …) */
  skipRouterIds?: string[];
}

export interface ExpirySweepViolation {
  routerId: string;
  user: string;
  userId: string;
  expiresAt: string;
  mode: HotspotExpiryMode;
  hadActiveSession: boolean;
  action:
    | 'disabled'
    | 'disabled+kicked'
    | 'removed'
    | 'disabled+removed'
    | 'disabled+kicked+removed'
    | 'dry-run';
}

export type ExpirySweepSkipReason = 'hub-guard' | 'no-hotspot' | 'no-hotspot-package';

export interface ExpirySweepResult {
  routerId: string;
  evaluated: number;
  swept: ExpirySweepViolation[];
  skipped: boolean;
  skipReason?: ExpirySweepSkipReason;
}

interface RawUser extends Record<string, string> {
  '.id': string;
  name: string;
}

/** Normalize the API's expiryMode: unknown/absent → 'disable' (safest default). */
export function normalizeExpiryMode(mode: string | null | undefined): HotspotExpiryMode {
  if (mode === 'remove' || mode === 'remove+notify') return mode;
  return 'disable';
}

/** True when `expiresAt` is a valid ISO-8601 timestamp at or before `nowMs`. */
export function isExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

function isNoSuchCommand(err: unknown): boolean {
  return err instanceof RosTrapError && /no such command/i.test(err.message);
}

export function createExpirySweepProcessor(deps: ExpirySweepDeps) {
  const audit = deps.audit ?? new InMemoryAuditSink();
  const events = deps.events ?? new InMemoryEventBus();
  const now = deps.now ?? Date.now;
  const dryRun = deps.dryRun ?? false;
  const skipped = new Set(deps.skipRouterIds ?? []);
  const at = () => new Date(now()).toISOString();

  return async (job: Job<HotspotExpirySweepJob>): Promise<ExpirySweepResult> => {
    const { opId, routerId } = job.data;

    // Hub guard: the sweep must never run against the hub (or any skipped id).
    if (skipped.has(routerId)) {
      return { routerId, evaluated: 0, swept: [], skipped: true, skipReason: 'hub-guard' };
    }

    const swept: ExpirySweepViolation[] = [];
    let evaluated = 0;
    let skipReason: ExpirySweepSkipReason | undefined;

    try {
      await deps.manager.execute(routerId, async (conn) => {
        // Routers with no hotspot package trap on /ip/hotspot/* — clean skip,
        // not a failure. A router with the package but no server configured
        // simply has nothing to enforce.
        let servers: Array<Record<string, string>>;
        try {
          servers = replyRows(await conn.talk(hotspotServerList()));
        } catch (err) {
          if (isNoSuchCommand(err)) {
            skipReason = 'no-hotspot-package';
            return;
          }
          throw err;
        }
        if (servers.length === 0) {
          skipReason = 'no-hotspot';
          return;
        }

        const deviceUsers = replyRows(await conn.talk(hotspotUserList())) as RawUser[];
        const sessions = replyRows(await conn.talk(hotspotActiveList())) as HotspotActiveSession[];
        const platformUsers = await deps.users.listUsers(routerId);

        const byName = new Map(deviceUsers.map((u) => [u.name, u]));
        const sessionsByUser = new Map<string, HotspotActiveSession[]>();
        for (const s of sessions) {
          if (!s.user) continue;
          const list = sessionsByUser.get(s.user) ?? [];
          list.push(s);
          sessionsByUser.set(s.user, list);
        }

        const nowMs = now();
        for (const platformUser of platformUsers) {
          if (!isExpired(platformUser.expiresAt, nowMs)) continue;
          evaluated += 1;
          const deviceUser = byName.get(platformUser.name);
          // Not on the router: nothing to enforce (API record only).
          if (!deviceUser) continue;
          const mode = normalizeExpiryMode(platformUser.expiryMode);
          const userSessions = sessionsByUser.get(deviceUser.name) ?? [];
          const violation = await enforce(
            opId, routerId, deviceUser, platformUser.expiresAt!, mode, userSessions, conn,
          );
          if (violation) swept.push(violation);
        }
      });
    } catch (err) {
      deps.manager.reportFailure(routerId, `expiry-sweep: ${(err as Error).message}`);
      throw err;
    }

    return { routerId, evaluated, swept, skipped: skipReason !== undefined, skipReason };
  };

  async function enforce(
    opId: string,
    routerId: string,
    user: RawUser,
    expiresAt: string,
    mode: HotspotExpiryMode,
    sessions: HotspotActiveSession[],
    conn: RosConnection,
  ): Promise<ExpirySweepViolation | null> {
    const base = {
      routerId,
      user: user.name,
      userId: user['.id'],
      expiresAt,
      mode,
      hadActiveSession: sessions.length > 0,
    };
    const detail = { user: user.name, expiresAt, mode, sessions: sessions.length };

    // Already fully enforced → no-op (no audit noise): disabled, no sessions,
    // and the mode doesn't call for removal.
    const needsDisable = user['disabled'] !== 'yes';
    const needsKick = sessions.some((s) => s['.id']);
    const needsRemove = mode === 'remove' || mode === 'remove+notify';
    if (!needsDisable && !needsKick && !needsRemove) return null;

    if (dryRun) {
      await audit.record(
        makeAuditEvent({
          actorType: 'system',
          action: 'hotspot.expiry.evaluate',
          entityType: 'router',
          entityId: routerId,
          opId,
          result: 'done',
          after: detail,
        }),
      );
      return { ...base, action: 'dry-run' };
    }

    const steps: string[] = [];
    // Disable the expired user (reversible) — v7 leaves them usable otherwise.
    if (user['disabled'] !== 'yes') {
      await conn.talk(hotspotUserDisable(user['.id']));
      steps.push('disabled');
    }
    // Kick every active session of the expired user.
    let kicked = 0;
    for (const session of sessions) {
      if (!session['.id']) continue;
      await conn.talk(hotspotActiveRemove(session['.id']));
      kicked += 1;
    }
    if (kicked > 0) steps.push('kicked');

    // "Expired but still connected" is never silent: the operator must see it.
    if (sessions.length > 0) {
      const sample = sessions
        .slice(0, 3)
        .map((s) => `${s.address ?? '?'} (uptime ${s.uptime ?? '?'})`)
        .join(', ');
      await events.emit({
        event: 'alert.raised',
        payload: {
          routerId,
          severity: 'warning',
          message:
            `Hotspot user "${user.name}" on router ${routerId} expired at ${expiresAt} ` +
            `but still had ${sessions.length} active session(s); expiry sweep disabled ` +
            `the user and removed the session(s). ${sample}`,
          at: at(),
        },
      });
    }

    // Post-expiry removal policy: remove the user row from the router.
    if (mode === 'remove' || mode === 'remove+notify') {
      await conn.talk(hotspotUserRemove(user['.id']));
      steps.push('removed');
      if (mode === 'remove+notify') {
        await events.emit({
          event: 'alert.raised',
          payload: {
            routerId,
            severity: 'info',
            message:
              `Hotspot user "${user.name}" on router ${routerId} (expired ${expiresAt}) ` +
              `was removed from the router per its remove+notify expiry policy.`,
            at: at(),
          },
        });
      }
    }

    await audit.record(
      makeAuditEvent({
        actorType: 'system',
        action: 'hotspot.expiry.enforce',
        entityType: 'router',
        entityId: routerId,
        opId,
        result: 'done',
        after: { ...detail, steps },
      }),
    );

    const action =
      steps.includes('removed') && steps.includes('disabled') && kicked > 0
        ? 'disabled+kicked+removed'
        : steps.includes('removed') && steps.includes('disabled')
          ? 'disabled+removed'
          : steps.includes('removed')
            ? 'removed'
            : kicked > 0
              ? 'disabled+kicked'
              : 'disabled';
    return { ...base, action };
  }
}

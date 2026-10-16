/**
 * Provision queue — consumes the canonical {@link ProvisionJob} contract:
 * - `verify-tunnel`: after the onboarding callback — confirm the hub PPP
 *   session is active for the router's SSTP username and the router carries
 *   the `panel-uuid:<uuid>` stamp in `/system note`
 * - `rotate-secrets`: rotate the SSTP password (hub `/ppp secret`) and the
 *   API password (router `/user`) — router first over the existing session,
 *   then the hub secret (ARCH §5: old creds kept as fallback for 1 cycle,
 *   tracked API-side)
 * - `decommission`: remove the hub `/ppp secret` and mark the router
 *   decommissioned via the API callback
 *
 * Hub-side mutations run over a dedicated hub connection. New secrets come
 * from the injected {@link SecretProvider} (vault-backed at deploy time) —
 * the worker never invents credentials.
 *
 * SAFETY: in tests only disposable `test-del-*` usernames may be mutated on
 * the hub. Production hub mutations require `allowHubMutations: true`.
 */

import type { Job } from 'bullmq';
import {
  pppActiveList,
  pppSecretList,
  pppSecretRemove,
  pppSecretSet,
  parsePppActive,
  parsePppSecrets,
  systemNotePrint,
  parseSystemNote,
  replyRows,
} from '@mtk/ros-api';
import type { ProvisionJob } from '@mtk/types';
import type { ConnectionManager } from '../connection-manager.js';
import { systemUserList, systemUserSetPassword } from '../ros-ext.js';
import type { AuditSink } from '../audit.js';
import { InMemoryAuditSink, makeAuditEvent } from '../audit.js';
import type { EventBus } from '../queues.js';
import { InMemoryEventBus } from '../queues.js';

/** Vault-backed secret source (deploy-time: HTTP to the API/vault). */
export interface SecretProvider {
  /** Fresh SSTP + API passwords for a router (32+ chars, generated vault-side). */
  freshSecrets(routerId: string): Promise<{ sstpPassword: string; apiPassword: string }>;
}

export interface ProvisionDeps {
  /** router sessions */
  manager: ConnectionManager;
  /** hub CHR session */
  hub: ConnectionManager;
  /** router id of the hub CHR in `hub` */
  hubRouterId: string;
  /** resolve a router id to its SSTP username + uuid (API/registry) */
  routerInfo: (routerId: string) => Promise<{ sstpUsername: string; uuid: string }>;
  secrets?: SecretProvider;
  audit?: AuditSink;
  events?: EventBus;
  /**
   * Guard: hub mutations in tests are restricted to disposable `test-del-*`
   * usernames unless this is true.
   */
  allowHubMutations?: boolean;
  /** mark the router decommissioned API-side */
  markDecommissioned?: (routerId: string) => Promise<void>;
  now?: () => number;
}

export interface ProvisionResult {
  type: string;
  routerId?: string;
  ok: boolean;
}

const DISPOSABLE_PREFIX = 'test-del-';

export function createProvisionProcessor(deps: ProvisionDeps) {
  const audit = deps.audit ?? new InMemoryAuditSink();
  const events = deps.events ?? new InMemoryEventBus();
  const now = deps.now ?? Date.now;
  const at = () => new Date(now()).toISOString();

  const auditIt = (
    opId: string, routerId: string | undefined, action: string,
    result: 'pending' | 'done' | 'failed', extra: Record<string, unknown> = {},
  ): Promise<void> =>
    audit.record(
      makeAuditEvent({
        actorType: 'system', action, entityType: 'router',
        entityId: routerId ?? null, opId, result, ...extra,
      }),
    );

  const guard = (username: string, op: string): void => {
    if (deps.allowHubMutations) return;
    if (!username.startsWith(DISPOSABLE_PREFIX)) {
      throw new Error(
        `refusing hub ${op} for non-disposable username ${username} (set allowHubMutations for production)`,
      );
    }
  };

  const hubSecretId = async (username: string): Promise<string | undefined> => {
    const conn = await deps.hub.ensure(deps.hubRouterId);
    const secrets = parsePppSecrets(await conn.talk(pppSecretList({ name: username })));
    return secrets.find((s) => s.name === username)?.id;
  };

  return async (job: Job<ProvisionJob>): Promise<ProvisionResult> => {
    const { kind, type, opId, routerId } = job.data;
    if (kind !== 'provision') throw new Error(`unexpected job kind: ${kind}`);

    switch (type) {
      case 'verify-tunnel': {
        if (!routerId) throw new Error('verify-tunnel requires routerId');
        await auditIt(opId, routerId, 'provision.verify-tunnel', 'pending');
        const info = await deps.routerInfo(routerId);
        // hub side: PPP session active?
        const hubConn = await deps.hub.ensure(deps.hubRouterId);
        const active = parsePppActive(await hubConn.talk(pppActiveList({ name: info.sstpUsername })));
        const sessionUp = active.some((a) => a.name === info.sstpUsername);
        // router side: uuid stamp present?
        const routerConn = await deps.manager.ensure(routerId);
        const { note } = parseSystemNote(await routerConn.talk(systemNotePrint()));
        const stamped = note?.includes(`panel-uuid:${info.uuid}`) ?? false;
        const ok = sessionUp && stamped;
        await auditIt(opId, routerId, 'provision.verify-tunnel', ok ? 'done' : 'failed', {
          after: { sessionUp, stamped },
        });
        if (ok) {
          await events.emit({
            event: 'router.online',
            payload: { routerId, uuid: info.uuid, tunnelIp: '', at: at() },
          });
        }
        return { type, routerId, ok };
      }

      case 'rotate-secrets': {
        if (!routerId) throw new Error('rotate-secrets requires routerId');
        if (!deps.secrets) throw new Error('secret provider not wired');
        await auditIt(opId, routerId, 'provision.rotate-secrets', 'pending');
        const info = await deps.routerInfo(routerId);
        guard(info.sstpUsername, 'rotate');
        const fresh = await deps.secrets.freshSecrets(routerId);
        // 1. router first, over the existing session: set the new API password
        const apiUser = await deps.manager.execute(routerId, async (conn) => {
          const rows = replyRows(await conn.talk(systemUserList({ name: 'panel-api' })));
          const id = rows[0]?.['.id'];
          if (!id) throw new Error('panel-api user not found on router');
          await conn.talk(systemUserSetPassword(id, fresh.apiPassword));
          return rows[0]?.['name'];
        });
        void apiUser;
        // 2. then the hub SSTP secret
        const secretId = await hubSecretId(info.sstpUsername);
        if (!secretId) throw new Error(`no ppp secret named ${info.sstpUsername} on the hub`);
        await deps.hub.execute(deps.hubRouterId, (conn) =>
          conn.talk(pppSecretSet(secretId, { password: fresh.sstpPassword })),
        );
        await auditIt(opId, routerId, 'provision.rotate-secrets', 'done', {
          after: { rotated: ['api-password', 'sstp-password'] },
        });
        return { type, routerId, ok: true };
      }

      case 'decommission': {
        if (!routerId) throw new Error('decommission requires routerId');
        await auditIt(opId, routerId, 'provision.decommission', 'pending');
        const info = await deps.routerInfo(routerId);
        guard(info.sstpUsername, 'delete');
        const secretId = await hubSecretId(info.sstpUsername);
        if (secretId) {
          await deps.hub.execute(deps.hubRouterId, (conn) =>
            conn.talk(pppSecretRemove(secretId)),
          );
        }
        await deps.markDecommissioned?.(routerId);
        await auditIt(opId, routerId, 'provision.decommission', 'done', {
          after: { hubSecretRemoved: !!secretId },
        });
        return { type, routerId, ok: true };
      }

      default:
        throw new Error(`unknown provision type: ${type as string}`);
    }
  };
}

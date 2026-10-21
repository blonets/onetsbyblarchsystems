import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  RosConnection,
  TcpTransport,
  pppSecretAdd,
  pppSecretList,
  pppSecretRemove,
  pppSecretSet,
  pppActiveList,
  pppActiveRemove,
  parsePppSecrets,
  parsePppActive,
  replyRows,
  type Transport,
} from '@mtk/ros-api';
import { newOpId, type OnboardCallback, type Router } from '@mtk/types';
import { AuditService } from '../audit/audit.service.js';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import { EventsService } from '../events/events.module.js';
import { JOBS_PORT, type JobsPort } from '../jobs/jobs.module.js';
import { VAULT_PORT, type VaultPort } from '../vault/vault.port.js';
import {
  allocateTunnelIp,
  generateRouterCredentials,
  issueOnboardingToken,
} from './credentials.js';
import { buildOnboardScript, buildSyncScript } from './onboard-rsc.js';

export interface ProvisioningConfig {
  /**
   * Hub address for SSTP dial-out and hub-side API — env `SSTP_HUB_HOST`.
   * Never a hardcoded IP in code.
   * Canonical: vpn.onetsbyblarch.online
   *   (DNS-based SSTP dialing proven live 2026-10-16.)
   * Underlying hub IP, for reference only: 34.91.70.17.
   */
  hubHost: string;
  hubPort: number;
  hubUsername: string;
  hubPassword: string;
  /** Hub-side PPP profile for site-router secrets (live: `sstp-profile`). */
  hubPppProfile: string;
  /** Public panel host used in the one-line fetch command + script callback. */
  panelHost: string;
}

export const PROVISIONING_CONFIG = Symbol('PROVISIONING_CONFIG');
export const ROS_TRANSPORT_FACTORY = Symbol('ROS_TRANSPORT_FACTORY');

/** Creates the transport ros-api talks to. Injected so tests can pass a fake. */
export type RosTransportFactory = (host: string, port: number) => Transport;

export const defaultTransportFactory: RosTransportFactory = (host, port) =>
  new TcpTransport({ host, port });

/** Prefix for throwaway hub secrets used by live tests. */
export const DISPOSABLE_SECRET_PREFIX = 'test-del-';
/** Hub secrets the platform must never touch. */
const PROTECTED_SECRETS = new Set(['sstp-test-01', 'sstp-hub', 'osama-vpn', 'vps-dokploy-tunnel']);

/** Onboarding token TTL: 15 minutes, single-use (ARCHITECTURE §6). */
const TOKEN_TTL_HOURS = 0.25;

/**
 * Provisioning: onboarding tokens, hub-side `/ppp secret` lifecycle, the
 * generated `onboard.rsc`, and the first-contact callback.
 *
 * The hub is platform infrastructure (like Postgres) — talking to it directly
 * from the API is intentional. Site routers are NEVER touched here; everything
 * device-side goes through the `provision` queue to the worker.
 *
 * SAFETY: this service only ever creates/deletes secrets whose names it
 * generated (`sstp-<hex>` at token issue, `test-del-<rand>` for live tests).
 * `sstp-test-01` and the hub SSTP server config are never modified.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    @Inject(PROVISIONING_CONFIG) private readonly config: ProvisioningConfig,
    @Inject(DB_PORT) private readonly db: DbPort,
    @Inject(VAULT_PORT) private readonly vault: VaultPort,
    @Inject(JOBS_PORT) private readonly jobs: JobsPort,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    @Optional() @Inject(ROS_TRANSPORT_FACTORY) private readonly transportFactory?: RosTransportFactory,
  ) {}

  private factory(): RosTransportFactory {
    return this.transportFactory ?? defaultTransportFactory;
  }

  // ------------------------------------------------------------------ hub ---

  /** Hub CHR endpoint descriptor for the worker's dedicated hub connection. */
  getHubEndpoint(): {
    routerId: string;
    uuid: string;
    host: string;
    apiPort: number;
    ftpPort: number;
    username: string;
    password: string;
    identity: string;
  } {
    return {
      routerId: 'hub',
      uuid: 'hub',
      host: this.config.hubHost,
      apiPort: this.config.hubPort,
      ftpPort: 8921,
      username: this.config.hubUsername,
      password: this.config.hubPassword,
      identity: 'sstp-hub',
    };
  }

  private async withHub<T>(fn: (conn: RosConnection) => Promise<T>): Promise<T> {
    const transport = this.factory()(this.config.hubHost, this.config.hubPort);
    const conn = new RosConnection(transport);
    try {
      await conn.connect();
      await conn.login(this.config.hubUsername, this.config.hubPassword);
      return await fn(conn);
    } finally {
      await conn.close().catch(() => undefined);
    }
  }

  private async createHubSecret(input: {
    name: string;
    password: string;
    tunnelIp: string;
    comment: string;
  }): Promise<void> {
    await this.withHub(async (conn) => {
      await conn.talk(
        pppSecretAdd({
          name: input.name,
          password: input.password,
          service: 'sstp',
          profile: this.config.hubPppProfile,
          remoteAddress: input.tunnelIp,
          comment: input.comment,
        }),
      );
    });
  }

  /** Delete a hub secret — refuses protected names and non-managed prefixes. */
  async deleteHubSecretByName(name: string): Promise<void> {
    if (PROTECTED_SECRETS.has(name)) {
      throw new Error(`refusing to delete protected hub secret ${name}`);
    }
    if (!name.startsWith('sstp-') && !name.startsWith(DISPOSABLE_SECRET_PREFIX)) {
      throw new Error(`refusing to delete hub secret with unmanaged name ${name}`);
    }
    await this.withHub(async (conn) => {
      // 1. Drop active PPP session if connected
      try {
        const active = parsePppActive(await conn.talk(pppActiveList({ name })));
        for (const a of active) {
          if (a.name === name) {
            await conn.talk(pppActiveRemove(a.id));
          }
        }
      } catch (err) {
        // active session drop is best-effort
      }

      // 2. Remove PPP secret
      try {
        const rows = parsePppSecrets(await conn.talk(pppSecretList({ name })));
        const secret = rows.find((r) => r.name === name);
        if (secret) {
          await conn.talk(pppSecretRemove(secret.id));
        }
      } catch (err) {
        console.warn(`[provisioning] could not remove hub secret ${name}:`, (err as Error).message);
      }
    });
  }

  /** Rotate the password of an existing hub secret (used by the worker flow). */
  async setHubSecretPassword(name: string, password: string): Promise<void> {
    if (PROTECTED_SECRETS.has(name)) {
      throw new Error(`refusing to modify protected hub secret ${name}`);
    }
    await this.withHub(async (conn) => {
      const rows = parsePppSecrets(await conn.talk(pppSecretList({ name })));
      const secret = rows.find((r) => r.name === name);
      if (!secret) throw new NotFoundException(`hub secret ${name} not found`);
      await conn.talk(pppSecretSet(secret.id, { password }));
    });
  }

  /**
   * Create a DISPOSABLE hub secret for live connectivity tests.
   * Name is always `test-del-<rand>`; the caller must delete it afterwards.
   */
  async createDisposableTestSecret(): Promise<{ name: string; tunnelIp: string }> {
    const name = `${DISPOSABLE_SECRET_PREFIX}${randomBytes(3).toString('hex')}`;
    const password = randomBytes(24).toString('base64url');
    const tunnelIp = await this.allocateFreeTunnelIp();
    await this.createHubSecret({ name, password, tunnelIp, comment: 'panel-disposable-test' });
    return { name, tunnelIp };
  }

  // --------------------------------------------------------------- tokens ---

  /**
   * Issue an onboarding token: mint credentials, allocate the tunnel IP,
   * vault the secrets, create the hub `/ppp secret`, persist the token.
   * The SSTP/API passwords are never returned — only the vault holds them.
   */
  async issueToken(
    input: { siteId?: string },
    actor: CurrentUserType,
  ): Promise<{
    token: string;
    expiresAt: string;
    sstpUsername: string;
    tunnelIp: string;
    fetchCommand: string;
    oneLineCommand: string;
  }> {
    let siteSlug = 'site';
    if (input.siteId) {
      const site = await this.db.sites.findUnique({ id: input.siteId });
      if (!site || site.deletedAt) throw new NotFoundException(`site ${input.siteId} not found`);
      siteSlug = site.slug;
    }

    const { username, password: sstpPassword } = generateRouterCredentials();
    const apiPassword = randomBytes(32).toString('base64url');
    const tunnelIp = await this.allocateFreeTunnelIp();

    const sstpPasswordRef = await this.vault.store(sstpPassword);
    const apiPasswordRef = await this.vault.store(apiPassword);
    try {
      await this.createHubSecret({
        name: username,
        password: sstpPassword,
        tunnelIp,
        comment: `panel-router:pending:${siteSlug}`,
      });
    } catch (err) {
      await this.vault.revoke(sstpPasswordRef).catch(() => undefined);
      await this.vault.revoke(apiPasswordRef).catch(() => undefined);
      throw err;
    }

    const issued = issueOnboardingToken(username, TOKEN_TTL_HOURS);
    const row = await this.db.onboardingTokens.create({
      token: issued.token,
      issuedById: actor.sub,
      siteId: input.siteId ?? null,
      sstpUsername: username,
      sstpPasswordRef,
      apiPasswordRef,
      tunnelIp,
      expiresAt: new Date(issued.expiresAt),
    });

    await this.audit.append({
      actorId: actor.sub,
      action: 'provisioning.token.issue',
      entityType: 'onboardingToken',
      entityId: row.id,
      after: { sstpUsername: username, tunnelIp, siteId: input.siteId ?? null },
      result: 'done',
    });

    const fetchCommand =
      `{ :local v [/system resource get version]; :local m [:pick $v 0 1]; ` +
      `/tool fetch mode=https url=("https://${this.config.panelHost}/api/v1/onboard/${issued.token}/onboard.rsc?v=" . $m) ` +
      `dst-path=onboard.rsc check-certificate=no; :delay 2s; /import onboard.rsc; }`;
    return {
      token: issued.token,
      expiresAt: issued.expiresAt,
      sstpUsername: username,
      tunnelIp,
      fetchCommand,
      oneLineCommand: fetchCommand,
    };
  }

  async listTokens(): Promise<
    { id: string; sstpUsername: string; tunnelIp: string; siteId: string | null; expiresAt: string; usedAt: string | null; routerId: string | null }[]
  > {
    const rows = await this.db.onboardingTokens.findMany({ orderBy: { expiresAt: 'desc' }, take: 200 });
    return rows.map((r) => ({
      id: r.id,
      sstpUsername: r.sstpUsername,
      tunnelIp: r.tunnelIp,
      siteId: r.siteId,
      expiresAt: r.expiresAt.toISOString(),
      usedAt: r.usedAt?.toISOString() ?? null,
      routerId: r.routerId,
    }));
  }

  /** Burn a token without onboarding (operator changed their mind / cleanup). */
  async revokeToken(id: string, actor: CurrentUserType): Promise<void> {
    const row = await this.db.onboardingTokens.findUnique({ id });
    if (!row) throw new NotFoundException(`token ${id} not found`);
    if (!row.usedAt) {
      await this.db.onboardingTokens.update({ id }, { usedAt: new Date() });
      // Best-effort hub cleanup; the secret name is one we generated.
      await this.deleteHubSecretByName(row.sstpUsername).catch(() => undefined);
      await this.vault.revoke(row.sstpPasswordRef).catch(() => undefined);
      await this.vault.revoke(row.apiPasswordRef).catch(() => undefined);
    }
    await this.audit.append({
      actorId: actor.sub,
      action: 'provisioning.token.revoke',
      entityType: 'onboardingToken',
      entityId: id,
      result: 'done',
    });
  }

  // ------------------------------------------------------- onboard flow ---

  /** Render the single-use `onboard.rsc` for a token (public, token is the auth). */
  async getOnboardScript(token: string, rosVersion?: string): Promise<string> {
    const row = await this.requireLiveToken(token);
    const sstpPassword = await this.vault.retrieve(row.sstpPasswordRef);
    const apiPassword = await this.vault.retrieve(row.apiPasswordRef);
    let siteSlug = 'site';
    if (row.siteId) {
      const site = await this.db.sites.findUnique({ id: row.siteId });
      if (site) siteSlug = site.slug;
    }
    // The UUID is minted now so the script can stamp it; the Router row is
    // created at callback time with the same value.
    const uuid = randomUUID();
    return buildOnboardScript({
      hubHost: this.config.hubHost,
      sstpUsername: row.sstpUsername,
      sstpPassword,
      apiPassword,
      uuid,
      siteSlug,
      panelHost: this.config.panelHost,
      token: row.token,
      callbackPath: `/api/v1/onboard/${row.token}/callback`,
      rosVersion,
    });
  }

  /** Render the periodic sync script for an existing router by UUID. */
  async getSyncScript(uuid: string, rosVersion?: string): Promise<string> {
    const router = await this.db.routers.findFirst({ uuid });
    if (!router) {
      return `# router not found (uuid=${uuid})\n`;
    }
    await this.db.routers.update({ id: router.id }, { lastSeen: new Date(), status: 'online' });
    return buildSyncScript({
      uuid: router.uuid,
      panelHost: this.config.panelHost,
      hubHost: this.config.hubHost,
      rosVersion,
    });
  }

  /**
   * First-contact callback from the router. Burns the token, creates the
   * Router row (status online), emits `router.online`, enqueues tunnel
   * verification. Idempotent per token: retries return the existing router.
   */
  async handleCallback(token: string, body: OnboardCallback): Promise<{ routerId: string }> {
    const existing = await this.db.onboardingTokens.findUnique({ token });
    if (!existing) throw new NotFoundException('unknown or burned token');
    if (existing.usedAt && existing.routerId) {
      return { routerId: existing.routerId }; // duplicate callback — idempotent
    }
    const row = await this.requireLiveToken(token);

    const opId = newOpId();
    const routerRow = await this.db.routers.create({
      uuid: body.uuid,
      siteId: row.siteId,
      tunnelIp: row.tunnelIp,
      sstpUsername: row.sstpUsername,
      sstpPasswordRef: row.sstpPasswordRef,
      apiPasswordRef: row.apiPasswordRef,
      routerOsVersion: body.version ?? null,
      boardName: body.board ?? null,
      serialNumber: body.serial ?? null,
      status: 'online',
    });
    await this.db.routers.update({ id: routerRow.id }, { lastSeen: new Date() });
    await this.db.onboardingTokens.update({ id: row.id }, { usedAt: new Date(), routerId: routerRow.id });

    // Stamp the identity now that we know the site (best-effort; the worker
    // reconciles it during verify-tunnel).
    if (row.siteId) {
      const site = await this.db.sites.findUnique({ id: row.siteId });
      if (site) {
        await this.db.routers.update({ id: routerRow.id }, { identityName: site.slug });
      }
    }

    const at = new Date().toISOString();
    this.events.emitEvent('router.online', {
      routerId: routerRow.id,
      uuid: routerRow.uuid,
      tunnelIp: routerRow.tunnelIp,
      at,
    });

    await this.jobs.add(
      'provision',
      'verify-tunnel',
      { kind: 'provision', type: 'verify-tunnel', opId, routerId: routerRow.id, tokenId: row.id },
      { jobId: opId },
    );

    await this.audit.append({
      routerId: routerRow.id,
      action: 'provisioning.callback',
      entityType: 'router',
      entityId: routerRow.id,
      opId,
      after: { uuid: body.uuid, version: body.version, board: body.board },
      result: 'done',
    });

    return { routerId: routerRow.id };
  }

  // ------------------------------------------------------------- rotation ---

  /**
   * Enqueue a secret rotation for a router (admin only at the controller).
   * The worker performs the atomic-ish sequence: write new creds to the
   * router over the existing session first, then update the hub secret and
   * the DB refs; old creds stay valid for one cycle as fallback.
   */
  async rotateSecrets(routerId: string, actor: CurrentUserType): Promise<{ opId: string }> {
    const router = await this.db.routers.findUnique({ id: routerId });
    if (!router) throw new NotFoundException(`router ${routerId} not found`);
    const opId = newOpId();
    await this.jobs.add(
      'provision',
      'rotate-secrets',
      { kind: 'provision', type: 'rotate-secrets', opId, routerId, sstpUsername: router.sstpUsername, tunnelIp: router.tunnelIp },
      { jobId: opId },
    );
    await this.audit.append({
      actorId: actor.sub,
      routerId,
      action: 'provisioning.secrets.rotate',
      entityType: 'router',
      entityId: routerId,
      opId,
      result: 'pending',
    });
    return { opId };
  }

  // -------------------------------------------------- worker internal ---

  /**
   * Worker rotate-secrets path (internal endpoint): mint fresh SSTP + API
   * passwords for a router, vault them, swap the router row's refs, and
   * return the plaintext exactly once — the worker applies it on the router
   * (panel-api user) and on the hub `/ppp secret` over its existing
   * sessions. The superseded vault refs are deliberately left in place:
   * nothing else in the platform revokes rotated-out refs, and the old
   * values become unreachable the moment the row points at the new refs.
   */
  async generateFreshSecrets(
    routerId: string,
  ): Promise<{ sstpPassword: string; apiPassword: string }> {
    const router = await this.db.routers.findUnique({ id: routerId });
    if (!router) throw new NotFoundException(`router ${routerId} not found`);
    const sstpPassword = generateRouterCredentials().password;
    const apiPassword = randomBytes(32).toString('base64url');
    const sstpPasswordRef = await this.vault.store(sstpPassword);
    const apiPasswordRef = await this.vault.store(apiPassword);
    try {
      await this.db.routers.update({ id: routerId }, { sstpPasswordRef, apiPasswordRef });
    } catch (err) {
      await this.vault.revoke(sstpPasswordRef).catch(() => undefined);
      await this.vault.revoke(apiPasswordRef).catch(() => undefined);
      throw err;
    }
    await this.audit.append({
      routerId,
      action: 'provisioning.secrets.fresh',
      entityType: 'router',
      entityId: routerId,
      opId: newOpId(),
      result: 'done',
    });
    return { sstpPassword, apiPassword };
  }

  // ------------------------------------------------------------------ util ---

  private async requireLiveToken(token: string) {
    const row = await this.db.onboardingTokens.findUnique({ token });
    if (!row) throw new NotFoundException('unknown or burned token');
    if (row.usedAt) throw new NotFoundException('unknown or burned token');
    if (row.expiresAt.getTime() < Date.now()) throw new NotFoundException('unknown or burned token');
    return row;
  }

  private async allocateFreeTunnelIp(): Promise<string> {
    const used = new Set<string>();
    used.add('10.200.0.1');
    used.add('10.200.255.254');
    for (const r of await this.db.routers.findMany({})) {
      if (r.tunnelIp) used.add(r.tunnelIp);
    }
    const now = Date.now();
    for (const t of await this.db.onboardingTokens.findMany({})) {
      if (!t.usedAt && t.expiresAt.getTime() > now) used.add(t.tunnelIp);
    }
    return allocateTunnelIp(used);
  }

  /**
   * Reconcile secrets on the Hub against active routers and live onboarding tokens.
   * Removes orphaned `sstp-*` secrets that are no longer referenced in the platform.
   */
  async reconcileHubSecrets(): Promise<{
    totalHubSecrets: number;
    keptCount: number;
    removedCount: number;
    removedSecrets: string[];
  }> {
    const activeRouters = await this.db.routers.findMany({});
    const activeUsernames = new Set(
      activeRouters.filter((r) => r.status !== 'decommissioned').map((r) => r.sstpUsername),
    );
    const now = Date.now();
    const liveTokens = await this.db.onboardingTokens.findMany({});
    for (const t of liveTokens) {
      if (!t.usedAt && t.expiresAt.getTime() > now) {
        activeUsernames.add(t.sstpUsername);
      }
    }

    const removedSecrets: string[] = [];
    let totalHubSecrets = 0;
    let keptCount = 0;

    await this.withHub(async (conn) => {
      const secrets = parsePppSecrets(await conn.talk(pppSecretList()));
      totalHubSecrets = secrets.length;
      for (const secret of secrets) {
        if (PROTECTED_SECRETS.has(secret.name)) {
          keptCount++;
          continue;
        }
        if (secret.name.startsWith('sstp-') || secret.name.startsWith(DISPOSABLE_SECRET_PREFIX)) {
          if (!activeUsernames.has(secret.name)) {
            try {
              // Also drop any stale active session for this username
              const active = parsePppActive(await conn.talk(pppActiveList({ name: secret.name })));
              for (const a of active) {
                if (a.name === secret.name) {
                  await conn.talk(pppActiveRemove(a.id));
                }
              }
              await conn.talk(pppSecretRemove(secret.id));
              removedSecrets.push(secret.name);
            } catch (err) {
              console.warn(`[reconcileHub] failed to remove secret ${secret.name}:`, err);
            }
          } else {
            keptCount++;
          }
        } else {
          keptCount++;
        }
      }
    });

    return {
      totalHubSecrets,
      keptCount,
      removedCount: removedSecrets.length,
      removedSecrets,
    };
  }

  /**
   * Direct IP / manual router onboarding (outside the SSTP tunnel wizard).
   * Verifies connectivity, stamps identity/UUID, vaults credentials, and stores row.
   */
  async provisionDirect(
    input: {
      host: string;
      apiPort?: number;
      username: string;
      password: string;
      siteId?: string;
      identityName?: string;
      tags?: string[];
    },
    actor: CurrentUserType,
  ): Promise<Router> {
    const port = input.apiPort ?? 8728;
    const factory = this.factory();
    const transport = factory(input.host, port);
    const conn = new RosConnection(transport);

    try {
      await conn.connect();
      await conn.login(input.username, input.password);
    } catch (err) {
      await conn.close().catch(() => undefined);
      throw new Error(`Failed to connect to router at ${input.host}:${port}: ${(err as Error).message}`);
    }

    let version: string | undefined;
    let board: string | undefined;
    let serial: string | undefined;
    let identity: string | undefined;

    try {
      const res = replyRows(await conn.talk(['/system/resource/print']));
      if (res[0]) {
        version = res[0]['version'];
        board = res[0]['board-name'];
      }
      const rb = replyRows(await conn.talk(['/system/routerboard/print']));
      if (rb[0]) {
        serial = rb[0]['serial-number'];
      }
      const idRes = replyRows(await conn.talk(['/system/identity/print']));
      if (idRes[0]) {
        identity = idRes[0]['name'];
      }
    } catch {}

    const uuid = randomUUID();
    // Stamp the uuid on the router
    try {
      await conn.talk(['/system/note/set', `=note=panel-uuid=${uuid}`]);
    } catch {}

    await conn.close().catch(() => undefined);

    // Vault the passwords
    const apiPasswordRef = await this.vault.store(input.password);
    const sstpPasswordRef = await this.vault.store(randomBytes(24).toString('base64url'));

    const routerRow = await this.db.routers.create({
      uuid,
      siteId: input.siteId ?? null,
      tunnelIp: input.host,
      sstpUsername: `direct-${randomBytes(4).toString('hex')}`,
      sstpPasswordRef,
      apiUsername: input.username,
      apiPasswordRef,
      apiPort: port,
      identityName: input.identityName ?? identity ?? 'router-direct',
      boardName: board ?? null,
      routerOsVersion: version ?? null,
      serialNumber: serial ?? null,
      status: 'online',
      tags: input.tags ?? [],
    });

    await this.db.routers.update({ id: routerRow.id }, { lastSeen: new Date() });

    this.events.emitEvent('router.online', {
      routerId: routerRow.id,
      uuid: routerRow.uuid,
      tunnelIp: routerRow.tunnelIp,
      at: new Date().toISOString(),
    });

    await this.audit.append({
      actorId: actor.sub,
      routerId: routerRow.id,
      action: 'provisioning.direct',
      entityType: 'router',
      entityId: routerRow.id,
      after: { uuid, tunnelIp: input.host, version, board },
      result: 'done',
    });

    return {
      id: routerRow.id,
      uuid: routerRow.uuid,
      siteId: routerRow.siteId,
      tunnelIp: routerRow.tunnelIp,
      sstpUsername: routerRow.sstpUsername,
      apiUsername: routerRow.apiUsername,
      apiPort: routerRow.apiPort,
      apiSslPort: routerRow.apiSslPort,
      winboxPort: routerRow.winboxPort,
      sshPort: routerRow.sshPort,
      telnetPort: routerRow.telnetPort,
      ftpPort: routerRow.ftpPort,
      wwwPort: routerRow.wwwPort,
      status: routerRow.status,
      lastSeen: routerRow.lastSeen?.toISOString() ?? null,
      routerOsVersion: routerRow.routerOsVersion,
      boardName: routerRow.boardName,
      serialNumber: routerRow.serialNumber,
      identityName: routerRow.identityName,
      tags: routerRow.tags ?? [],
      flapCount: routerRow.flapCount,
      pollerShard: routerRow.pollerShard,
      createdAt: routerRow.createdAt.toISOString(),
      updatedAt: routerRow.updatedAt.toISOString(),
      decommissionedAt: routerRow.decommissionedAt?.toISOString() ?? null,
    };
  }
}

/** Builds the NestJS provider values for ProvisioningService from env config. */
export function provisioningProviders() {
  return [
    {
      provide: PROVISIONING_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ProvisioningConfig => ({
        hubHost: config.getOrThrow<string>('SSTP_HUB_HOST'),
        hubPort: Number(config.get('SSTP_HUB_API_PORT') ?? 8728),
        hubUsername: config.getOrThrow<string>('SSTP_HUB_API_USER'),
        hubPassword: config.getOrThrow<string>('SSTP_HUB_API_PASSWORD'),
        // Live-validated 2026-10-16: the hub CHR uses profile `sstp-profile`.
        hubPppProfile: config.get('SSTP_HUB_PPP_PROFILE') ?? 'sstp-profile',
        panelHost: config.getOrThrow<string>('PANEL_PUBLIC_HOST'),
      }),
    },
    { provide: ROS_TRANSPORT_FACTORY, useValue: defaultTransportFactory },
    ProvisioningService,
  ];
}

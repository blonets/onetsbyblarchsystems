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
  parsePppSecrets,
  type Transport,
} from '@mtk/ros-api';
import { newOpId, type OnboardCallback } from '@mtk/types';
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
import { buildOnboardScript } from './onboard-rsc.js';

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
const PROTECTED_SECRETS = new Set(['sstp-test-01']);

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
      const rows = parsePppSecrets(await conn.talk(pppSecretList({ name })));
      const secret = rows.find((r) => r.name === name);
      if (!secret) throw new NotFoundException(`hub secret ${name} not found`);
      await conn.talk(pppSecretRemove(secret.id));
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
      `/tool fetch mode=https address=${this.config.panelHost} ` +
      `src-path=/api/v1/onboard/${issued.token}/onboard.rsc dst-path=onboard.rsc; /import onboard.rsc`;
    return {
      token: issued.token,
      expiresAt: issued.expiresAt,
      sstpUsername: username,
      tunnelIp,
      fetchCommand,
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
  async getOnboardScript(token: string): Promise<string> {
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
    for (const r of await this.db.routers.findMany({})) used.add(r.tunnelIp);
    const now = Date.now();
    for (const t of await this.db.onboardingTokens.findMany({})) {
      if (!t.usedAt && t.expiresAt.getTime() > now) used.add(t.tunnelIp);
    }
    return allocateTunnelIp(used);
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

import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  hotspotProfileAdd,
  hotspotProfileDisable,
  hotspotProfileEnable,
  hotspotProfileRemove,
  hotspotProfileSet,
  hotspotServerAdd,
  hotspotServerDisable,
  hotspotServerEnable,
  hotspotServerProfileAdd,
  hotspotServerProfileRemove,
  hotspotServerProfileSet,
  hotspotServerRemove,
  hotspotServerSet,
  hotspotUserAdd,
  hotspotUserDisable,
  hotspotUserEnable,
  hotspotUserRemove,
  hotspotUserSet,
  walledGardenAdd,
  walledGardenDisable,
  walledGardenEnable,
  walledGardenIpAdd,
  walledGardenIpDisable,
  walledGardenIpEnable,
  walledGardenIpRemove,
  walledGardenIpSet,
  walledGardenRemove,
  walledGardenSet,
} from '@mtk/ros-api';
import {
  newOpId,
  type HotspotExpiryMode,
  type HotspotProfile,
  type HotspotServer,
  type HotspotUser,
  type HotspotUserProfile,
  type Paginated,
  type StaleHotspotSession,
} from '@mtk/types';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import type {
  HotspotProfileRow,
  HotspotServerRow,
  HotspotUserProfileRow,
  HotspotUserRow,
  HotspotWalledGardenRow,
} from '../db/rows.js';
import { RouterCommandsService, type EnqueuedCommand } from '../commands/commands.service.js';
import { VAULT_PORT, type VaultPort } from '../vault/vault.port.js';
import type {
  CreateHotspotServerDto,
  CreateHotspotUserDto,
  CreateServerProfileDto,
  CreateUserProfileDto,
  CreateWalledGardenDto,
  UpdateHotspotServerDto,
  UpdateHotspotUserDto,
  UpdateServerProfileDto,
  UpdateUserProfileDto,
  UpdateWalledGardenDto,
} from './dto/hotspot.dto.js';

/**
 * MAC-lock helpers.
 *
 * RouterOS has NO native user↔MAC pin on /ip/hotspot/user, so a "MAC lock" is
 * a platform-side construct:
 *  1. the MAC is stored on the user/profile row (source of truth);
 *  2. a visible `/ip/hotspot/ip-binding` entry (type=regular) is created so
 *     the lock shows up on-device and in audits;
 *  3. real enforcement happens in the worker: `findStaleSessions()` flags
 *     sessions whose MAC differs from the pinned MAC, and the enforcer acts
 *     on the flag (disable / notify per expiryMode).
 *
 * NOTE: @mtk/ros-api has no ip-binding builder yet (out of scope for this
 * change) — these two inline sentences MUST move there when it gains one.
 */
function ipBindingAddSentence(mac: string, username: string): string[] {
  return [
    '/ip/hotspot/ip-binding/add',
    '=type=regular',
    `=mac-address=${mac}`,
    '=server=all',
    `=comment=panel-maclock:${username}`,
  ];
}

/** Normalize a MAC for comparison (case/separator-insensitive). */
export function normalizeMac(mac: string): string {
  return mac.trim().toUpperCase().replace(/[^0-9A-F]/g, '');
}

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

function validateMac(mac: string, what: string): string {
  if (!MAC_RE.test(mac.trim())) {
    throw new UnprocessableEntityException(`${what} must look like AA:BB:CC:DD:EE:FF, got "${mac}"`);
  }
  return normalizeMac(mac).replace(/(..)(?=..)/g, '$1:');
}

/** Which expiry clock fired for a user, if any. Pure — unit-testable. */
export interface UserExpiry {
  /** Absolute `expiresAt` clock. */
  absolute: Date | null;
  /** First-login validity clock (`firstLoginAt + validitySeconds`). */
  validity: Date | null;
  /** The clock that already passed (earliest), or null when not expired. */
  expiredAt: Date | null;
  expiryKind: 'absolute' | 'validity' | null;
}

export function computeUserExpiry(u: {
  expiresAt: Date | null;
  validityFromFirstLogin: boolean;
  validitySeconds: number | null;
  firstLoginAt: Date | null;
}, now: Date = new Date()): UserExpiry {
  const absolute = u.expiresAt;
  const validity =
    u.validityFromFirstLogin && u.validitySeconds && u.firstLoginAt
      ? new Date(u.firstLoginAt.getTime() + u.validitySeconds * 1000)
      : null;
  const passed: Array<{ at: Date; kind: 'absolute' | 'validity' }> = [];
  if (absolute && absolute <= now) passed.push({ at: absolute, kind: 'absolute' });
  if (validity && validity <= now) passed.push({ at: validity, kind: 'validity' });
  passed.sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = passed[0];
  return {
    absolute,
    validity,
    expiredAt: first?.at ?? null,
    expiryKind: first?.kind ?? null,
  };
}

/**
 * Hotspot v1 — full CRUD for servers, server-profiles, user-profiles (plans),
 * users and walled-garden entries.
 *
 * Every mutation: write the platform mirror row → enqueue typed ros-api
 * sentences to the `commands` queue (the API never dials the router) →
 * worker executes → result settles the audit + reconciles `mikrotikId`.
 *
 * User passwords: stored in the Vault (DB keeps only `passwordRef`); the
 * plaintext travels transiently inside the queued job sentences. Audit
 * snapshots record only `passwordSet: true` — never the secret.
 */
@Injectable()
export class HotspotService {
  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    @Inject(VAULT_PORT) private readonly vault: VaultPort,
    private readonly commands: RouterCommandsService,
  ) {}

  // ------------------------------------------------------------------ util --

  private async routerOrThrow(routerId: string): Promise<void> {
    await this.commands.requireRouter(routerId);
  }

  /** Device-side id required for any set/remove/enable/disable. */
  private needDeviceId(row: { mikrotikId: string | null }, what: string): string {
    if (!row.mikrotikId) {
      throw new UnprocessableEntityException(
        `${what} has no device id yet — wait for the add command to complete (or re-run reconciliation) before mutating it`,
      );
    }
    return row.mikrotikId;
  }

  private async mutate(
    routerId: string,
    action: string,
    sentences: string[][],
    opts: {
      actor?: CurrentUserType;
      opId?: string;
      before?: unknown;
      after?: unknown;
      entity?: { table: string; id: string };
    } = {},
  ): Promise<EnqueuedCommand> {
    return this.commands.enqueueRos({
      routerId,
      action,
      sentences,
      opId: opts.opId,
      actorId: opts.actor?.sub,
      before: opts.before,
      after: opts.after,
      entity: opts.entity,
    });
  }

  // ---------------------------------------------------------------- servers --

  async listServers(routerId: string): Promise<HotspotServer[]> {
    await this.routerOrThrow(routerId);
    const rows = await this.db.hotspotServers.findMany({ where: { routerId }, orderBy: { name: 'asc' } });
    return rows.map(toServerDto);
  }

  async createServer(routerId: string, dto: CreateHotspotServerDto, actor?: CurrentUserType) {
    await this.routerOrThrow(routerId);
    const dupe = await this.db.hotspotServers.findFirst({ routerId, name: dto.name });
    if (dupe) throw new UnprocessableEntityException(`hotspot server "${dto.name}" already exists`);
    const row = await this.db.hotspotServers.create({
      routerId,
      name: dto.name,
      interface: dto.interface,
      addressPool: dto.addressPool ?? null,
      profile: dto.profile,
      disabled: dto.disabled ?? false,
    });
    const enq = await this.mutate(routerId, 'hotspot.server.create', [
      hotspotServerAdd({
        name: dto.name,
        interface: dto.interface,
        addressPool: dto.addressPool,
        profile: dto.profile,
        disabled: dto.disabled,
      }),
    ], { actor, opId: dto.opId, after: { name: dto.name }, entity: { table: 'hotspot-server', id: row.id } });
    return { server: toServerDto(row), ...enq };
  }

  async updateServer(routerId: string, id: string, dto: UpdateHotspotServerDto, actor?: CurrentUserType) {
    const row = await this.serverOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row, 'hotspot server');
    const updated = await this.db.hotspotServers.update(
      { id },
      Object.fromEntries(Object.entries({
        interface: dto.interface,
        addressPool: dto.addressPool ?? undefined,
        profile: dto.profile,
        disabled: dto.disabled,
      }).filter(([, v]) => v !== undefined)),
    );
    const enq = await this.mutate(routerId, 'hotspot.server.update', [
      hotspotServerSet(deviceId, { interface: dto.interface, addressPool: dto.addressPool, profile: dto.profile, disabled: dto.disabled }),
    ], { actor, opId: dto.opId, before: row, entity: { table: 'hotspot-server', id } });
    return { server: toServerDto(updated), ...enq };
  }

  async deleteServer(routerId: string, id: string, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.serverOrThrow(routerId, id);
    await this.db.hotspotServers.delete({ id });
    if (!row.mikrotikId) {
      return { opId: opId ?? newOpId(), auditId: '', jobId: '', replayed: false };
    }
    const enq = await this.mutate(routerId, 'hotspot.server.delete', [
      hotspotServerRemove(row.mikrotikId),
    ], { actor, opId, before: row });
    return enq;
  }

  async setServerDisabled(routerId: string, id: string, disabled: boolean, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.serverOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row, 'hotspot server');
    const updated = await this.db.hotspotServers.update({ id }, { disabled });
    const enq = await this.mutate(
      routerId,
      disabled ? 'hotspot.server.disable' : 'hotspot.server.enable',
      [disabled ? hotspotServerDisable(deviceId) : hotspotServerEnable(deviceId)],
      { actor, opId, before: { disabled: row.disabled }, entity: { table: 'hotspot', id } },
    );
    return { server: toServerDto(updated), ...enq };
  }

  private async serverOrThrow(routerId: string, id: string): Promise<HotspotServerRow> {
    await this.routerOrThrow(routerId);
    const row = await this.db.hotspotServers.findUnique({ id });
    if (!row || row.routerId !== routerId) throw new NotFoundException(`hotspot server ${id} not found`);
    return row;
  }

  // --------------------------------------------------------- server profiles --

  async listServerProfiles(routerId: string): Promise<HotspotProfile[]> {
    await this.routerOrThrow(routerId);
    const rows = await this.db.hotspotProfiles.findMany({ where: { routerId }, orderBy: { name: 'asc' } });
    return rows.map(toProfileDto);
  }

  async createServerProfile(routerId: string, dto: CreateServerProfileDto, actor?: CurrentUserType) {
    await this.routerOrThrow(routerId);
    const dupe = await this.db.hotspotProfiles.findFirst({ routerId, name: dto.name });
    if (dupe) throw new UnprocessableEntityException(`server profile "${dto.name}" already exists`);
    const row = await this.db.hotspotProfiles.create({
      routerId,
      name: dto.name,
      hotspotAddress: dto.hotspotAddress ?? null,
      dnsName: dto.dnsName ?? null,
      loginBy: dto.loginBy ?? null,
    });
    const enq = await this.mutate(routerId, 'hotspot.server-profile.create', [
      hotspotServerProfileAdd({
        name: dto.name,
        hotspotAddress: dto.hotspotAddress,
        dnsName: dto.dnsName,
        loginBy: dto.loginBy,
      }),
    ], { actor, opId: dto.opId, after: { name: dto.name }, entity: { table: 'hotspot-profile', id: row.id } });
    return { profile: toProfileDto(row), ...enq };
  }

  async updateServerProfile(routerId: string, id: string, dto: UpdateServerProfileDto, actor?: CurrentUserType) {
    const row = await this.serverProfileOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row, 'server profile');
    const updated = await this.db.hotspotProfiles.update(
      { id },
      Object.fromEntries(Object.entries({
        hotspotAddress: dto.hotspotAddress ?? undefined,
        dnsName: dto.dnsName ?? undefined,
        loginBy: dto.loginBy,
      }).filter(([, v]) => v !== undefined)),
    );
    const enq = await this.mutate(routerId, 'hotspot.server-profile.update', [
      hotspotServerProfileSet(deviceId, {
        hotspotAddress: dto.hotspotAddress,
        dnsName: dto.dnsName,
        loginBy: dto.loginBy,
      }),
    ], { actor, opId: dto.opId, before: row, entity: { table: 'hotspot-profile', id } });
    return { profile: toProfileDto(updated), ...enq };
  }

  async deleteServerProfile(routerId: string, id: string, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.serverProfileOrThrow(routerId, id);
    await this.db.hotspotProfiles.delete({ id });
    if (!row.mikrotikId) {
      return { opId: opId ?? newOpId(), auditId: '', jobId: '', replayed: false };
    }
    const enq = await this.mutate(routerId, 'hotspot.server-profile.delete', [
      hotspotServerProfileRemove(row.mikrotikId),
    ], { actor, opId, before: row });
    return enq;
  }

  private async serverProfileOrThrow(routerId: string, id: string): Promise<HotspotProfileRow> {
    await this.routerOrThrow(routerId);
    const row = await this.db.hotspotProfiles.findUnique({ id });
    if (!row || row.routerId !== routerId) throw new NotFoundException(`server profile ${id} not found`);
    return row;
  }

  // ----------------------------------------------------------- user profiles --

  async listUserProfiles(routerId: string): Promise<HotspotUserProfile[]> {
    await this.routerOrThrow(routerId);
    const rows = await this.db.hotspotUserProfiles.findMany({ where: { routerId }, orderBy: { name: 'asc' } });
    return rows.map(toUserProfileDto);
  }

  async createUserProfile(routerId: string, dto: CreateUserProfileDto, actor?: CurrentUserType) {
    await this.routerOrThrow(routerId);
    const dupe = await this.db.hotspotUserProfiles.findFirst({ routerId, name: dto.name });
    if (dupe) throw new UnprocessableEntityException(`user profile "${dto.name}" already exists`);
    const macAddress = dto.macAddress !== undefined ? validateMac(dto.macAddress, 'macAddress') : null;
    const row = await this.db.hotspotUserProfiles.create({
      routerId,
      name: dto.name,
      rateLimit: dto.rateLimit ?? null,
      sharedUsers: dto.sharedUsers ?? null,
      sessionTimeout: dto.sessionTimeout ?? null,
      idleTimeout: dto.idleTimeout ?? null,
      keepaliveTimeout: dto.keepaliveTimeout ?? null,
      quotaBytes: dto.quotaBytes !== undefined ? BigInt(dto.quotaBytes) : null,
      quotaSeconds: dto.quotaSeconds ?? null,
      macAddress,
      limitUptime: dto.limitUptime ?? null,
      validitySeconds: dto.validitySeconds ?? null,
      price: dto.price ?? null,
      expiryMode: dto.expiryMode ?? 'none',
    });
    const enq = await this.mutate(routerId, 'hotspot.user-profile.create', [
      hotspotProfileAdd({
        name: dto.name,
        rateLimit: dto.rateLimit,
        sessionTimeout: dto.sessionTimeout,
        idleTimeout: dto.idleTimeout,
        sharedUsers: dto.sharedUsers,
      }),
    ], { actor, opId: dto.opId, after: { name: dto.name }, entity: { table: 'hotspot-user-profile', id: row.id } });
    return { profile: toUserProfileDto(row), ...enq };
  }

  async updateUserProfile(routerId: string, id: string, dto: UpdateUserProfileDto, actor?: CurrentUserType) {
    const row = await this.userProfileOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row, 'user profile');
    const updated = await this.db.hotspotUserProfiles.update(
      { id },
      Object.fromEntries(Object.entries({
        rateLimit: dto.rateLimit,
        sharedUsers: dto.sharedUsers,
        sessionTimeout: dto.sessionTimeout,
        idleTimeout: dto.idleTimeout,
        keepaliveTimeout: dto.keepaliveTimeout,
        quotaBytes: dto.quotaBytes !== undefined ? BigInt(dto.quotaBytes) : undefined,
        quotaSeconds: dto.quotaSeconds,
        macAddress: dto.macAddress !== undefined
          ? (dto.macAddress ? validateMac(dto.macAddress, 'macAddress') : null)
          : undefined,
        limitUptime: dto.limitUptime,
        validitySeconds: dto.validitySeconds,
        price: dto.price,
        expiryMode: dto.expiryMode,
      }).filter(([, v]) => v !== undefined)),
    );
    const enq = await this.mutate(routerId, 'hotspot.user-profile.update', [
      hotspotProfileSet(deviceId, {
        rateLimit: dto.rateLimit,
        sessionTimeout: dto.sessionTimeout,
        idleTimeout: dto.idleTimeout,
        sharedUsers: dto.sharedUsers,
      }),
    ], { actor, opId: dto.opId, before: row, entity: { table: 'hotspot-user-profile', id } });
    return { profile: toUserProfileDto(updated), ...enq };
  }

  async deleteUserProfile(routerId: string, id: string, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.userProfileOrThrow(routerId, id);
    await this.db.hotspotUserProfiles.delete({ id });
    if (!row.mikrotikId) {
      return { opId: opId ?? newOpId(), auditId: '', jobId: '', replayed: false };
    }
    const enq = await this.mutate(routerId, 'hotspot.user-profile.delete', [
      hotspotProfileRemove(row.mikrotikId),
    ], { actor, opId, before: row });
    return enq;
  }

  async setUserProfileDisabled(routerId: string, id: string, disabled: boolean, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.userProfileOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row, 'user profile');
    const enq = await this.mutate(
      routerId,
      disabled ? 'hotspot.user-profile.disable' : 'hotspot.user-profile.enable',
      [disabled ? hotspotProfileDisable(deviceId) : hotspotProfileEnable(deviceId)],
      { actor, opId, entity: { table: 'hotspot', id } },
    );
    return enq;
  }

  private async userProfileOrThrow(routerId: string, id: string): Promise<HotspotUserProfileRow> {
    await this.routerOrThrow(routerId);
    const row = await this.db.hotspotUserProfiles.findUnique({ id });
    if (!row || row.routerId !== routerId) throw new NotFoundException(`user profile ${id} not found`);
    return row;
  }

  // ------------------------------------------------------------------- users --

  async listUsers(routerId: string, opts: { page?: number; pageSize?: number; disabled?: boolean; mode?: string; batchId?: string } = {}): Promise<Paginated<HotspotUser>> {
    await this.routerOrThrow(routerId);
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 50, 500);
    const where: Record<string, unknown> = { routerId };
    if (opts.disabled !== undefined) where.disabled = opts.disabled;
    if (opts.mode) where.mode = opts.mode;
    if (opts.batchId) where.batchId = opts.batchId;
    const total = await this.db.hotspotUsers.count(where);
    const rows = await this.db.hotspotUsers.findMany({
      where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize,
    });
    const profiles = new Map(
      (await this.db.hotspotUserProfiles.findMany({ where: { routerId } })).map((p) => [p.id, p.name]),
    );
    return {
      items: rows.map((r) => toUserDto(r, profiles.get(r.profileId ?? '') ?? null)),
      total, page, pageSize,
    };
  }

  /**
   * Worker sweep input: EVERY hotspot user on the router (unpaginated),
   * including all expiry fields (`expiryMode`, `expiresAt`,
   * `validityFromFirstLogin`, `validitySeconds`, `firstLoginAt`).
   * Served at GET /internal/worker/routers/:id/hotspot-users.
   * Unknown router → NotFoundException (the sweep treats 404 as empty).
   */
  async listUsersInternal(routerId: string): Promise<HotspotUser[]> {
    await this.routerOrThrow(routerId);
    const rows = await this.db.hotspotUsers.findMany({
      where: { routerId },
      orderBy: { name: 'asc' },
    });
    const profiles = new Map(
      (await this.db.hotspotUserProfiles.findMany({ where: { routerId } })).map((p) => [p.id, p.name]),
    );
    return rows.map((r) => toUserDto(r, profiles.get(r.profileId ?? '') ?? null));
  }

  async createUser(routerId: string, dto: CreateHotspotUserDto, actor?: CurrentUserType) {
    await this.routerOrThrow(routerId);
    const dupe = await this.db.hotspotUsers.findFirst({ routerId, name: dto.name });
    if (dupe) throw new UnprocessableEntityException(`hotspot user "${dto.name}" already exists`);

    let passwordRef: string | null = null;
    if (dto.password) passwordRef = await this.vault.store(dto.password);

    const profile = await this.resolveProfileRow(routerId, dto.profileId, dto.profileName);
    const profileName = profile?.name ?? dto.profileName ?? null;
    // Explicit per-field inheritance: dto wins, profile fills gaps, so the
    // validity clock and the session cap never get conflated.
    const macAddress = dto.macAddress !== undefined
      ? validateMac(dto.macAddress, 'macAddress')
      : profile?.macAddress ?? null;
    const limitUptime = dto.limitUptime ?? profile?.limitUptime ?? undefined;
    const validitySeconds = dto.validitySeconds ?? profile?.validitySeconds ?? null;
    const validityFromFirstLogin = dto.validityFromFirstLogin ?? false;
    const expiryMode = dto.expiryMode ?? (profile?.expiryMode as HotspotExpiryMode | undefined) ?? 'none';

    const row = await this.db.hotspotUsers.create({
      routerId,
      name: dto.name,
      passwordRef,
      profileId: dto.profileId ?? null,
      mode: null,
      batchId: null,
      validityFromFirstLogin,
      validitySeconds,
      limitUptime: limitUptime ?? null,
      macAddress,
      expiryMode,
      disabled: dto.disabled ?? false,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      comment: dto.comment ?? null,
    });
    const sentences: string[][] = [
      hotspotUserAdd({
        server: dto.server ?? 'all',
        name: dto.name,
        password: dto.password,
        profile: profileName ?? undefined,
        comment: dto.comment,
        disabled: dto.disabled,
        limitUptime,
        limitBytesTotal: dto.limitBytesTotal,
      }),
    ];
    if (macAddress) sentences.push(ipBindingAddSentence(macAddress, dto.name));
    const enq = await this.mutate(routerId, 'hotspot.user.create', sentences, {
      actor,
      opId: dto.opId,
      // Redacted: the audit never carries the plaintext password.
      after: { name: dto.name, profile: profileName, passwordSet: !!dto.password, macLocked: !!macAddress },
      entity: { table: 'hotspot-user', id: row.id },
    });
    return { user: toUserDto(row, profileName), ...enq };
  }

  async updateUser(routerId: string, id: string, dto: UpdateHotspotUserDto, actor?: CurrentUserType) {
    const row = await this.userOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row, 'hotspot user');

    let passwordRef: string | null | undefined;
    if (dto.password !== undefined) {
      if (dto.password) passwordRef = await this.vault.store(dto.password);
      else passwordRef = null;
    }
    const profile = await this.resolveProfileRow(routerId, dto.profileId, dto.profileName);
    const profileName = profile?.name ?? dto.profileName ?? null;
    // A changed MAC gets a fresh binding entry; the stale one is left for the
    // reconciliation GC (we don't track ip-binding mirror rows).
    const macChanged = dto.macAddress !== undefined && normalizeMac(dto.macAddress) !== normalizeMac(row.macAddress ?? '');
    const macAddress = dto.macAddress !== undefined
      ? (dto.macAddress ? validateMac(dto.macAddress, 'macAddress') : null)
      : undefined;
    const updated = await this.db.hotspotUsers.update(
      { id },
      Object.fromEntries(Object.entries({
        passwordRef,
        profileId: dto.profileId,
        disabled: dto.disabled,
        comment: dto.comment ?? undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        validityFromFirstLogin: dto.validityFromFirstLogin,
        validitySeconds: dto.validitySeconds,
        limitUptime: dto.limitUptime,
        macAddress,
        expiryMode: dto.expiryMode,
      }).filter(([, v]) => v !== undefined)),
    );
    const sentences: string[][] = [
      hotspotUserSet(deviceId, {
        password: dto.password || undefined,
        profile: profileName ?? undefined,
        comment: dto.comment,
        disabled: dto.disabled,
        limitUptime: dto.limitUptime,
        limitBytesTotal: dto.limitBytesTotal,
      }),
    ];
    const effectiveMac = macAddress !== undefined ? macAddress : row.macAddress;
    if (macChanged && effectiveMac) sentences.push(ipBindingAddSentence(effectiveMac, row.name));
    const enq = await this.mutate(routerId, 'hotspot.user.update', sentences, {
      actor,
      opId: dto.opId,
      before: { disabled: row.disabled, profileId: row.profileId },
      after: { disabled: dto.disabled, profile: profileName, passwordSet: dto.password !== undefined, macLocked: !!effectiveMac },
      entity: { table: 'hotspot-user', id },
    });
    return { user: toUserDto(updated, profileName), ...enq };
  }

  async deleteUser(routerId: string, id: string, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.userOrThrow(routerId, id);
    if (row.passwordRef) await this.vault.revoke(row.passwordRef).catch(() => undefined);
    await this.db.hotspotUsers.delete({ id });
    if (!row.mikrotikId) {
      return { opId: opId ?? newOpId(), auditId: '', jobId: '', replayed: false };
    }
    const enq = await this.mutate(routerId, 'hotspot.user.delete', [
      hotspotUserRemove(row.mikrotikId),
    ], { actor, opId, before: { name: row.name } });
    return enq;
  }

  async setUserDisabled(routerId: string, id: string, disabled: boolean, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.userOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row, 'hotspot user');
    const updated = await this.db.hotspotUsers.update({ id }, { disabled });
    const enq = await this.mutate(
      routerId,
      disabled ? 'hotspot.user.disable' : 'hotspot.user.enable',
      [disabled ? hotspotUserDisable(deviceId) : hotspotUserEnable(deviceId)],
      { actor, opId, before: { disabled: row.disabled }, after: { disabled }, entity: { table: 'hotspot', id } },
    );
    return { user: toUserDto(updated, null), ...enq };
  }

  private async userOrThrow(routerId: string, id: string): Promise<HotspotUserRow> {
    await this.routerOrThrow(routerId);
    const row = await this.db.hotspotUsers.findUnique({ id });
    if (!row || row.routerId !== routerId) throw new NotFoundException(`hotspot user ${id} not found`);
    return row;
  }

  private async resolveProfileRow(
    routerId: string,
    profileId?: string,
    profileName?: string,
  ): Promise<HotspotUserProfileRow | null> {
    if (profileId) {
      const p = await this.db.hotspotUserProfiles.findUnique({ id: profileId });
      if (!p || p.routerId !== routerId) throw new NotFoundException(`user profile ${profileId} not found`);
      return p;
    }
    if (profileName) {
      return this.db.hotspotUserProfiles.findFirst({ routerId, name: profileName });
    }
    return null;
  }

  private async resolveProfileName(
    routerId: string,
    profileId?: string,
    profileName?: string,
  ): Promise<string | null> {
    return (await this.resolveProfileRow(routerId, profileId, profileName))?.name ?? profileName ?? null;
  }

  /** Trigger a quota-enforcer run for this router (audited, queued). */
  async enforceQuota(routerId: string, actor?: CurrentUserType): Promise<EnqueuedCommand> {
    return this.commands.enqueueQuota(routerId, actor);
  }

  /**
   * "Expired but still connected" detection.
   *
   * Joins platform users past expiry (EITHER the absolute `expiresAt` clock
   * OR the first-login validity clock — see {@link computeUserExpiry}) with
   * the worker-reported active sessions. Returns the data the worker's
   * expiry/alert pipeline consumes; this method takes no action itself.
   * Also flags MAC mismatches for MAC-pinned users.
   */
  async findStaleSessions(routerId: string, now: Date = new Date()): Promise<StaleHotspotSession[]> {
    await this.routerOrThrow(routerId);
    const [users, sessions] = await Promise.all([
      this.db.hotspotUsers.findMany({ where: { routerId, disabled: false } }),
      this.db.hotspotActiveSessions.findMany({ where: { routerId } }),
    ]);
    const byName = new Map(users.map((u) => [u.name, u]));
    const stale: StaleHotspotSession[] = [];
    for (const s of sessions) {
      const user = byName.get(s.username);
      if (!user) continue; // session for an unknown/deleted user — not ours to judge
      const { expiredAt, expiryKind } = computeUserExpiry(user, now);
      if (!expiredAt || !expiryKind) continue;
      const macMismatch =
        !!user.macAddress && !!s.macAddress &&
        normalizeMac(user.macAddress) !== normalizeMac(s.macAddress);
      stale.push({
        userId: user.id,
        routerId,
        username: user.name,
        expiredAt: expiredAt.toISOString(),
        expiryKind,
        sessionIp: s.address,
        sessionMac: s.macAddress,
        macMismatch,
      });
    }
    return stale;
  }

  // ------------------------------------------------------------ walled garden --

  async listWalledGarden(routerId: string, kind?: string) {
    await this.routerOrThrow(routerId);
    const where: Record<string, unknown> = { routerId };
    if (kind) where.kind = kind;
    const rows = await this.db.hotspotWalledGardens.findMany({ where, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id, routerId: r.routerId, kind: r.kind,
      dstHost: r.dstHost, dstAddress: r.dstAddress, action: r.action,
      comment: r.comment, disabled: r.disabled, mikrotikId: r.mikrotikId,
    }));
  }

  async createWalledGarden(routerId: string, dto: CreateWalledGardenDto, actor?: CurrentUserType) {
    await this.routerOrThrow(routerId);
    const kind = dto.kind ?? 'dns';
    if (kind === 'dns' && !dto.dstHost) {
      throw new UnprocessableEntityException('dstHost is required for kind=dns');
    }
    if (kind === 'ip' && !dto.dstAddress) {
      throw new UnprocessableEntityException('dstAddress is required for kind=ip');
    }
    const row = await this.db.hotspotWalledGardens.create({
      routerId,
      kind,
      dstHost: dto.dstHost ?? null,
      dstAddress: dto.dstAddress ?? null,
      action: dto.action ?? 'allow',
      comment: dto.comment ?? null,
      disabled: dto.disabled ?? false,
    });
    const sentence =
      kind === 'dns'
        ? walledGardenAdd({ dstHost: dto.dstHost, action: dto.action, comment: dto.comment, disabled: dto.disabled })
        : walledGardenIpAdd({ dstAddress: dto.dstAddress, action: dto.action, comment: dto.comment, disabled: dto.disabled });
    const enq = await this.mutate(routerId, 'hotspot.walled-garden.create', [sentence], {
      actor, opId: dto.opId,
      after: { kind, dstHost: dto.dstHost, dstAddress: dto.dstAddress },
      entity: { table: 'hotspot-walled-garden', id: row.id },
    });
    return { entry: row, ...enq };
  }

  async updateWalledGarden(routerId: string, id: string, dto: UpdateWalledGardenDto, actor?: CurrentUserType) {
    const row = await this.walledGardenOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row, 'walled-garden entry');
    const updated = await this.db.hotspotWalledGardens.update(
      { id },
      Object.fromEntries(Object.entries({
        dstHost: dto.dstHost ?? undefined,
        dstAddress: dto.dstAddress ?? undefined,
        action: dto.action,
        comment: dto.comment ?? undefined,
        disabled: dto.disabled,
      }).filter(([, v]) => v !== undefined)),
    );
    const sentence =
      row.kind === 'dns'
        ? walledGardenSet(deviceId, { dstHost: dto.dstHost, action: dto.action, comment: dto.comment, disabled: dto.disabled })
        : walledGardenIpSet(deviceId, { dstAddress: dto.dstAddress, action: dto.action, comment: dto.comment, disabled: dto.disabled });
    const enq = await this.mutate(routerId, 'hotspot.walled-garden.update', [sentence], {
      actor, opId: dto.opId, before: row, entity: { table: 'hotspot-walled-garden', id },
    });
    return { entry: updated, ...enq };
  }

  async deleteWalledGarden(routerId: string, id: string, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.walledGardenOrThrow(routerId, id);
    await this.db.hotspotWalledGardens.delete({ id });
    if (!row.mikrotikId) {
      return { opId: opId ?? newOpId(), auditId: '', jobId: '', replayed: false };
    }
    const enq = await this.mutate(
      routerId,
      'hotspot.walled-garden.delete',
      [row.kind === 'dns' ? walledGardenRemove(row.mikrotikId) : walledGardenIpRemove(row.mikrotikId)],
      { actor, opId, before: row },
    );
    return enq;
  }

  async setWalledGardenDisabled(routerId: string, id: string, disabled: boolean, opId: string | undefined, actor?: CurrentUserType) {
    const row = await this.walledGardenOrThrow(routerId, id);
    const deviceId = this.needDeviceId(row, 'walled-garden entry');
    const updated = await this.db.hotspotWalledGardens.update({ id }, { disabled });
    const sentence =
      row.kind === 'dns'
        ? disabled ? walledGardenDisable(deviceId) : walledGardenEnable(deviceId)
        : disabled ? walledGardenIpDisable(deviceId) : walledGardenIpEnable(deviceId);
    const enq = await this.mutate(
      routerId,
      disabled ? 'hotspot.walled-garden.disable' : 'hotspot.walled-garden.enable',
      [sentence],
      { actor, opId, before: { disabled: row.disabled }, entity: { table: 'hotspot', id } },
    );
    return { entry: updated, ...enq };
  }

  private async walledGardenOrThrow(routerId: string, id: string): Promise<HotspotWalledGardenRow> {
    await this.routerOrThrow(routerId);
    const row = await this.db.hotspotWalledGardens.findUnique({ id });
    if (!row || row.routerId !== routerId) throw new NotFoundException(`walled-garden entry ${id} not found`);
    return row;
  }
}

// ---------------------------------------------------------------------------
// Row → DTO mappers. NOTE: @mtk/ros-api parsers return *device* rows
// (id/name/disabled…); these mappers build the @mtk/types *entities*
// (routerId/mikrotikId/…), filling in the platform-side fields.
// ---------------------------------------------------------------------------

function toServerDto(r: HotspotServerRow): HotspotServer {
  return {
    id: r.id, routerId: r.routerId, name: r.name, interface: r.interface,
    addressPool: r.addressPool, profile: r.profile, disabled: r.disabled,
    mikrotikId: r.mikrotikId,
  };
}

function toProfileDto(r: HotspotProfileRow): HotspotProfile {
  return {
    id: r.id, routerId: r.routerId, name: r.name, hotspotAddress: r.hotspotAddress,
    dnsName: r.dnsName, loginBy: r.loginBy, rateLimit: r.rateLimit,
    mikrotikId: r.mikrotikId,
  };
}

function toUserProfileDto(r: HotspotUserProfileRow): HotspotUserProfile {
  return {
    id: r.id, routerId: r.routerId, name: r.name, rateLimit: r.rateLimit,
    sharedUsers: r.sharedUsers, sessionTimeout: r.sessionTimeout,
    idleTimeout: r.idleTimeout, keepaliveTimeout: r.keepaliveTimeout,
    quotaBytes: r.quotaBytes === null ? null : String(r.quotaBytes),
    quotaSeconds: r.quotaSeconds, mikrotikId: r.mikrotikId,
    macAddress: r.macAddress, limitUptime: r.limitUptime,
    validitySeconds: r.validitySeconds, price: r.price,
    expiryMode: r.expiryMode as HotspotExpiryMode,
  };
}

function toUserDto(r: HotspotUserRow, profileName: string | null): HotspotUser {
  return {
    id: r.id, routerId: r.routerId, name: r.name,
    profileId: r.profileId, profileName,
    disabled: r.disabled,
    uptimeUsedS: String(r.uptimeUsedS),
    bytesIn: String(r.bytesIn),
    bytesOut: String(r.bytesOut),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    mode: (r.mode ?? null) as HotspotUser['mode'],
    batchId: r.batchId,
    validityFromFirstLogin: r.validityFromFirstLogin,
    validitySeconds: r.validitySeconds,
    limitUptime: r.limitUptime,
    firstLoginAt: r.firstLoginAt ? r.firstLoginAt.toISOString() : null,
    macAddress: r.macAddress,
    expiryMode: r.expiryMode as HotspotExpiryMode,
    comment: r.comment,
    mikrotikId: r.mikrotikId,
    createdAt: r.createdAt.toISOString(),
  };
}

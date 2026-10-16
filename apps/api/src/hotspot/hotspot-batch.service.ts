import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { hotspotUserAdd } from '@mtk/ros-api';
import {
  newOpId,
  type HotspotUserBatch,
  type HotspotUserMode,
} from '@mtk/types';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import type { HotspotUserProfileRow } from '../db/rows.js';
import { RouterCommandsService, type EnqueuedCommand } from '../commands/commands.service.js';
import { VAULT_PORT, type VaultPort } from '../vault/vault.port.js';
import { EXPIRY_MODES, type CreateHotspotBatchDto } from './dto/hotspot.dto.js';

/** Full alphanumeric alphabet. */
const FULL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Glyphs that are easily misread on printed vouchers. */
const CONFUSING = new Set(['l', 'L', 'q', 'Q', 'o', 'O', '1', '0']);

/** Alphabet with confusing glyphs stripped (default for printed codes). */
export const CLEAR_ALPHABET = [...FULL_ALPHABET].filter((c) => !CONFUSING.has(c)).join('');

export const DEFAULT_CODE_LENGTH = 8;
export const MAX_BATCH_COUNT = 1000;

/** `vc-<batchId>-<YYYYMMDD>-<note>` (or `up-…`) — encoded on every user comment. */
export function encodeBatchComment(
  mode: HotspotUserMode,
  batchId: string,
  at: Date,
  note?: string,
): string {
  const yyyymmdd = at.toISOString().slice(0, 10).replace(/-/g, '');
  const cleanNote = (note ?? '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9-_]/g, '').slice(0, 40);
  return `${mode}-${batchId}-${yyyymmdd}${cleanNote ? `-${cleanNote}` : ''}`;
}

/** Cryptographically random code from the chosen alphabet. */
export function randomCode(length: number, excludeConfusing: boolean): string {
  const alphabet = excludeConfusing ? CLEAR_ALPHABET : FULL_ALPHABET;
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** Short batch id embedded in the encoded comment (8 hex chars). */
export function newBatchId(): string {
  return randomBytes(4).toString('hex');
}

export interface BatchUserPreview {
  name: string;
  comment: string;
}

export interface CreateBatchResult extends EnqueuedCommand {
  batch: HotspotUserBatch;
  /** Created mirror rows (passwords are vaulted — never returned). */
  users: Array<{ id: string; name: string; comment: string }>;
}

/**
 * Batch credential generation — `up` (username + random password) and `vc`
 * (voucher: username == password, single code).
 *
 * One platform batch = one BullMQ job (idempotent by the batch opId).
 * Passwords go to the Vault; the DB keeps only references; the plaintext
 * travels transiently inside the queued job sentences (same pattern as
 * single-user create) and never lands in audit snapshots.
 */
@Injectable()
export class HotspotBatchService {
  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    @Inject(VAULT_PORT) private readonly vault: VaultPort,
    private readonly commands: RouterCommandsService,
  ) {}

  async generateBatch(
    routerId: string,
    dto: CreateHotspotBatchDto,
    actor?: CurrentUserType,
  ): Promise<CreateBatchResult> {
    await this.commands.requireRouter(routerId);
    if (dto.count > MAX_BATCH_COUNT) {
      throw new UnprocessableEntityException(`count must be ≤ ${MAX_BATCH_COUNT}`);
    }

    const opId = dto.opId ?? newOpId();

    // Idempotency BEFORE creating any rows: a replayed opId returns the
    // original outcome instead of generating a duplicate batch.
    const existing = await this.db.auditLogs.findUnique({ opId });
    if (existing) {
      const batch = await this.db.hotspotBatches.findFirst({ opId });
      const users = batch
        ? await this.db.hotspotUsers.findMany({ where: { batchId: batch.id }, orderBy: { name: 'asc' } })
        : [];
      return {
        opId,
        auditId: existing.id,
        jobId: opId,
        replayed: true,
        batch: batch ? toBatchDto(batch) : ({} as HotspotUserBatch),
        users: users.map((u) => ({ id: u.id, name: u.name, comment: u.comment ?? '' })),
      };
    }

    const profile = await this.resolveProfile(routerId, dto.profileId, dto.profileName);
    const codeLength = dto.codeLength ?? DEFAULT_CODE_LENGTH;
    const excludeConfusing = dto.excludeConfusing ?? true;
    const prefix = dto.prefix ?? '';
    const batchId = newBatchId();
    const now = new Date();
    const comment = encodeBatchComment(dto.mode, batchId, now, dto.note);

    // Profile defaults fill the gaps the DTO leaves empty (explicit per-field
    // so validity-vs-uptime never gets conflated downstream).
    const limitUptime = dto.limitUptime ?? profile?.limitUptime ?? null;
    const validitySeconds = dto.validitySeconds ?? profile?.validitySeconds ?? null;
    const validityFromFirstLogin = dto.validityFromFirstLogin ?? false;
    const expiryMode = dto.expiryMode ?? (profile?.expiryMode as (typeof EXPIRY_MODES)[number] | undefined) ?? 'none';

    const batchRow = await this.db.hotspotBatches.create({
      routerId,
      mode: dto.mode,
      prefix,
      count: dto.count,
      codeLength,
      profileId: dto.profileId ?? null,
      note: dto.note ?? null,
      opId,
    });

    const taken = new Set<string>();
    const sentences: string[][] = [];
    const created: Array<{ id: string; name: string; comment: string }> = [];

    for (let i = 0; i < dto.count; i++) {
      const name = await this.uniqueName(routerId, () => prefix + randomCode(codeLength, excludeConfusing), taken);
      taken.add(name);
      // vc: single code, username == password. up: independent random password.
      const password = dto.mode === 'vc' ? name : randomCode(codeLength, excludeConfusing);
      const passwordRef = await this.vault.store(password);

      const row = await this.db.hotspotUsers.create({
        routerId,
        name,
        passwordRef,
        profileId: dto.profileId ?? null,
        mode: dto.mode,
        batchId: batchRow.id,
        validityFromFirstLogin,
        validitySeconds,
        limitUptime,
        expiryMode,
        disabled: false,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        comment,
      });
      created.push({ id: row.id, name, comment });
      sentences.push(
        hotspotUserAdd({
          server: dto.server ?? 'all',
          name,
          password,
          profile: profile?.name,
          comment,
          limitUptime: limitUptime ?? undefined,
        }),
      );
    }

    const enq = await this.commands.enqueueRos({
      routerId,
      action: 'hotspot.user.batch',
      sentences,
      opId,
      actorId: actor?.sub,
      // Redacted: counts and batch identity only — never passwords.
      after: {
        batchId: batchRow.id,
        mode: dto.mode,
        count: dto.count,
        profile: profile?.name ?? null,
        passwordSet: true,
      },
    });

    return { batch: toBatchDto(batchRow), users: created, ...enq };
  }

  async listBatches(routerId: string): Promise<HotspotUserBatch[]> {
    await this.commands.requireRouter(routerId);
    const rows = await this.db.hotspotBatches.findMany({
      where: { routerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toBatchDto);
  }

  private async uniqueName(
    routerId: string,
    gen: () => string,
    taken: Set<string>,
  ): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const name = gen();
      if (taken.has(name)) continue;
      const dupe = await this.db.hotspotUsers.findFirst({ routerId, name });
      if (!dupe) return name;
    }
    throw new UnprocessableEntityException('could not generate a unique code after 10 attempts — try a longer codeLength');
  }

  private async resolveProfile(
    routerId: string,
    profileId?: string,
    profileName?: string,
  ): Promise<HotspotUserProfileRow | null> {
    if (profileId) {
      const p = await this.db.hotspotUserProfiles.findUnique({ id: profileId });
      if (!p || p.routerId !== routerId) {
        throw new UnprocessableEntityException(`user profile ${profileId} not found on this router`);
      }
      return p;
    }
    if (profileName) {
      return this.db.hotspotUserProfiles.findFirst({ routerId, name: profileName });
    }
    return null;
  }
}

function toBatchDto(r: {
  id: string; routerId: string; mode: string; prefix: string; count: number;
  codeLength: number; profileId: string | null; note: string | null;
  opId: string; createdAt: Date;
}): HotspotUserBatch {
  return {
    id: r.id,
    routerId: r.routerId,
    mode: r.mode as HotspotUserMode,
    prefix: r.prefix,
    count: r.count,
    codeLength: r.codeLength,
    profileId: r.profileId,
    note: r.note,
    opId: r.opId,
    createdAt: r.createdAt.toISOString(),
  };
}

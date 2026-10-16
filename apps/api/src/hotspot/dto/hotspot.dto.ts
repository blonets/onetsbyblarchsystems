import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** Shared "idempotency key" field for mutating DTOs. */
export class OpIdDto {
  @IsOptional()
  @IsString()
  opId?: string;
}

export const EXPIRY_MODES = ['remove', 'notify', 'remove+notify', 'none'] as const;

// ---------------------------------------------------------------------------
// Hotspot servers (/ip/hotspot)
// ---------------------------------------------------------------------------

export class CreateHotspotServerDto extends OpIdDto {
  /** RouterOS-side server name. */
  @IsString()
  name!: string;

  /** Interface the hotspot binds to, e.g. "bridge-lan". */
  @IsString()
  interface!: string;

  @IsOptional()
  @IsString()
  addressPool?: string;

  /** Server-profile name. */
  @IsString()
  profile!: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

export class UpdateHotspotServerDto extends OpIdDto {
  @IsOptional()
  @IsString()
  interface?: string;

  @IsOptional()
  @IsString()
  addressPool?: string;

  @IsOptional()
  @IsString()
  profile?: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Server profiles (/ip/hotspot/profile)
// ---------------------------------------------------------------------------

export class CreateServerProfileDto extends OpIdDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  hotspotAddress?: string;

  @IsOptional()
  @IsString()
  dnsName?: string;

  /** e.g. "http-pap,http-chap,cookie" */
  @IsOptional()
  @IsString()
  loginBy?: string;

  // NOTE: /ip/hotspot/profile has no rate-limit — rates live on user-profiles.
}

export class UpdateServerProfileDto extends OpIdDto {
  @IsOptional()
  @IsString()
  hotspotAddress?: string;

  @IsOptional()
  @IsString()
  dnsName?: string;

  @IsOptional()
  @IsString()
  loginBy?: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// User profiles = plans (/ip/hotspot/user/profile)
// ---------------------------------------------------------------------------

export class CreateUserProfileDto extends OpIdDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  rateLimit?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sharedUsers?: number;

  /** RouterOS duration strings, e.g. "1d", "12:00:00". */
  @IsOptional()
  @IsString()
  sessionTimeout?: string;

  @IsOptional()
  @IsString()
  idleTimeout?: string;

  @IsOptional()
  @IsString()
  keepaliveTimeout?: string;

  /** Quota in bytes (string → bigint); null = unlimited. Enforced by quota-enforcer. */
  @IsOptional()
  @IsString()
  quotaBytes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  quotaSeconds?: number;

  /**
   * MAC pinned to the plan, e.g. "AA:BB:CC:DD:EE:FF". RouterOS has no native
   * user↔MAC pin — the platform stores it and emits /ip/hotspot/ip-binding
   * entries for users, so the lock is visible/auditable and the worker can
   * flag session MAC mismatches.
   */
  @IsOptional()
  @IsString()
  macAddress?: string;

  /** Total session-time cap, e.g. "12:00:00" → device `limit-uptime`. */
  @IsOptional()
  @IsString()
  limitUptime?: string;

  /**
   * Validity window (seconds) starting at FIRST login — explicitly distinct
   * from limitUptime (total session cap).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  validitySeconds?: number;

  /** Voucher face value for the revenue tile; unset → 0 (never faked). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  /** remove | notify | remove+notify | none */
  @IsOptional()
  @IsIn([...EXPIRY_MODES])
  expiryMode?: (typeof EXPIRY_MODES)[number];
}

export class UpdateUserProfileDto extends OpIdDto {
  @IsOptional()
  @IsString()
  rateLimit?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sharedUsers?: number;

  @IsOptional()
  @IsString()
  sessionTimeout?: string;

  @IsOptional()
  @IsString()
  idleTimeout?: string;

  @IsOptional()
  @IsString()
  keepaliveTimeout?: string;

  @IsOptional()
  @IsString()
  quotaBytes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  quotaSeconds?: number;

  /** MAC pinned to the plan, e.g. "AA:BB:CC:DD:EE:FF". */
  @IsOptional()
  @IsString()
  macAddress?: string;

  /** Total session-time cap, e.g. "12:00:00" → device `limit-uptime`. */
  @IsOptional()
  @IsString()
  limitUptime?: string;

  /**
   * Validity window (seconds) starting at FIRST login — explicitly distinct
   * from limitUptime (total session cap).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  validitySeconds?: number;

  /** Voucher face value for the revenue tile; unset → 0 (never faked). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  /** remove | notify | remove+notify | none */
  @IsOptional()
  @IsIn([...EXPIRY_MODES])
  expiryMode?: (typeof EXPIRY_MODES)[number];
}

// ---------------------------------------------------------------------------
// Hotspot users (/ip/hotspot/user)
// ---------------------------------------------------------------------------

export class CreateHotspotUserDto extends OpIdDto {
  @IsString()
  name!: string;

  /**
   * Plaintext password. Stored in the Vault (DB keeps only the reference);
   * the plaintext travels transiently inside the queued job sentences and
   * NEVER lands in audit snapshots or logs.
   */
  @IsOptional()
  @IsString()
  password?: string;

  /** Hotspot server the user belongs to; default "all". */
  @IsOptional()
  @IsString()
  server?: string;

  /** Platform user-profile id (preferred)… */
  @IsOptional()
  @IsString()
  profileId?: string;

  /** …or a raw RouterOS profile name. */
  @IsOptional()
  @IsString()
  profileName?: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  @IsOptional()
  @IsString()
  comment?: string;

  /** ISO-8601 expiry. */
  @IsOptional()
  @IsString()
  expiresAt?: string;

  /** RouterOS duration, e.g. "1d". */
  @IsOptional()
  @IsString()
  limitUptime?: string;

  /** Bytes, e.g. "1073741824". */
  @IsOptional()
  @IsString()
  limitBytesTotal?: string;

  /**
   * When true, `validitySeconds` counts from the user's first login instead
   * of `expiresAt` being absolute. Explicitly distinct from `limitUptime`
   * (total session cap pushed to the device).
   */
  @IsOptional()
  @IsBoolean()
  validityFromFirstLogin?: boolean;

  /** Validity window (seconds) starting at first login. */
  @IsOptional()
  @IsInt()
  @Min(1)
  validitySeconds?: number;

  /** MAC pinned to the user, e.g. "AA:BB:CC:DD:EE:FF". */
  @IsOptional()
  @IsString()
  macAddress?: string;

  /** remove | notify | remove+notify | none */
  @IsOptional()
  @IsIn([...EXPIRY_MODES])
  expiryMode?: (typeof EXPIRY_MODES)[number];
}

export class UpdateHotspotUserDto extends OpIdDto {
  /** Set a new password (vaulted; never echoed back). */
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsString()
  profileName?: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  limitUptime?: string;

  @IsOptional()
  @IsString()
  limitBytesTotal?: string;

  @IsOptional()
  @IsBoolean()
  validityFromFirstLogin?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  validitySeconds?: number;

  /** MAC pinned to the user, e.g. "AA:BB:CC:DD:EE:FF". */
  @IsOptional()
  @IsString()
  macAddress?: string;

  /** remove | notify | remove+notify | none */
  @IsOptional()
  @IsIn([...EXPIRY_MODES])
  expiryMode?: (typeof EXPIRY_MODES)[number];
}

// ---------------------------------------------------------------------------
// Walled garden (/ip/hotspot/walled-garden[/ip])
// ---------------------------------------------------------------------------

export class CreateWalledGardenDto extends OpIdDto {
  /** 'dns' → walled-garden (dst-host); 'ip' → walled-garden/ip. */
  @IsOptional()
  @IsIn(['dns', 'ip'])
  kind?: 'dns' | 'ip';

  @IsOptional()
  @IsString()
  dstHost?: string;

  @IsOptional()
  @IsString()
  dstAddress?: string;

  @IsOptional()
  @IsIn(['allow', 'deny'])
  action?: 'allow' | 'deny';

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

export class UpdateWalledGardenDto extends OpIdDto {
  @IsOptional()
  @IsString()
  dstHost?: string;

  @IsOptional()
  @IsString()
  dstAddress?: string;

  @IsOptional()
  @IsIn(['allow', 'deny'])
  action?: 'allow' | 'deny';

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Batch generation (vouchers / username+password)
// ---------------------------------------------------------------------------

/**
 * Batch-generate hotspot credentials.
 *
 * - `up`: username + random password (two secrets per user).
 * - `vc`: voucher — a single code, username == password.
 *
 * The whole batch is applied as ONE BullMQ job (idempotent by `opId`) and
 * every user comment is encoded `vc-<batchId>-<YYYYMMDD>-<note>` (or `up-…`).
 */
export class CreateHotspotBatchDto extends OpIdDto {
  /** 'up' = username+random password, 'vc' = voucher (username == password). */
  @IsIn(['up', 'vc'])
  mode!: 'up' | 'vc';

  /** 1–1000 credentials per batch. */
  @IsInt()
  @Min(1)
  count!: number;

  /** Username/code prefix, e.g. "CAFE-". */
  @IsOptional()
  @IsString()
  prefix?: string;

  /** Random part length (default 8). */
  @IsOptional()
  @IsInt()
  @Min(4)
  codeLength?: number;

  /**
   * Strip confusing glyphs (l,L,q,Q,o,O,1,0) from the alphabet — default true
   * so printed vouchers can't be misread.
   */
  @IsOptional()
  @IsBoolean()
  excludeConfusing?: boolean;

  /** Platform user-profile id the batch is created under. */
  @IsOptional()
  @IsString()
  profileId?: string;

  /** Raw RouterOS profile name (alternative to profileId). */
  @IsOptional()
  @IsString()
  profileName?: string;

  /** Hotspot server the users belong to; default "all". */
  @IsOptional()
  @IsString()
  server?: string;

  /** Free note — embedded in the encoded comment after the date stamp. */
  @IsOptional()
  @IsString()
  note?: string;

  /** ISO-8601 absolute expiry applied to every user in the batch. */
  @IsOptional()
  @IsString()
  expiresAt?: string;

  /**
   * When true, validitySeconds counts from each user's first login instead
   * of expiresAt being absolute. Distinct from limitUptime (session cap).
   */
  @IsOptional()
  @IsBoolean()
  validityFromFirstLogin?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  validitySeconds?: number;

  /** Total session cap pushed to the device as `limit-uptime`. */
  @IsOptional()
  @IsString()
  limitUptime?: string;

  /** remove | notify | remove+notify | none */
  @IsOptional()
  @IsIn([...EXPIRY_MODES])
  expiryMode?: (typeof EXPIRY_MODES)[number];
}

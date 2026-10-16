import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

/** Shared "idempotency key" field for mutating DTOs. */
export class OpIdDto {
  @IsOptional()
  @IsString()
  opId?: string;
}

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

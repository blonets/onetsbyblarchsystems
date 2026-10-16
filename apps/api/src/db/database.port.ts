import type {
  AuditLogRow,
  BackupRow,
  BackupScheduleRow,
  DownstreamDeviceRow,
  DowntimeRow,
  FirewallJournalRow,
  FirewallRuleRow,
  HotspotActiveSessionRow,
  HotspotBatchRow,
  HotspotProfileRow,
  HotspotServerRow,
  HotspotUserProfileRow,
  HotspotUserRow,
  HotspotWalledGardenRow,
  NotificationRuleRow,
  OnboardingTokenRow,
  QueueRow,
  RefreshTokenRow,
  RoleRow,
  RouterRow,
  SiteRow,
  SiteUserRow,
  UserRow,
  VaultEntryRow,
} from './rows.js';

export interface FindManyOptions<Where> {
  where?: Where;
  orderBy?: Record<string, 'asc' | 'desc'>;
  skip?: number;
  take?: number;
}

/**
 * Minimal repository surface every service may rely on.
 *
 * `Where` is a partial-equality filter over the row (e.g. `{ routerId, table }`).
 * Both the Prisma adapter and the in-memory fake implement exactly this —
 * services stay honest about what queries they need.
 */
export interface Table<Row, Create, Update = Partial<Row>, Where = Partial<Row>> {
  create(data: Create): Promise<Row>;
  findUnique(where: Where): Promise<Row | null>;
  findFirst(where: Where): Promise<Row | null>;
  findMany(opts?: FindManyOptions<Where>): Promise<Row[]>;
  count(where?: Where): Promise<number>;
  update(where: Where, data: Update): Promise<Row>;
  upsert(where: Where, create: Create, update: Update): Promise<Row>;
  delete(where: Where): Promise<Row>;
  deleteMany(where: Where): Promise<number>;
}

/**
 * The database port. The API never touches Prisma (or any driver) directly —
 * services depend on this interface, which is backed by Prisma in production
 * and by a full in-memory fake in tests / DB-less dev.
 */
export interface DbPort {
  users: Table<UserRow, NewUser>;
  roles: Table<RoleRow, NewRole>;
  sites: Table<SiteRow, NewSite>;
  siteUsers: Table<SiteUserRow, SiteUserRow>;
  refreshTokens: Table<RefreshTokenRow, NewRefreshToken>;
  routers: Table<RouterRow, NewRouter>;
  downtimes: Table<DowntimeRow, NewDowntime>;
  hotspotServers: Table<HotspotServerRow, NewHotspotServer>;
  hotspotProfiles: Table<HotspotProfileRow, NewHotspotProfile>;
  hotspotUserProfiles: Table<HotspotUserProfileRow, NewHotspotUserProfile>;
  hotspotBatches: Table<HotspotBatchRow, NewHotspotBatch>;
  hotspotActiveSessions: Table<HotspotActiveSessionRow, NewHotspotActiveSession>;
  hotspotUsers: Table<HotspotUserRow, NewHotspotUser>;
  hotspotWalledGardens: Table<HotspotWalledGardenRow, NewHotspotWalledGarden>;
  firewallRules: Table<FirewallRuleRow, NewFirewallRule>;
  firewallJournals: Table<FirewallJournalRow, NewFirewallJournal>;
  queues: Table<QueueRow, NewQueue>;
  backups: Table<BackupRow, NewBackup>;
  backupSchedules: Table<BackupScheduleRow, NewBackupSchedule>;
  downstreamDevices: Table<DownstreamDeviceRow, NewDownstreamDevice>;
  onboardingTokens: Table<OnboardingTokenRow, NewOnboardingToken>;
  notificationRules: Table<NotificationRuleRow, NewNotificationRule>;
  auditLogs: Table<AuditLogRow, NewAuditLog>;
  vaultEntries: Table<VaultEntryRow, NewVaultEntry>;
}

export const DB_PORT = Symbol('DB_PORT');

// --- Create-input shapes (id/timestamps defaulted by the store) ---

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
  roleId: string;
}
export interface NewRole {
  name: string;
  description?: string;
}
export interface NewSite {
  name: string;
  slug: string;
  address?: string | null;
  city?: string | null;
  country?: string;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
}
export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}
export interface NewRouter {
  uuid: string;
  siteId?: string | null;
  tunnelIp: string;
  sstpUsername: string;
  sstpPasswordRef: string;
  apiPasswordRef: string;
  apiUsername?: string;
  apiPort?: number;
  apiSslPort?: number;
  winboxPort?: number;
  sshPort?: number;
  telnetPort?: number;
  ftpPort?: number;
  wwwPort?: number;
  status?: RouterRow['status'];
  routerOsVersion?: string | null;
  boardName?: string | null;
  serialNumber?: string | null;
  identityName?: string | null;
  pollerShard?: number;
  tags?: string[];
}
export interface NewDowntime {
  routerId: string;
  cause?: string | null;
}
export interface NewHotspotServer {
  routerId: string;
  name: string;
  interface: string;
  addressPool?: string | null;
  profile: string;
  disabled?: boolean;
}
export interface NewHotspotProfile {
  routerId: string;
  name: string;
  hotspotAddress?: string | null;
  dnsName?: string | null;
  loginBy?: string | null;
  rateLimit?: string | null;
}
export interface NewHotspotUserProfile {
  routerId: string;
  name: string;
  rateLimit?: string | null;
  sharedUsers?: number | null;
  sessionTimeout?: string | null;
  idleTimeout?: string | null;
  keepaliveTimeout?: string | null;
  quotaBytes?: bigint | null;
  quotaSeconds?: number | null;
  macAddress?: string | null;
  limitUptime?: string | null;
  validitySeconds?: number | null;
  price?: number | null;
  expiryMode?: string;
}
export interface NewHotspotBatch {
  routerId: string;
  mode: string;
  prefix?: string;
  count: number;
  codeLength: number;
  profileId?: string | null;
  note?: string | null;
  opId: string;
}
export interface NewHotspotActiveSession {
  routerId: string;
  username: string;
  address?: string | null;
  macAddress?: string | null;
  uptime?: string | null;
  server?: string | null;
}
export interface NewHotspotUser {
  routerId: string;
  name: string;
  passwordRef?: string | null;
  profileId?: string | null;
  mode?: string | null;
  batchId?: string | null;
  validityFromFirstLogin?: boolean;
  validitySeconds?: number | null;
  limitUptime?: string | null;
  firstLoginAt?: Date | null;
  macAddress?: string | null;
  expiryMode?: string;
  disabled?: boolean;
  expiresAt?: Date | null;
  comment?: string | null;
}
export interface NewHotspotWalledGarden {
  routerId: string;
  kind?: string;
  dstHost?: string | null;
  dstAddress?: string | null;
  action?: string;
  comment?: string | null;
  disabled?: boolean;
}
export interface NewFirewallRule {
  routerId: string;
  table: string;
  chain: string;
  action: string;
  order: number;
  protocol?: string | null;
  srcAddress?: string | null;
  dstAddress?: string | null;
  srcPort?: string | null;
  dstPort?: string | null;
  inInterface?: string | null;
  outInterface?: string | null;
  toAddresses?: string | null;
  toPorts?: string | null;
  comment?: string | null;
  disabled?: boolean;
  managed?: boolean;
  revoked?: boolean;
}
export interface NewFirewallJournal {
  routerId: string;
  opId: string;
  action: string;
  table: string;
  chain?: string | null;
  ruleId?: string | null;
  before: unknown;
  createdRuleIds?: unknown;
  sentences: unknown;
  status?: string;
}
export interface NewQueue {
  routerId: string;
  kind: string;
  name: string;
  target?: string | null;
  parent?: string | null;
  maxLimit?: string | null;
  limitAt?: string | null;
  priority?: number | null;
  disabled?: boolean;
}
export interface NewBackup {
  routerId: string;
  type: string;
  fileName: string;
  storageKey: string;
  sizeBytes: bigint;
  sha256: string;
  kmsKeyId: string;
  retentionUntil: Date;
}
export interface NewBackupSchedule {
  routerId: string;
  type?: string;
  cron?: string;
  enabled?: boolean;
  retentionDays?: number;
}
export interface NewDownstreamDevice {
  routerId: string;
  deviceId: string;
  name: string;
  kind: string;
  macAddress?: string | null;
  lanIp: string;
  mgmtPort: number;
  protocol?: string;
  proxyPort?: number | null;
  vendor?: string;
  model?: string | null;
  mgmtMethods?: unknown;
}
export interface NewOnboardingToken {
  token: string;
  issuedById: string;
  siteId?: string | null;
  sstpUsername: string;
  sstpPasswordRef: string;
  apiPasswordRef: string;
  tunnelIp: string;
  expiresAt: Date;
}
export interface NewNotificationRule {
  name: string;
  event: string;
  channel: string;
  target: string;
  template?: string | null;
  enabled?: boolean;
}
export interface NewAuditLog {
  actorId?: string | null;
  routerId?: string | null;
  action: string;
  opId: string;
  before?: unknown;
  after?: unknown;
  result?: string;
  error?: string | null;
}
export interface NewVaultEntry {
  ref: string;
  ciphertext: string;
  iv: string;
  authTag: string;
}

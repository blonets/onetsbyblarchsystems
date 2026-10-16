/**
 * Database row types — mirrors `prisma/schema.prisma` 1:1 (Dates as Date).
 *
 * These are hand-maintained so the API compiles and unit-tests even when the
 * Prisma client hasn't been generated (no DB in CI/dev here). The Prisma
 * adapter (`prisma-database.ts`) casts the real client rows to these shapes;
 * a mismatch fails loudly at runtime, not silently.
 */

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  roleId: string;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
}

export interface SiteUserRow {
  userId: string;
  siteId: string;
}

export interface RefreshTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface SiteRow {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  country: string;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type RouterStatusRow = 'pending' | 'online' | 'offline' | 'suspect' | 'decommissioned';

export interface RouterRow {
  id: string;
  uuid: string;
  siteId: string | null;
  tunnelIp: string;
  sstpUsername: string;
  sstpPasswordRef: string;
  apiUsername: string;
  apiPasswordRef: string;
  apiPort: number;
  apiSslPort: number;
  winboxPort: number;
  sshPort: number;
  telnetPort: number;
  ftpPort: number;
  wwwPort: number;
  status: RouterStatusRow;
  lastSeen: Date | null;
  routerOsVersion: string | null;
  boardName: string | null;
  serialNumber: string | null;
  identityName: string | null;
  flapCount: number;
  pollerShard: number;
  createdAt: Date;
  updatedAt: Date;
  decommissionedAt: Date | null;
}

export interface DowntimeRow {
  id: string;
  routerId: string;
  startedAt: Date;
  endedAt: Date | null;
  durationS: number | null;
  cause: string | null;
}

export interface HotspotServerRow {
  id: string;
  routerId: string;
  name: string;
  interface: string;
  addressPool: string | null;
  profile: string;
  disabled: boolean;
  mikrotikId: string | null;
}

export interface HotspotProfileRow {
  id: string;
  routerId: string;
  name: string;
  hotspotAddress: string | null;
  dnsName: string | null;
  loginBy: string | null;
  rateLimit: string | null;
  mikrotikId: string | null;
}

export interface HotspotUserProfileRow {
  id: string;
  routerId: string;
  name: string;
  rateLimit: string | null;
  sharedUsers: number | null;
  sessionTimeout: string | null;
  idleTimeout: string | null;
  keepaliveTimeout: string | null;
  quotaBytes: bigint | null;
  quotaSeconds: number | null;
  mikrotikId: string | null;
}

export interface HotspotUserRow {
  id: string;
  routerId: string;
  name: string;
  passwordRef: string | null;
  profileId: string | null;
  disabled: boolean;
  uptimeUsedS: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  expiresAt: Date | null;
  comment: string | null;
  mikrotikId: string | null;
  createdAt: Date;
}

export interface HotspotWalledGardenRow {
  id: string;
  routerId: string;
  kind: string; // 'dns' | 'ip'
  dstHost: string | null;
  dstAddress: string | null;
  action: string; // 'allow' | 'deny'
  comment: string | null;
  disabled: boolean;
  mikrotikId: string | null;
  createdAt: Date;
}

export interface FirewallRuleRow {
  id: string;
  routerId: string;
  table: string;
  chain: string;
  action: string;
  order: number;
  protocol: string | null;
  srcAddress: string | null;
  dstAddress: string | null;
  srcPort: string | null;
  dstPort: string | null;
  inInterface: string | null;
  outInterface: string | null;
  toAddresses: string | null;
  toPorts: string | null;
  comment: string | null;
  disabled: boolean;
  managed: boolean;
  mikrotikId: string | null;
}

export interface QueueRow {
  id: string;
  routerId: string;
  kind: string;
  name: string;
  target: string | null;
  parent: string | null;
  maxLimit: string | null;
  limitAt: string | null;
  priority: number | null;
  disabled: boolean;
  mikrotikId: string | null;
}

export interface BackupRow {
  id: string;
  routerId: string;
  type: string;
  fileName: string;
  storageKey: string;
  sizeBytes: bigint;
  sha256: string;
  kmsKeyId: string;
  retentionUntil: Date;
  createdAt: Date;
}

export interface BackupScheduleRow {
  id: string;
  routerId: string;
  type: string;
  cron: string;
  enabled: boolean;
  retentionDays: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DownstreamDeviceRow {
  id: string;
  routerId: string;
  deviceId: string;
  name: string;
  kind: string;
  macAddress: string | null;
  lanIp: string;
  mgmtPort: number;
  protocol: string;
  proxyPort: number | null;
  managedRouterId: string | null;
  lastSeen: Date | null;
  /** openwrt | ddwrt | ubiquiti | cisco | mikrotik | unknown */
  vendor: string;
  model: string | null;
  /** { web?: number, ssh?: number } — management ports on the device */
  mgmtMethods: unknown;
}

export interface OnboardingTokenRow {
  id: string;
  token: string;
  issuedById: string;
  siteId: string | null;
  sstpUsername: string;
  sstpPasswordRef: string;
  apiPasswordRef: string;
  tunnelIp: string;
  expiresAt: Date;
  usedAt: Date | null;
  routerId: string | null;
}

export interface NotificationRuleRow {
  id: string;
  name: string;
  event: string;
  channel: string;
  target: string;
  template: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  routerId: string | null;
  action: string;
  opId: string;
  before: unknown;
  after: unknown;
  result: string;
  error: string | null;
  createdAt: Date;
}

/**
 * @mtk/types — shared DTOs for the MikroTik fleet platform.
 *
 * Pure types + tiny pure helpers, no runtime dependencies.
 * Imported by api, worker and web (type-only where possible).
 *
 * Conventions:
 * - IDs are opaque strings (cuid from the DB layer).
 * - Timestamps cross the wire as ISO-8601 strings.
 * - BigInt metric counters are serialized as strings in JSON payloads and as
 *   `number | string` in DTOs (Prisma returns bigint; JSON can't carry it).
 */

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

/** Platform roles, ascending privilege. Guards compare by rank, not name. */
export const ROLE_RANK: Record<RoleName, number> = {
  viewer: 1,
  technician: 2,
  operator: 3,
  admin: 4,
};

export type RoleName = 'viewer' | 'technician' | 'operator' | 'admin';

export interface Role {
  id: string;
  name: RoleName;
  description?: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  roleId: string;
  role?: RoleName;
  siteIds: string[];
  disabledAt?: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse extends AuthTokens {
  user: User;
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

export interface Site {
  id: string;
  name: string;
  slug: string;
  address?: string | null;
  city?: string | null;
  country: string;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lifecycle/visibility status of a managed router. */
export type RouterStatus = 'pending' | 'online' | 'offline' | 'suspect' | 'decommissioned';

/**
 * A managed MikroTik router.
 *
 * Service ports are first-class fields: field routers run custom service ports
 * (e.g. the hub CHR: SSH 8922, Telnet 8923, FTP 8921, WWW 8980), so ros-api
 * must always connect to the ports on this record — never to hard-coded
 * values. Defaults are the RouterOS factory defaults.
 */
export interface Router {
  id: string;
  uuid: string; // stamped into the router (`panel-uuid:<uuid>` in /system note)
  siteId?: string | null;
  tunnelIp: string; // static 10.200.x.y from /ppp secret remote-address
  sstpUsername: string; // per-router UNIQUE SSTP username (password stays in the vault)
  apiUsername: string; // default "panel-api"
  apiPort: number; // default 8728
  apiSslPort: number; // default 8729
  winboxPort: number; // default 8291
  sshPort: number; // default 22
  telnetPort: number; // default 23
  ftpPort: number; // default 21
  wwwPort: number; // default 80
  status: RouterStatus;
  lastSeen?: string | null;
  routerOsVersion?: string | null;
  boardName?: string | null;
  serialNumber?: string | null;
  identityName?: string | null;
  flapCount: number;
  pollerShard: number;
  createdAt: string;
  updatedAt: string;
  decommissionedAt?: string | null;
}

/** A downtime window for a router, recorded by the worker connection manager. */
export interface DowntimeEntry {
  id: string;
  routerId: string;
  startedAt: string;
  endedAt?: string | null;
  durationS?: number | null;
  cause?: string | null;
}

// ---------------------------------------------------------------------------
// Hotspot v1
// ---------------------------------------------------------------------------

export interface HotspotServer {
  id: string;
  routerId: string;
  name: string;
  interface: string;
  addressPool?: string | null;
  profile: string;
  disabled: boolean;
  mikrotikId?: string | null;
}

export interface HotspotProfile {
  id: string;
  routerId: string;
  name: string;
  hotspotAddress?: string | null;
  dnsName?: string | null;
  loginBy?: string | null;
  rateLimit?: string | null;
  mikrotikId?: string | null;
}

/** User-profile = plan (/ip/hotspot/user/profile). */
export interface HotspotUserProfile {
  id: string;
  routerId: string;
  name: string;
  rateLimit?: string | null;
  sharedUsers?: number | null;
  sessionTimeout?: string | null;
  idleTimeout?: string | null;
  keepaliveTimeout?: string | null;
  quotaBytes?: string | null; // serialized bigint; null = unlimited
  quotaSeconds?: number | null;
  mikrotikId?: string | null;
}

export interface HotspotUser {
  id: string;
  routerId: string;
  name: string;
  profileId?: string | null;
  profileName?: string | null;
  disabled: boolean;
  uptimeUsedS: string; // serialized bigint
  bytesIn: string; // serialized bigint
  bytesOut: string; // serialized bigint
  expiresAt?: string | null;
  comment?: string | null;
  mikrotikId?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Firewall
// ---------------------------------------------------------------------------

export type FirewallTable = 'filter' | 'nat' | 'mangle';
export type FirewallAction =
  | 'accept'
  | 'drop'
  | 'reject'
  | 'log'
  | 'jump'
  | 'return'
  | 'masquerade'
  | 'src-nat'
  | 'dst-nat'
  | 'redirect'
  | 'mark-connection'
  | 'mark-packet'
  | 'mark-routing'
  | 'passthrough';

export interface FirewallRule {
  id: string;
  routerId: string;
  table: FirewallTable;
  chain: string;
  action: FirewallAction | string;
  order: number; // platform-side ordering; reconciled via place-before
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
  disabled: boolean;
  managed: boolean; // false = discovered on-device, read-only in UI
  mikrotikId?: string | null;
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export type QueueKind = 'simple' | 'tree';

export interface QueueItem {
  id: string;
  routerId: string;
  kind: QueueKind;
  name: string;
  target?: string | null;
  parent?: string | null;
  maxLimit?: string | null;
  limitAt?: string | null;
  priority?: number | null;
  disabled: boolean;
  mikrotikId?: string | null;
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export type BackupType = 'export' | 'binary';

export interface BackupRecord {
  id: string;
  routerId: string;
  type: BackupType;
  fileName: string;
  storageKey: string;
  sizeBytes: string; // serialized bigint
  sha256: string;
  kmsKeyId: string;
  retentionUntil: string;
  createdAt: string;
}

export interface BackupSchedule {
  id: string;
  routerId: string;
  type: BackupType | 'both';
  cron: string;
  enabled: boolean;
  retentionDays: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Downstream devices
// ---------------------------------------------------------------------------

export type DownstreamKind = 'mikrotik' | 'ap' | 'camera' | 'pos' | 'switch' | 'other';

/**
 * Device vendor. Phase 1 is discovery + proxy-port access only (vendor
 * neutral); Phase 2 lands per-vendor drivers (RouterOS API / OpenWrt
 * UCI-over-SSH / DD-WRT / UniFi) behind the DeviceDriver contract without
 * changing this module's interface.
 */
export type DeviceVendor = 'openwrt' | 'ddwrt' | 'ubiquiti' | 'cisco' | 'mikrotik' | 'unknown';

/** Vendor-neutral management methods: which ports serve web/SSH on the device. */
export interface DeviceMgmtMethods {
  web?: number;
  ssh?: number;
}

/**
 * A downstream device behind a site router, reached through a platform-managed
 * dst-nat rule (comment `panel-proxy:<deviceId>`).
 * Downstream MikroTiks register as managed routers (cascade) via managedRouterId.
 */
export interface DownstreamDevice {
  id: string;
  routerId: string; // the site router that hosts the dst-nat rule
  deviceId: string; // used in the `panel-proxy:<deviceId>` nat comment
  name: string;
  kind: DownstreamKind;
  vendor: DeviceVendor; // default "unknown"; guessed from /ip/neighbor platform
  model?: string | null; // e.g. "Archer C7", "hAP ac^2"
  mgmtMethods?: DeviceMgmtMethods | null; // web/ssh ports on the device
  macAddress?: string | null;
  lanIp: string; // LAN address behind the site router
  mgmtPort: number; // port on the device (e.g. 8728 for a cascaded MikroTik)
  protocol: string; // default "tcp"
  proxyPort?: number | null; // allocated tunnel-side port on the site router
  natRuleId?: string | null; // RouterOS .id of the managing dst-nat rule
  managedRouterId?: string | null; // Router.id when kind == 'mikrotik' and cascaded
  lastSeen?: string | null;
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

export interface ProvisioningToken {
  token: string;
  routerId: string;
  expiresAt: string;
  usedAt?: string;
}

export interface OnboardingTokenRecord {
  id: string;
  token: string;
  issuedById: string;
  siteId?: string | null;
  sstpUsername: string;
  tunnelIp: string;
  expiresAt: string;
  usedAt?: string | null;
  routerId?: string | null;
}

/** Payload the router POSTs to /onboard/:token/callback after first boot. */
export interface OnboardCallback {
  uuid: string; // panel-uuid:<uuid> the script stamped into /system note
  version?: string; // RouterOS version, e.g. "7.15.2"
  board?: string; // board name, e.g. "hAP ac^2"
  serial?: string;
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export type MetricType = 'cpu' | 'mem' | 'traffic' | 'hotspot_active';

export interface CpuMetric {
  ts: string;
  routerId: string;
  cpuPct: number;
}

export interface MemMetric {
  ts: string;
  routerId: string;
  totalKb: number;
  freeKb: number;
}

export interface TrafficMetric {
  ts: string;
  routerId: string;
  iface: string;
  rxBps: number;
  txBps: number;
}

export interface HotspotActiveMetric {
  ts: string;
  routerId: string;
  activeN: number;
}

export interface MetricsIngestBatch {
  cpu?: CpuMetric[];
  mem?: MemMetric[];
  traffic?: TrafficMetric[];
  hotspotActive?: HotspotActiveMetric[];
}

export interface MetricPoint {
  ts: string;
  [k: string]: string | number;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationChannel = 'telegram' | 'email';

export interface NotificationRule {
  id: string;
  name: string;
  event: BusEventName;
  channel: NotificationChannel;
  target: string; // chat id | email address
  template?: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent {
  id: string;
  actorId?: string | null;
  actorType: 'user' | 'system';
  action: string; // e.g. "router.provision", "firewall.rule.create"
  entityType: string;
  entityId?: string | null;
  opId: string; // idempotency key from the command path
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  result: 'pending' | 'done' | 'failed';
  error?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Event bus (stable contract — Phase 2 modules subscribe, never patch)
// ---------------------------------------------------------------------------

export type BusEventName =
  | 'router.online'
  | 'router.offline'
  | 'hotspot.user.login'
  | 'hotspot.user.logout'
  | 'quota.exceeded'
  | 'backup.completed'
  | 'config.changed'
  | 'alert.raised';

export interface BusEventPayload {
  'router.online': { routerId: string; uuid: string; tunnelIp: string; at: string };
  'router.offline': { routerId: string; uuid: string; at: string; cause?: string };
  'hotspot.user.login': { routerId: string; username: string; at: string };
  'hotspot.user.logout': { routerId: string; username: string; at: string };
  'quota.exceeded': { routerId: string; username: string; quotaBytes?: string; at: string };
  'backup.completed': { routerId: string; backupId: string; type: BackupType; at: string };
  'config.changed': {
    routerId: string;
    domain: 'hotspot' | 'firewall' | 'queues' | 'system';
    action: string;
    opId: string;
    actorId?: string;
    at: string;
  };
  'alert.raised': {
    routerId?: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    at: string;
  };
}

// ---------------------------------------------------------------------------
// Job queue contracts (BullMQ; the API enqueues, the worker executes)
// ---------------------------------------------------------------------------

export type QueueName = 'commands' | 'provision' | 'backup' | 'metrics-ingest' | 'quota' | 'notify';

/**
 * A batch of RouterOS API sentences to execute in order on one router.
 * Sentences are word arrays, e.g. [['/ip/hotspot/user/add', '=name=x', ...]].
 */
export interface RosCommandJob {
  kind: 'ros';
  /** Platform idempotency key — also the AuditLog.opId. */
  opId: string;
  routerId: string;
  sentences: string[][];
  /** For firewall filter changes: verify the router is still reachable after apply. */
  safeApply?: { verifyAfterMs: number };
  /** Audit row to flip to done/failed when the job settles. */
  auditId?: string;
  /** Max attempts (BullMQ). Default 3. */
  attempts?: number;
  /**
   * Optional result handler tag. When the worker posts the result, the API
   * dispatches rows to a domain handler instead of just settling the audit.
   * Currently: 'downstream-discover' → downstream discovery ingest.
   */
  resultTag?: 'downstream-discover';
}

export type ProvisionJobType =
  | 'verify-tunnel' // after callback: confirm PPP active + identity stamp
  | 'rotate-secrets' // rotate SSTP + API passwords for a router
  | 'decommission'; // remove hub secret + mark decommissioned

export interface ProvisionJob {
  kind: 'provision';
  type: ProvisionJobType;
  opId: string;
  routerId?: string;
  tokenId?: string;
  sstpUsername?: string;
  tunnelIp?: string;
}

export interface BackupJob {
  kind: 'backup';
  opId: string;
  routerId: string;
  backupType: BackupType | 'both';
  /** Set by the API on restore requests; the worker decrypts + imports. */
  restoreBackupId?: string;
  /** Audit row to flip to done/failed when the job settles. */
  auditId?: string;
}

export interface QuotaJob {
  kind: 'quota';
  opId: string;
  routerId: string;
}

export interface NotifyJob {
  kind: 'notify';
  opId: string;
  event: BusEventName;
  payload: Record<string, unknown>;
  ruleId: string;
  channel: NotificationChannel;
  target: string;
  template?: string;
}

export type JobPayload = RosCommandJob | ProvisionJob | BackupJob | QuotaJob | NotifyJob;

/**
 * Posted by the worker to POST /internal/commands/results when a command job
 * settles. `rows` carries captured reply rows (e.g. a print after add) so the
 * API can reconcile mirrors (mikrotikId, counters).
 */
export interface CommandResultPayload {
  opId: string;
  ok: boolean;
  rows?: Record<string, string>[];
  error?: string;
}

/** A neighbor discovered via /ip/neighbor/print (downstream discovery). */
export interface DiscoveredNeighbor {
  macAddress?: string;
  lanIp: string;
  identity?: string;
  platform?: string;
  interface?: string;
}

// ---------------------------------------------------------------------------
// Socket.IO realtime
// ---------------------------------------------------------------------------

export type LiveEventName =
  | 'router.status'
  | 'command.result'
  | 'metrics.tick'
  | 'alert'
  | 'downstream.discovered';

export interface RouterStatusPush {
  routerId: string;
  status: RouterStatus;
  lastSeen?: string | null;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Generate an idempotency key for the command path. Pure helper. */
export function newOpId(): string {
  // Prefer crypto.randomUUID when available (node 14.17+ / modern browsers).
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @mtk/types — shared DTOs for the MikroTik fleet platform.
 * Pure types, no runtime. Imported by api, worker, web and ros-api (type-only).
 */

/** Lifecycle/visibility status of a managed router. */
export type RouterStatus = 'online' | 'offline' | 'provisioning' | 'error' | 'unknown';

export interface Site {
  id: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A managed MikroTik router.
 *
 * Service ports are first-class fields: the hub CHR runs non-default ports
 * (SSH 8922, Telnet 8923, FTP 8921, WWW 8980), while the test site CHR uses
 * defaults — so ros-api must always connect to the ports on this record,
 * never to hard-coded values. Defaults below are the RouterOS factory defaults.
 */
export interface Router {
  id: string; // platform UUID, also stamped in /system identity comment
  siteId: string;
  identity: string; // /system identity name
  identityComment?: string; // carries `panel-uuid:<id>`
  model?: string;
  boardName?: string;
  rosVersion?: string; // e.g. "7.14.2"
  architecture?: string; // e.g. "arm64"
  tunnelIp?: string; // static 10.200.0.0/16 address, from /ppp secret remote-address
  sstpUsername?: string; // per-router UNIQUE SSTP username (password never leaves the vault)
  apiPort: number; // RouterOS API port, default 8728
  apiSslPort: number; // API-SSL port, default 8729
  winboxPort: number; // WinBox port, default 8291
  sshPort: number; // default 22 (hub CHR: 8922)
  telnetPort: number; // default 23 (hub CHR: 8923)
  ftpPort: number; // default 21 (hub CHR: 8921)
  wwwPort: number; // default 80 (hub CHR: 8980)
  status: RouterStatus;
  lastSeenAt?: string;
  isHub: boolean;
  parentRouterId?: string | null; // set for cascaded downstream MikroTiks
  createdAt: string;
  updatedAt: string;
}

export interface HotspotServer {
  id: string;
  name: string;
  interface: string;
  addressPool?: string;
  profile?: string;
  disabled: boolean;
}

export interface HotspotProfile {
  id: string;
  name: string;
  rateLimit?: string; // e.g. "10M/10M"
  sessionTimeout?: string;
  idleTimeout?: string;
  sharedUsers?: number;
  transparentProxy?: boolean;
  comment?: string;
}

export interface HotspotUser {
  id: string;
  server: string;
  name: string;
  profile: string;
  password?: string; // only ever populated on write paths, never listed
  uptime?: string;
  bytesIn?: number;
  bytesOut?: number;
  packetsIn?: number;
  packetsOut?: number;
  disabled: boolean;
  dynamic: boolean;
  comment?: string;
}

export interface FirewallRule {
  id: string;
  chain: string; // input | forward | output | srcnat | dstnat | custom
  action: string; // accept | drop | reject | masquerade | dst-nat | ...
  srcAddress?: string;
  dstAddress?: string;
  protocol?: string;
  srcPort?: string;
  dstPort?: string;
  inInterface?: string;
  outInterface?: string;
  toAddresses?: string;
  toPorts?: string;
  comment?: string;
  disabled: boolean;
  dynamic: boolean;
  /** 'platform' = managed by us (e.g. panel-proxy:*); 'device' = pre-existing on the router. */
  source: 'platform' | 'device';
  bytes?: number;
  packets?: number;
}

export interface QueueItem {
  id: string;
  name: string;
  target: string; // address or interface
  maxLimit?: string; // e.g. "10M/10M"
  limitAt?: string;
  burstLimit?: string;
  priority?: string;
  disabled: boolean;
  dynamic: boolean;
  comment?: string;
}

export interface BackupRecord {
  id: string;
  routerId: string;
  fileName: string;
  kind: 'binary' | 'export';
  sizeBytes?: number;
  storagePath?: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  actorId?: string;
  actorType: 'user' | 'system';
  action: string; // e.g. "router.provision", "firewall.rule.create"
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

export interface ProvisioningToken {
  token: string;
  routerId: string;
  expiresAt: string;
  usedAt?: string;
}

/**
 * A downstream device behind a site router, reached through a platform-managed
 * dynamic dst-nat rule (comment `panel-proxy:<deviceId>`).
 * Downstream MikroTiks register as managed routers (cascade) via managedRouterId.
 */
export interface DownstreamDevice {
  id: string; // <deviceId> used in the `panel-proxy:<deviceId>` nat comment
  routerId: string; // the site router that hosts the dst-nat rule
  kind: 'mikrotik' | 'camera' | 'printer' | 'other';
  label?: string;
  ipAddress: string; // LAN address behind the site router
  servicePort: number; // port on the device (e.g. 8728 for a cascaded MikroTik)
  proxyPort?: number; // WAN-side port on the site router assigned by the platform
  natRuleId?: string; // RouterOS .id of the managing dst-nat rule
  managedRouterId?: string | null; // Router.id when kind == 'mikrotik' and cascaded
  createdAt: string;
  updatedAt: string;
}

/** A downtime window for a router, recorded by the worker connection manager. */
export interface DowntimeEntry {
  routerId: string;
  disconnectedAt: string;
  reconnectedAt?: string; // absent while the outage is still open
  durationMs?: number; // set when the outage closes
  reason?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Web-local types. Shared DTOs live in `@mtk/types` (owned by the backend
 * agent) — this file only adds view-models and web-specific shapes so we never
 * duplicate the canonical DTOs.
 */
import type {
  AuditEvent,
  BackupRecord,
  DownstreamDevice,
  DownstreamKind,
  DowntimeEntry,
  FirewallRule,
  HotspotProfile,
  HotspotServer,
  HotspotUser,
  HotspotUserProfile,
  QueueItem,
  Router,
  RouterStatus,
} from '@mtk/types';

export type { RouterStatus };

/** Platform RBAC roles (mirrors apps/api auth module). */
export type Role = 'admin' | 'operator' | 'technician' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/** Router joined with its site name for list views. */
export interface RouterView extends Router {
  siteName?: string;
  /** True when this row is the hub CHR (platform-side marker, not a device property). */
  isHub: boolean;
  /** CPU architecture from /system resource (view convenience). */
  architecture?: string;
}

/** Live resource snapshot (/system resource print + hotspot active count). */
export interface RouterResources {
  cpuLoadPct: number;
  freeMemoryBytes: number;
  totalMemoryBytes: number;
  uptimeSeconds: number;
  boardName?: string;
  rosVersion?: string;
  hotspotActive: number;
  tunnelRxBps: number;
  tunnelTxBps: number;
}

export interface MetricPoint {
  ts: string;
  cpuPct: number;
  memPct: number;
  rxBps: number;
  txBps: number;
  hotspotActive: number;
}

export type MetricRange = '1h' | '24h' | '7d';

export interface FleetHealth {
  total: number;
  online: number;
  offline: number;
  suspect: number;
  pending: number;
  avgCpuPct: number;
  totalHotspotActive: number;
  recentDowntime: DowntimeEntry[];
}

export type AlertKind = 'router_offline' | 'cpu_high' | 'hotspot_spike' | 'backup_failed';

export interface AlertRule {
  id: string;
  name: string;
  kind: AlertKind;
  /** e.g. minutes offline, or CPU % — semantics depend on kind. */
  threshold: number;
  enabled: boolean;
  channels: Array<'telegram' | 'email'>;
}

export interface NotificationChannels {
  telegram: { enabled: boolean; configured: boolean };
  email: { enabled: boolean; configured: boolean };
}

export interface BackupPolicy {
  retentionDays: number;
  schedule: string;
  encrypted: boolean;
}

/** Raw /ip neighbor discovery row, before the operator claims it. */
export interface DiscoveredDevice {
  mac: string;
  ipAddress: string;
  identity?: string;
  platform?: string;
  iface?: string;
}

export interface OnboardingIssue {
  token: string;
  routerId: string;
  oneLineCommand: string;
  expiresAt: string;
}

export interface PlatformUser extends AuthUser {
  createdAt: string;
  lastLoginAt?: string;
}

export interface DiffLine {
  op: 'add' | 'remove' | 'change';
  path: string;
  before?: string;
  after?: string;
}

export interface ApplyResult {
  applied: boolean;
  rolledBack: boolean;
  message: string;
}

export interface BulkImportResult {
  created: number;
  failed: number;
  errors: string[];
}

export interface ProxyAllocation {
  deviceId: string;
  proxyPort: number;
  tunnelIp: string;
}

export type FirewallTable = 'filter' | 'nat' | 'mangle' | 'address-list';

export interface RouterFilters {
  q?: string;
  status?: RouterStatus | 'all';
  siteId?: string;
}

// Re-exports so pages can import everything from one place.
export type {
  AuditEvent,
  BackupRecord,
  DownstreamDevice,
  DownstreamKind,
  DowntimeEntry,
  FirewallRule,
  HotspotProfile,
  HotspotServer,
  HotspotUser,
  HotspotUserProfile,
  QueueItem,
  Router,
};

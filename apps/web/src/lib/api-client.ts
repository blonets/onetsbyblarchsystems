/**
 * Typed API layer for the web dashboard.
 *
 * - `ApiClient` is the single contract every page codes against.
 * - `MockApiClient` — clearly-marked fixture adapter for local dev (no backend).
 *   Every mutation edits an in-memory store so the UI behaves like the real thing.
 * - `HttpApiClient` — production adapter: fetch against NEXT_PUBLIC_API_URL,
 *   JWT bearer auth with transparent refresh on 401.
 *
 * Adapter selection: mock unless NEXT_PUBLIC_API_URL is set (override with
 * NEXT_PUBLIC_MOCK_API=true/false). The UI shows a demo banner in mock mode.
 *
 * Canonical public host (production): https://admin.onetsbyblarch.online
 * serves both the web UI and the API. Set NEXT_PUBLIC_API_URL to that host
 * (see apps/web/.env.example); the Socket.IO gateway is derived from it as
 * <NEXT_PUBLIC_API_URL>/fleet. Local dev keeps working with the env var
 * unset (mock adapter) or pointed at http://localhost:<api-port>.
 *
 * REST contract below (paths under NEXT_PUBLIC_API_URL + /api/v1) is the shape
 * the NestJS API is expected to expose; keep it in sync with apps/api.
 */
import type {
  AuditEvent,
  BackupRecord,
  DownstreamDevice,
  DowntimeEntry,
  FirewallRule,
  HotspotProfile,
  HotspotServer,
  HotspotUser,
  HotspotUserProfile,
  Paginated,
  ProvisioningToken,
  QueueItem,
  Site,
} from '@mtk/types';
import type {
  AlertRule,
  ApplyResult,
  AuthSession,
  AuthUser,
  BackupPolicy,
  BulkImportResult,
  DiffLine,
  DiscoveredDevice,
  FirewallTable,
  FleetHealth,
  MetricPoint,
  MetricRange,
  NotificationChannels,
  OnboardingIssue,
  PlatformUser,
  ProxyAllocation,
  Role,
  RouterFilters,
  RouterResources,
  RouterView,
} from './types';

// ---------------------------------------------------------------------------
// Token store (JWT + refresh), browser-local. Never persisted server-side.
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'mtk.auth.session';

function readSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export function writeSession(s: AuthSession | null): void {
  if (typeof window === 'undefined') return;
  if (!s) window.localStorage.removeItem(TOKEN_KEY);
  else window.localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
}

export function currentAccessToken(): string | null {
  return readSession()?.accessToken ?? null;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export interface HotspotProfileInput {
  name: string;
  hotspotAddress?: string;
  dnsName?: string;
  loginBy?: string;
  rateLimit?: string;
}

export interface HotspotUserProfileInput {
  name: string;
  rateLimit?: string;
  sharedUsers?: number;
  sessionTimeout?: string;
  idleTimeout?: string;
}

export interface HotspotUserInput {
  name: string;
  password?: string;
  profileName?: string;
  comment?: string;
  disabled?: boolean;
}

export interface FirewallRuleInput {
  chain: string;
  action: string;
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
  disabled?: boolean;
  placeBeforeId?: string;
}

export interface QueueInput {
  name: string;
  target: string;
  maxLimit?: string;
  limitAt?: string;
  priority?: string;
  disabled?: boolean;
  parent?: string;
}

export interface SiteInput {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  notes?: string;
}

export interface RouterInput {
  siteId: string;
  identityName: string;
  tunnelIp?: string;
  apiPort?: number;
  apiSslPort?: number;
  winboxPort?: number;
  sshPort?: number;
  telnetPort?: number;
  ftpPort?: number;
  wwwPort?: number;
  isHub?: boolean;
}

export interface PlatformUserInput {
  email: string;
  name: string;
  role: Role;
  password?: string;
}

export interface FirewallChange {
  kind: 'create' | 'update' | 'delete' | 'move' | 'toggle';
  table: FirewallTable;
  ruleId?: string;
  input?: FirewallRuleInput;
  direction?: 'up' | 'down';
  disabled?: boolean;
}

export interface ApiClient {
  // auth
  login(email: string, password: string): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<Pick<AuthSession, 'accessToken' | 'refreshToken' | 'expiresAt'>>;
  me(): Promise<AuthUser>;
  logout(): Promise<void>;

  // sites
  listSites(): Promise<Site[]>;
  createSite(input: SiteInput): Promise<Site>;
  updateSite(id: string, input: Partial<SiteInput>): Promise<Site>;
  deleteSite(id: string): Promise<void>;

  // routers
  listRouters(filters?: RouterFilters): Promise<RouterView[]>;
  getRouter(id: string): Promise<RouterView>;
  createRouter(input: RouterInput): Promise<RouterView>;
  updateRouter(id: string, input: Partial<RouterInput>): Promise<RouterView>;
  deleteRouter(id: string): Promise<void>;
  rebootRouter(id: string): Promise<ApplyResult>;
  rotateRouterSecret(id: string): Promise<{ rotatedAt: string }>;
  getRouterResources(id: string): Promise<RouterResources>;
  issueOnboardingToken(siteId: string, identity: string): Promise<OnboardingIssue>;
  getOnboardingToken(token: string): Promise<ProvisioningToken>;

  // hotspot (per router)
  listHotspotServers(routerId: string): Promise<HotspotServer[]>;
  createHotspotServer(routerId: string, input: { name: string; interface: string; profile?: string }): Promise<HotspotServer>;
  updateHotspotServer(routerId: string, id: string, input: Partial<{ name: string; interface: string; profile?: string; disabled: boolean }>): Promise<HotspotServer>;
  deleteHotspotServer(routerId: string, id: string): Promise<void>;
  listServerProfiles(routerId: string): Promise<HotspotProfile[]>;
  createServerProfile(routerId: string, input: HotspotProfileInput): Promise<HotspotProfile>;
  updateServerProfile(routerId: string, id: string, input: Partial<HotspotProfileInput>): Promise<HotspotProfile>;
  deleteServerProfile(routerId: string, id: string): Promise<void>;
  listHotspotUsers(routerId: string): Promise<HotspotUser[]>;
  createHotspotUser(routerId: string, input: HotspotUserInput): Promise<HotspotUser>;
  updateHotspotUser(routerId: string, id: string, input: Partial<HotspotUserInput>): Promise<HotspotUser>;
  deleteHotspotUser(routerId: string, id: string): Promise<void>;
  listUserProfiles(routerId: string): Promise<HotspotUserProfile[]>;
  createUserProfile(routerId: string, input: HotspotUserProfileInput): Promise<HotspotUserProfile>;
  updateUserProfile(routerId: string, id: string, input: Partial<HotspotUserProfileInput>): Promise<HotspotUserProfile>;
  deleteUserProfile(routerId: string, id: string): Promise<void>;
  listWalledGarden(routerId: string): Promise<Array<{ id: string; dstHost: string; disabled: boolean; comment?: string }>>;
  createWalledGarden(routerId: string, input: { dstHost: string; comment?: string }): Promise<{ id: string; dstHost: string; disabled: boolean; comment?: string }>;
  deleteWalledGarden(routerId: string, id: string): Promise<void>;
  listWalledGardenIp(routerId: string): Promise<Array<{ id: string; dstAddress: string; disabled: boolean; comment?: string }>>;
  createWalledGardenIp(routerId: string, input: { dstAddress: string; comment?: string }): Promise<{ id: string; dstAddress: string; disabled: boolean; comment?: string }>;
  deleteWalledGardenIp(routerId: string, id: string): Promise<void>;
  bulkImportHotspotUsers(routerId: string, csv: string, profile: string): Promise<BulkImportResult>;

  // firewall (per router)
  listFirewallRules(routerId: string, table: FirewallTable): Promise<FirewallRule[]>;
  createFirewallRule(routerId: string, table: FirewallTable, input: FirewallRuleInput): Promise<FirewallRule>;
  updateFirewallRule(routerId: string, table: FirewallTable, ruleId: string, input: Partial<FirewallRuleInput>): Promise<FirewallRule>;
  deleteFirewallRule(routerId: string, table: FirewallTable, ruleId: string): Promise<void>;
  moveFirewallRule(routerId: string, table: FirewallTable, ruleId: string, direction: 'up' | 'down'): Promise<FirewallRule[]>;
  toggleFirewallRule(routerId: string, table: FirewallTable, ruleId: string, disabled: boolean): Promise<FirewallRule>;
  previewFirewallChanges(routerId: string, changes: FirewallChange[]): Promise<DiffLine[]>;
  applyFirewallChanges(routerId: string, changes: FirewallChange[], safeApply: boolean): Promise<ApplyResult>;

  // queues (per router)
  listSimpleQueues(routerId: string): Promise<QueueItem[]>;
  createSimpleQueue(routerId: string, input: QueueInput): Promise<QueueItem>;
  updateSimpleQueue(routerId: string, id: string, input: Partial<QueueInput>): Promise<QueueItem>;
  deleteSimpleQueue(routerId: string, id: string): Promise<void>;
  listQueueTree(routerId: string): Promise<QueueItem[]>;
  createQueueTree(routerId: string, input: QueueInput): Promise<QueueItem>;
  updateQueueTree(routerId: string, id: string, input: Partial<QueueInput>): Promise<QueueItem>;
  deleteQueueTree(routerId: string, id: string): Promise<void>;

  // monitoring
  getRouterMetrics(routerId: string, range: MetricRange): Promise<MetricPoint[]>;
  getDowntime(routerId?: string): Promise<DowntimeEntry[]>;
  getFleetHealth(): Promise<FleetHealth>;
  listAlertRules(): Promise<AlertRule[]>;
  createAlertRule(input: Omit<AlertRule, 'id'>): Promise<AlertRule>;
  updateAlertRule(id: string, input: Partial<AlertRule>): Promise<AlertRule>;
  deleteAlertRule(id: string): Promise<void>;

  // backups
  listBackups(routerId?: string): Promise<BackupRecord[]>;
  triggerBackup(routerId: string): Promise<BackupRecord>;
  restoreBackup(backupId: string): Promise<ApplyResult>;
  getBackupPolicy(): Promise<BackupPolicy>;

  // downstream devices
  listDiscoveredDevices(routerId: string): Promise<DiscoveredDevice[]>;
  rescanDevices(routerId: string): Promise<DiscoveredDevice[]>;
  listDownstreamDevices(routerId?: string): Promise<DownstreamDevice[]>;
  enableRemoteAccess(routerId: string, ipAddress: string, label: string, kind: DownstreamDevice['kind'], servicePort: number): Promise<ProxyAllocation>;
  disableRemoteAccess(deviceId: string): Promise<void>;

  // admin
  listPlatformUsers(): Promise<PlatformUser[]>;
  createPlatformUser(input: PlatformUserInput): Promise<PlatformUser>;
  updatePlatformUser(id: string, input: Partial<PlatformUserInput>): Promise<PlatformUser>;
  deletePlatformUser(id: string): Promise<void>;
  listAuditLog(page?: number, pageSize?: number): Promise<Paginated<AuditEvent>>;
  getNotificationChannels(): Promise<NotificationChannels>;
  updateNotificationChannels(input: Partial<{ telegramEnabled: boolean; emailEnabled: boolean }>): Promise<NotificationChannels>;
}

// ---------------------------------------------------------------------------
// MOCK adapter — fixture data, clearly marked. Dev only.
// ---------------------------------------------------------------------------

const MOCK_LATENCY_MS = 160;

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

const nowIso = () => new Date().toISOString();

export class MockApiClient implements ApiClient {
  private sites: Site[] = [
    { id: 'site-maadi', name: 'Cairo — Maadi', slug: 'cairo-maadi', city: 'Cairo', country: 'Egypt', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z' },
    { id: 'site-zamalek', name: 'Cairo — Zamalek', slug: 'cairo-zamalek', city: 'Cairo', country: 'Egypt', createdAt: '2026-09-05T10:00:00Z', updatedAt: '2026-09-05T10:00:00Z' },
    { id: 'site-hurghada', name: 'Hurghada — Marina', slug: 'hurghada-marina', city: 'Hurghada', country: 'Egypt', createdAt: '2026-09-12T10:00:00Z', updatedAt: '2026-09-12T10:00:00Z' },
    { id: 'site-alex', name: 'Alexandria — Corniche', slug: 'alexandria-corniche', city: 'Alexandria', country: 'Egypt', createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z' },
  ];

  private routers: RouterView[] = [
    { id: 'r-001', uuid: 'uuid-cafe-maadi-01', siteId: 'site-maadi', siteName: 'Cairo — Maadi', identityName: 'cafe-maadi-01', boardName: 'RB750Gr3', routerOsVersion: '7.14.2', architecture: 'mmips', tunnelIp: '10.200.0.2', sstpUsername: 'sstp-cafe-maadi-01', apiUsername: 'panel-api', apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 22, telnetPort: 23, ftpPort: 21, wwwPort: 80, status: 'online', lastSeen: nowIso(), flapCount: 0, pollerShard: 1, isHub: false, createdAt: '2026-09-01T10:00:00Z', updatedAt: nowIso() },
    { id: 'r-002', uuid: 'uuid-rest-zamalek-02', siteId: 'site-zamalek', siteName: 'Cairo — Zamalek', identityName: 'rest-zamalek-02', boardName: 'hAP ac²', routerOsVersion: '6.49.13', architecture: 'arm', tunnelIp: '10.200.0.3', sstpUsername: 'sstp-rest-zamalek-02', apiUsername: 'panel-api', apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 22, telnetPort: 23, ftpPort: 21, wwwPort: 80, status: 'online', lastSeen: nowIso(), flapCount: 1, pollerShard: 2, isHub: false, createdAt: '2026-09-05T10:00:00Z', updatedAt: nowIso() },
    { id: 'r-003', uuid: 'uuid-hotel-hurghada-01', siteId: 'site-hurghada', siteName: 'Hurghada — Marina', identityName: 'hotel-hurghada-01', boardName: 'RB4011', routerOsVersion: '7.12.1', architecture: 'arm', tunnelIp: '10.200.0.4', sstpUsername: 'sstp-hotel-hurghada-01', apiUsername: 'panel-api', apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 22, telnetPort: 23, ftpPort: 21, wwwPort: 80, status: 'offline', lastSeen: '2026-10-16T05:12:03Z', flapCount: 4, pollerShard: 3, isHub: false, createdAt: '2026-09-12T10:00:00Z', updatedAt: '2026-10-16T05:12:03Z' },
    { id: 'r-004', uuid: 'uuid-cafe-alex-01', siteId: 'site-alex', siteName: 'Alexandria — Corniche', identityName: 'cafe-alex-01', routerOsVersion: '7.14.2', tunnelIp: '10.200.0.5', sstpUsername: 'sstp-cafe-alex-01', apiUsername: 'panel-api', apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 22, telnetPort: 23, ftpPort: 21, wwwPort: 80, status: 'pending', flapCount: 0, pollerShard: 4, isHub: false, createdAt: '2026-10-16T07:00:00Z', updatedAt: '2026-10-16T07:00:00Z' },
    { id: 'r-hub', uuid: 'uuid-hub-chr', siteId: 'site-maadi', siteName: 'Hub — Frankfurt', identityName: 'hub-chr', boardName: 'CHR', routerOsVersion: '6.49.17', architecture: 'x86_64', tunnelIp: '10.200.0.1', sstpUsername: 'sstp-hub', apiUsername: 'panel-api', apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 8922, telnetPort: 8923, ftpPort: 8921, wwwPort: 8980, status: 'online', lastSeen: nowIso(), flapCount: 0, pollerShard: 0, isHub: true, createdAt: '2026-09-01T09:00:00Z', updatedAt: nowIso() },
  ];

  private hotspotServers: Record<string, HotspotServer[]> = {
    'r-001': [
      { id: 'hs-1', routerId: 'r-001', name: 'hotspot1', interface: 'bridge-hotspot', addressPool: 'hs-pool', profile: 'hsprof-default', disabled: false },
    ],
    'r-002': [
      { id: 'hs-2', routerId: 'r-002', name: 'hotspot1', interface: 'bridge-lan', addressPool: 'hs-pool', profile: 'hsprof-default', disabled: false },
    ],
  };

  private serverProfiles: Record<string, HotspotProfile[]> = {
    'r-001': [
      { id: 'hsp-1', routerId: 'r-001', name: 'hsprof-default', hotspotAddress: '192.168.88.1', dnsName: 'login.cafe.local', loginBy: 'http-chap,https,http-pap', rateLimit: '10M/10M' },
      { id: 'hsp-2', routerId: 'r-001', name: 'hsprof-vip', hotspotAddress: '192.168.88.1', loginBy: 'http-chap,https', rateLimit: '50M/50M' },
    ],
  };

  private hotspotUsers: Record<string, HotspotUser[]> = {
    'r-001': [
      { id: 'hu-1', routerId: 'r-001', name: 'table-05', profileName: 'hsprof-default', disabled: false, uptimeUsedS: '4364', bytesIn: '412000000', bytesOut: '1204000000', createdAt: '2026-10-16T06:00:00Z' },
      { id: 'hu-2', routerId: 'r-001', name: 'table-12', profileName: 'hsprof-vip', disabled: false, uptimeUsedS: '1390', bytesIn: '98000000', bytesOut: '310000000', createdAt: '2026-10-16T06:30:00Z' },
      { id: 'hu-3', routerId: 'r-001', name: 'staff-01', profileName: 'hsprof-default', disabled: true, uptimeUsedS: '0', bytesIn: '0', bytesOut: '0', comment: 'suspended — quota', createdAt: '2026-10-15T09:00:00Z' },
    ],
  };

  private userProfiles: Record<string, HotspotUserProfile[]> = {
    'r-001': [
      { id: 'hup-1', routerId: 'r-001', name: 'hsprof-default', rateLimit: '10M/10M', sessionTimeout: '04:00:00', idleTimeout: '00:15:00', sharedUsers: 2 },
      { id: 'hup-2', routerId: 'r-001', name: 'hsprof-vip', rateLimit: '50M/50M', sessionTimeout: '12:00:00', sharedUsers: 5 },
      { id: 'hup-3', routerId: 'r-001', name: 'staff', rateLimit: '20M/20M', sharedUsers: 3 },
    ],
  };

  private walledGarden: Record<string, Array<{ id: string; dstHost: string; disabled: boolean; comment?: string }>> = {
    'r-001': [
      { id: 'wg-1', dstHost: '*.whatsapp.com', disabled: false },
      { id: 'wg-2', dstHost: 'connectivitycheck.gstatic.com', disabled: false, comment: 'captive-portal detection' },
    ],
  };

  private walledGardenIp: Record<string, Array<{ id: string; dstAddress: string; disabled: boolean; comment?: string }>> = {
    'r-001': [{ id: 'wgi-1', dstAddress: '8.8.8.8', disabled: false, comment: 'DNS' }],
  };

  private firewall: Record<string, Record<FirewallTable, FirewallRule[]>> = {
    'r-001': {
      filter: [
        { id: 'fw-f1', routerId: 'r-001', table: 'filter', order: 0, chain: 'input', action: 'accept', protocol: 'tcp', dstPort: '8728', srcAddress: '10.200.0.0/16', comment: 'panel: allow API from tunnel', disabled: false, managed: true },
        { id: 'fw-f2', routerId: 'r-001', table: 'filter', order: 1, chain: 'input', action: 'drop', comment: 'panel: drop everything else on input', disabled: false, managed: true },
        { id: 'fw-f3', routerId: 'r-001', table: 'filter', order: 2, chain: 'forward', action: 'accept', comment: 'established,related', disabled: false, managed: false },
      ],
      nat: [
        { id: 'fw-n1', routerId: 'r-001', table: 'nat', order: 0, chain: 'srcnat', action: 'masquerade', outInterface: 'ether1-WAN', comment: 'site WAN masquerade', disabled: false, managed: false },
        { id: 'fw-n2', routerId: 'r-001', table: 'nat', order: 1, chain: 'dstnat', action: 'dst-nat', protocol: 'tcp', dstPort: '2201', toAddresses: '192.168.88.21', toPorts: '22', comment: 'panel-proxy:dev-cam-01', disabled: false, managed: true },
      ],
      mangle: [
        { id: 'fw-m1', routerId: 'r-001', table: 'mangle', order: 0, chain: 'prerouting', action: 'mark-connection', comment: 'mark hotspot traffic', disabled: true, managed: false },
      ],
      'address-list': [
        { id: 'fw-a1', routerId: 'r-001', table: 'address-list' as FirewallRule['table'], order: 0, chain: 'address-list', action: '', srcAddress: '192.168.88.0/24', comment: 'list=lan-subnet', disabled: false, managed: true },
      ],
    },
  };

  private queues: Record<string, { simple: QueueItem[]; tree: QueueItem[] }> = {
    'r-001': {
      simple: [
        { id: 'q-1', routerId: 'r-001', kind: 'simple', name: 'vip-tables', target: '192.168.88.50/32', maxLimit: '50M/50M', limitAt: '20M/20M', priority: 2, disabled: false },
        { id: 'q-2', routerId: 'r-001', kind: 'simple', name: 'guest-default', target: '192.168.88.0/24', maxLimit: '10M/10M', priority: 8, disabled: false },
      ],
      tree: [
        { id: 'qt-1', routerId: 'r-001', kind: 'tree', name: 'total-wan', target: 'ether1-WAN', maxLimit: '200M/200M', priority: 1, disabled: false },
      ],
    },
  };

  private backups: BackupRecord[] = [
    { id: 'b-1', routerId: 'r-001', type: 'binary', fileName: 'cafe-maadi-01-20261016-0230.backup', storageKey: 'backups/r-001/cafe-maadi-01-20261016-0230.backup', sizeBytes: '4812390', sha256: 'mock-sha256-b1', kmsKeyId: 'mock-kms-1', retentionUntil: '2026-11-15T02:30:11Z', createdAt: '2026-10-16T02:30:11Z' },
    { id: 'b-2', routerId: 'r-001', type: 'export', fileName: 'cafe-maadi-01-20261016-0230.rsc', storageKey: 'backups/r-001/cafe-maadi-01-20261016-0230.rsc', sizeBytes: '812440', sha256: 'mock-sha256-b2', kmsKeyId: 'mock-kms-1', retentionUntil: '2026-11-15T02:31:02Z', createdAt: '2026-10-16T02:31:02Z' },
    { id: 'b-3', routerId: 'r-002', type: 'binary', fileName: 'rest-zamalek-02-20261016-0241.backup', storageKey: 'backups/r-002/rest-zamalek-02-20261016-0241.backup', sizeBytes: '3990112', sha256: 'mock-sha256-b3', kmsKeyId: 'mock-kms-1', retentionUntil: '2026-11-15T02:41:55Z', createdAt: '2026-10-16T02:41:55Z' },
    { id: 'b-4', routerId: 'r-003', type: 'binary', fileName: 'hotel-hurghada-01-20261015-0255.backup', storageKey: 'backups/r-003/hotel-hurghada-01-20261015-0255.backup', sizeBytes: '8112004', sha256: 'mock-sha256-b4', kmsKeyId: 'mock-kms-1', retentionUntil: '2026-11-14T02:55:20Z', createdAt: '2026-10-15T02:55:20Z' },
  ];

  private downtime: DowntimeEntry[] = [
    { id: 'd-1', routerId: 'r-003', startedAt: '2026-10-16T05:12:03Z', cause: 'heartbeat missed ×3' },
    { id: 'd-2', routerId: 'r-002', startedAt: '2026-10-14T11:02:44Z', endedAt: '2026-10-14T11:19:31Z', durationS: 1007, cause: 'ISP flap' },
    { id: 'd-3', routerId: 'r-001', startedAt: '2026-10-12T03:44:10Z', endedAt: '2026-10-12T03:47:02Z', durationS: 172, cause: 'tunnel flap' },
  ];

  private alertRules: AlertRule[] = [
    { id: 'al-1', name: 'Router offline > 5 min', kind: 'router_offline', threshold: 5, enabled: true, channels: ['telegram', 'email'] },
    { id: 'al-2', name: 'CPU above 85%', kind: 'cpu_high', threshold: 85, enabled: true, channels: ['telegram'] },
    { id: 'al-3', name: 'Backup failed', kind: 'backup_failed', threshold: 1, enabled: false, channels: ['email'] },
  ];

  private notificationChannels: NotificationChannels = {
    telegram: { enabled: true, configured: false },
    email: { enabled: false, configured: false },
  };

  private devices: DownstreamDevice[] = [
    { id: 'dev-cam-01', routerId: 'r-001', deviceId: 'dev-cam-01', name: 'Entrance camera', kind: 'camera', vendor: 'unknown', lanIp: '192.168.88.21', mgmtPort: 80, protocol: 'tcp', proxyPort: 2201, natRuleId: 'fw-n2' },
  ];

  private discovered: Record<string, DiscoveredDevice[]> = {
    'r-001': [
      { mac: 'AA:BB:CC:11:22:33', ipAddress: '192.168.88.21', identity: 'cam-entrance', platform: 'MikroTik', iface: 'bridge-hotspot' },
      { mac: 'AA:BB:CC:44:55:66', ipAddress: '192.168.88.22', identity: 'pos-terminal-1', platform: 'Linux', iface: 'bridge-hotspot' },
      { mac: 'AA:BB:CC:77:88:99', ipAddress: '192.168.88.23', identity: 'ap-floor2', platform: 'MikroTik', iface: 'bridge-hotspot' },
    ],
  };

  private platformUsers: PlatformUser[] = [
    { id: 'u-admin', email: 'admin@fleet.local', name: 'Platform Admin', role: 'admin', createdAt: '2026-09-01T09:00:00Z', lastLoginAt: nowIso() },
    { id: 'u-op', email: 'ops@fleet.local', name: 'Ops Engineer', role: 'operator', createdAt: '2026-09-10T09:00:00Z' },
    { id: 'u-tech', email: 'tech@fleet.local', name: 'Field Technician', role: 'technician', createdAt: '2026-09-15T09:00:00Z' },
  ];

  private audit: AuditEvent[] = [
    { id: 'a-1', actorId: 'u-op', actorType: 'user', action: 'hotspot.user.create', entityType: 'hotspot-user', entityId: 'hu-2', opId: 'op-mock-a1', after: { routerId: 'r-001', name: 'table-12' }, result: 'done', createdAt: '2026-10-16T07:20:11Z' },
    { id: 'a-2', actorId: 'u-admin', actorType: 'user', action: 'firewall.rule.create', entityType: 'firewall-rule', entityId: 'fw-f1', opId: 'op-mock-a2', after: { routerId: 'r-001', table: 'filter' }, result: 'done', createdAt: '2026-10-16T06:58:40Z' },
    { id: 'a-3', actorType: 'system', action: 'router.offline', entityType: 'router', entityId: 'r-003', opId: 'op-mock-a3', after: { reason: 'heartbeat missed ×3' }, result: 'done', createdAt: '2026-10-16T05:12:03Z' },
    { id: 'a-4', actorType: 'system', action: 'backup.completed', entityType: 'backup', entityId: 'b-1', opId: 'op-mock-a4', after: { routerId: 'r-001' }, result: 'done', createdAt: '2026-10-16T02:30:11Z' },
  ];

  private usedProxyPorts = new Set([2201]);

  private async wait(): Promise<void> {
    await new Promise((r) => setTimeout(r, MOCK_LATENCY_MS));
  }

  private notFound(what: string): Error {
    const e = new Error(`${what} not found`);
    (e as { status?: number }).status = 404;
    return e;
  }

  // -- auth ---------------------------------------------------------------
  async login(email: string, _password: string): Promise<AuthSession> {
    await this.wait();
    // MOCK: any credentials sign in as the demo admin. Production adapter
    // validates against the NestJS auth module.
    const user: AuthUser = { id: 'u-admin', email: email || 'admin@fleet.local', name: 'Platform Admin', role: 'admin' };
    return { user, accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  }

  async refresh(_rt: string) {
    await this.wait();
    return { accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  }

  async me(): Promise<AuthUser> {
    await this.wait();
    return { id: 'u-admin', email: 'admin@fleet.local', name: 'Platform Admin', role: 'admin' };
  }

  async logout(): Promise<void> {
    await this.wait();
    writeSession(null);
  }

  // -- sites ---------------------------------------------------------------
  async listSites(): Promise<Site[]> {
    await this.wait();
    return [...this.sites];
  }
  async createSite(input: SiteInput): Promise<Site> {
    await this.wait();
    const s: Site = {
      id: uid('site'),
      name: input.name,
      slug: input.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || uid('site'),
      address: input.address,
      city: input.city,
      country: input.country ?? '',
      notes: input.notes,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.sites.push(s);
    return s;
  }
  async updateSite(id: string, input: Partial<SiteInput>): Promise<Site> {
    await this.wait();
    const s = this.sites.find((x) => x.id === id);
    if (!s) throw this.notFound('Site');
    Object.assign(s, input, { updatedAt: nowIso() });
    return s;
  }
  async deleteSite(id: string): Promise<void> {
    await this.wait();
    this.sites = this.sites.filter((x) => x.id !== id);
  }

  // -- routers -------------------------------------------------------------
  async listRouters(filters?: RouterFilters): Promise<RouterView[]> {
    await this.wait();
    let rows = [...this.routers];
    if (filters?.status && filters.status !== 'all') rows = rows.filter((r) => r.status === filters.status);
    if (filters?.siteId) rows = rows.filter((r) => r.siteId === filters.siteId);
    if (filters?.q) {
      const q = filters.q.toLowerCase();
      rows = rows.filter((r) => (r.identityName ?? '').toLowerCase().includes(q) || (r.siteName ?? '').toLowerCase().includes(q) || r.tunnelIp.includes(q));
    }
    return rows;
  }
  async getRouter(id: string): Promise<RouterView> {
    await this.wait();
    const r = this.routers.find((x) => x.id === id);
    if (!r) throw this.notFound('Router');
    return r;
  }
  async createRouter(input: RouterInput): Promise<RouterView> {
    await this.wait();
    const site = this.sites.find((s) => s.id === input.siteId);
    const r: RouterView = {
      id: uid('r'),
      uuid: uid('uuid'),
      siteId: input.siteId,
      identityName: input.identityName,
      tunnelIp: input.tunnelIp ?? '10.200.0.x',
      sstpUsername: `sstp-${input.identityName}`,
      apiUsername: 'panel-api',
      siteName: site?.name,
      apiPort: input.apiPort ?? 8728, apiSslPort: input.apiSslPort ?? 8729,
      winboxPort: input.winboxPort ?? 8291, sshPort: input.sshPort ?? 22,
      telnetPort: input.telnetPort ?? 23, ftpPort: input.ftpPort ?? 21,
      wwwPort: input.wwwPort ?? 80,
      status: 'pending', flapCount: 0, pollerShard: 0,
      isHub: input.isHub ?? false,
      createdAt: nowIso(), updatedAt: nowIso(),
    };
    this.routers.push(r);
    return r;
  }
  async updateRouter(id: string, input: Partial<RouterInput>): Promise<RouterView> {
    await this.wait();
    const r = this.routers.find((x) => x.id === id);
    if (!r) throw this.notFound('Router');
    Object.assign(r, input, { updatedAt: nowIso() });
    return r;
  }
  async deleteRouter(id: string): Promise<void> {
    await this.wait();
    this.routers = this.routers.filter((x) => x.id !== id);
  }
  async rebootRouter(id: string): Promise<ApplyResult> {
    await this.wait();
    const r = this.routers.find((x) => x.id === id);
    if (!r) throw this.notFound('Router');
    // NOTE: the restricted `panel-api` group denies `reboot`; the worker
    // escalates through the provisioning channel instead.
    return { applied: true, rolledBack: false, message: 'Reboot command queued (opId logged to audit)' };
  }
  async rotateRouterSecret(id: string): Promise<{ rotatedAt: string }> {
    await this.wait();
    const r = this.routers.find((x) => x.id === id);
    if (!r) throw this.notFound('Router');
    // The secret value itself is never returned to the browser — only the fact
    // of rotation. New credentials live in the vault + on the router.
    return { rotatedAt: nowIso() };
  }
  async getRouterResources(id: string): Promise<RouterResources> {
    await this.wait();
    const r = this.routers.find((x) => x.id === id);
    if (!r) throw this.notFound('Router');
    const online = r.status === 'online';
    return {
      cpuLoadPct: online ? 18 + Math.round(Math.random() * 22) : 0,
      freeMemoryBytes: 380 * 1024 * 1024,
      totalMemoryBytes: 1024 * 1024 * 1024,
      uptimeSeconds: online ? 86400 * 12 + 3600 * 4 : 0,
      boardName: r.boardName ?? undefined,
      rosVersion: r.routerOsVersion ?? undefined,
      hotspotActive: online ? 12 + Math.floor(Math.random() * 20) : 0,
      tunnelRxBps: online ? 4_200_000 + Math.random() * 8_000_000 : 0,
      tunnelTxBps: online ? 1_100_000 + Math.random() * 3_000_000 : 0,
    };
  }
  async issueOnboardingToken(siteId: string, identity: string): Promise<OnboardingIssue> {
    await this.wait();
    const token = `onb_${Math.random().toString(36).slice(2, 18)}`;
    // Canonical public panel host; overridable via NEXT_PUBLIC_API_URL for
    // local dev. The router's /tool fetch `address=` needs the bare host.
    const panel = (process.env.NEXT_PUBLIC_API_URL ?? 'https://admin.onetsbyblarch.online').replace(/\/$/, '');
    return {
      token,
      routerId: uid('r'),
      oneLineCommand: `/tool fetch mode=https address=${panel.replace(/^https?:\/\//, '')} src-path=/api/v1/onboard/${token}/onboard.rsc dst-path=onboard.rsc; /import onboard.rsc`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  }
  async getOnboardingToken(token: string): Promise<ProvisioningToken> {
    await this.wait();
    return { token, routerId: uid('r'), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  }

  // -- hotspot ---------------------------------------------------------------
  private hs<T>(map: Record<string, T[]>, routerId: string): T[] {
    return (map[routerId] ??= []);
  }
  async listHotspotServers(routerId: string) { await this.wait(); return [...this.hs(this.hotspotServers, routerId)]; }
  async createHotspotServer(routerId: string, input: { name: string; interface: string; profile?: string }) {
    await this.wait();
    const s: HotspotServer = { id: uid('hs'), routerId, disabled: false, profile: 'default', ...input };
    this.hs(this.hotspotServers, routerId).push(s);
    return s;
  }
  async updateHotspotServer(routerId: string, id: string, input: Partial<{ name: string; interface: string; profile?: string; disabled: boolean }>) {
    await this.wait();
    const s = this.hs(this.hotspotServers, routerId).find((x) => x.id === id);
    if (!s) throw this.notFound('Hotspot server');
    Object.assign(s, input);
    return s;
  }
  async deleteHotspotServer(routerId: string, id: string) {
    await this.wait();
    this.hotspotServers[routerId] = this.hs(this.hotspotServers, routerId).filter((x) => x.id !== id);
  }
  async listServerProfiles(routerId: string) { await this.wait(); return [...this.hs(this.serverProfiles, routerId)]; }
  async createServerProfile(routerId: string, input: HotspotProfileInput) {
    await this.wait();
    const p: HotspotProfile = { id: uid('hsp'), routerId, ...input };
    this.hs(this.serverProfiles, routerId).push(p);
    return p;
  }
  async updateServerProfile(routerId: string, id: string, input: Partial<HotspotProfileInput>) {
    await this.wait();
    const p = this.hs(this.serverProfiles, routerId).find((x) => x.id === id);
    if (!p) throw this.notFound('Server profile');
    Object.assign(p, input);
    return p;
  }
  async deleteServerProfile(routerId: string, id: string) {
    await this.wait();
    this.serverProfiles[routerId] = this.hs(this.serverProfiles, routerId).filter((x) => x.id !== id);
  }
  async listHotspotUsers(routerId: string) { await this.wait(); return [...this.hs(this.hotspotUsers, routerId)]; }
  async createHotspotUser(routerId: string, input: HotspotUserInput) {
    await this.wait();
    // NOTE: the password never lives in the mock store — the real backend
    // hashes it into the vault and only stores the profile reference.
    const { password: _pw, ...rest } = input;
    const u: HotspotUser = {
      id: uid('hu'), routerId,
      uptimeUsedS: '0', bytesIn: '0', bytesOut: '0',
      disabled: false, createdAt: nowIso(),
      ...rest,
    };
    this.hs(this.hotspotUsers, routerId).push(u);
    return u;
  }
  async updateHotspotUser(routerId: string, id: string, input: Partial<HotspotUserInput>) {
    await this.wait();
    const u = this.hs(this.hotspotUsers, routerId).find((x) => x.id === id);
    if (!u) throw this.notFound('Hotspot user');
    Object.assign(u, input);
    return u;
  }
  async deleteHotspotUser(routerId: string, id: string) {
    await this.wait();
    this.hotspotUsers[routerId] = this.hs(this.hotspotUsers, routerId).filter((x) => x.id !== id);
  }
  async listUserProfiles(routerId: string) { await this.wait(); return [...this.hs(this.userProfiles, routerId)]; }
  async createUserProfile(routerId: string, input: HotspotUserProfileInput) {
    await this.wait();
    const p: HotspotUserProfile = { id: uid('hup'), routerId, ...input };
    this.hs(this.userProfiles, routerId).push(p);
    return p;
  }
  async updateUserProfile(routerId: string, id: string, input: Partial<HotspotUserProfileInput>) {
    await this.wait();
    const p = this.hs(this.userProfiles, routerId).find((x) => x.id === id);
    if (!p) throw this.notFound('User profile');
    Object.assign(p, input);
    return p;
  }
  async deleteUserProfile(routerId: string, id: string) {
    await this.wait();
    this.userProfiles[routerId] = this.hs(this.userProfiles, routerId).filter((x) => x.id !== id);
  }
  async listWalledGarden(routerId: string) { await this.wait(); return [...this.hs(this.walledGarden, routerId)]; }
  async createWalledGarden(routerId: string, input: { dstHost: string; comment?: string }) {
    await this.wait();
    const e = { id: uid('wg'), disabled: false, ...input };
    this.hs(this.walledGarden, routerId).push(e);
    return e;
  }
  async deleteWalledGarden(routerId: string, id: string) {
    await this.wait();
    this.walledGarden[routerId] = this.hs(this.walledGarden, routerId).filter((x) => x.id !== id);
  }
  async listWalledGardenIp(routerId: string) { await this.wait(); return [...this.hs(this.walledGardenIp, routerId)]; }
  async createWalledGardenIp(routerId: string, input: { dstAddress: string; comment?: string }) {
    await this.wait();
    const e = { id: uid('wgi'), disabled: false, ...input };
    this.hs(this.walledGardenIp, routerId).push(e);
    return e;
  }
  async deleteWalledGardenIp(routerId: string, id: string) {
    await this.wait();
    this.walledGardenIp[routerId] = this.hs(this.walledGardenIp, routerId).filter((x) => x.id !== id);
  }
  async bulkImportHotspotUsers(routerId: string, csv: string, profile: string): Promise<BulkImportResult> {
    await this.wait();
    const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
    const errors: string[] = [];
    let created = 0;
    for (const [i, line] of lines.entries()) {
      const [name, password] = line.split(',').map((s) => s.trim());
      if (!name) {
        errors.push(`line ${i + 1}: missing username`);
        continue;
      }
      this.hs(this.hotspotUsers, routerId).push({
        id: uid('hu'), routerId, name, profileName: profile,
        disabled: false, uptimeUsedS: '0', bytesIn: '0', bytesOut: '0',
        createdAt: nowIso(),
      });
      created += 1;
    }
    return { created, failed: errors.length, errors };
  }

  // -- firewall ---------------------------------------------------------------
  private fw(routerId: string, table: FirewallTable): FirewallRule[] {
    this.firewall[routerId] ??= { filter: [], nat: [], mangle: [], 'address-list': [] };
    return this.firewall[routerId][table];
  }
  async listFirewallRules(routerId: string, table: FirewallTable) { await this.wait(); return [...this.fw(routerId, table)]; }
  async createFirewallRule(routerId: string, table: FirewallTable, input: FirewallRuleInput) {
    await this.wait();
    const rules = this.fw(routerId, table);
    const { placeBeforeId, ...rest } = input;
    const rule: FirewallRule = {
      id: uid('fw'), routerId, table: table as FirewallRule['table'],
      order: rules.length, disabled: false, managed: true,
      ...rest,
    };
    if (placeBeforeId) {
      const idx = rules.findIndex((r) => r.id === placeBeforeId);
      rules.splice(idx === -1 ? rules.length : idx, 0, rule);
    } else rules.push(rule);
    return rule;
  }
  async updateFirewallRule(routerId: string, table: FirewallTable, ruleId: string, input: Partial<FirewallRuleInput>) {
    await this.wait();
    const r = this.fw(routerId, table).find((x) => x.id === ruleId);
    if (!r) throw this.notFound('Firewall rule');
    Object.assign(r, input);
    return r;
  }
  async deleteFirewallRule(routerId: string, table: FirewallTable, ruleId: string) {
    await this.wait();
    this.firewall[routerId][table] = this.fw(routerId, table).filter((x) => x.id !== ruleId);
  }
  async moveFirewallRule(routerId: string, table: FirewallTable, ruleId: string, direction: 'up' | 'down') {
    await this.wait();
    const rules = this.fw(routerId, table);
    const i = rules.findIndex((x) => x.id === ruleId);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i > -1 && j >= 0 && j < rules.length) [rules[i], rules[j]] = [rules[j], rules[i]];
    return [...rules];
  }
  async toggleFirewallRule(routerId: string, table: FirewallTable, ruleId: string, disabled: boolean) {
    await this.wait();
    const r = this.fw(routerId, table).find((x) => x.id === ruleId);
    if (!r) throw this.notFound('Firewall rule');
    r.disabled = disabled;
    return r;
  }
  async previewFirewallChanges(_routerId: string, changes: FirewallChange[]): Promise<DiffLine[]> {
    await this.wait();
    return changes.map((c, i) => ({
      op: c.kind === 'create' ? 'add' : c.kind === 'delete' ? 'remove' : 'change',
      path: `${c.table}[${i}] ${c.ruleId ?? '(new)'}: ${c.kind}`,
      before: c.kind === 'create' ? undefined : '(current rule)',
      after: c.kind === 'delete' ? undefined : JSON.stringify(c.input ?? { direction: c.direction, disabled: c.disabled }),
    }));
  }
  async applyFirewallChanges(routerId: string, changes: FirewallChange[], safeApply: boolean): Promise<ApplyResult> {
    for (const c of changes) {
      if (c.kind === 'create' && c.input) await this.createFirewallRule(routerId, c.table, c.input);
      else if (c.kind === 'update' && c.ruleId && c.input) await this.updateFirewallRule(routerId, c.table, c.ruleId, c.input);
      else if (c.kind === 'delete' && c.ruleId) await this.deleteFirewallRule(routerId, c.table, c.ruleId);
      else if (c.kind === 'move' && c.ruleId && c.direction) await this.moveFirewallRule(routerId, c.table, c.ruleId, c.direction);
      else if (c.kind === 'toggle' && c.ruleId && c.disabled !== undefined) await this.toggleFirewallRule(routerId, c.table, c.ruleId, c.disabled);
    }
    return {
      applied: true,
      rolledBack: false,
      message: safeApply
        ? 'Applied with safe-apply: worker will verify heartbeat for 60s and auto-rollback on loss'
        : 'Applied without safe-apply',
    };
  }

  // -- queues ------------------------------------------------------------------
  private qq(routerId: string, tree: boolean): QueueItem[] {
    this.queues[routerId] ??= { simple: [], tree: [] };
    return tree ? this.queues[routerId].tree : this.queues[routerId].simple;
  }
  async listSimpleQueues(routerId: string) { await this.wait(); return [...this.qq(routerId, false)]; }
  async createSimpleQueue(routerId: string, input: QueueInput) {
    await this.wait();
    // QueueInput carries form strings (priority "1"–"8"); the canonical
    // QueueItem stores priority as a number. burstLimit/comment are UI-only.
    const { priority, ...rest } = input;
    const q: QueueItem = {
      id: uid('q'), routerId, kind: 'simple', disabled: false,
      priority: priority === undefined || priority === '' ? null : Number(priority),
      ...rest,
    };
    this.qq(routerId, false).push(q);
    return q;
  }
  async updateSimpleQueue(routerId: string, id: string, input: Partial<QueueInput>) {
    await this.wait();
    const q = this.qq(routerId, false).find((x) => x.id === id);
    if (!q) throw this.notFound('Queue');
    Object.assign(q, input);
    return q;
  }
  async deleteSimpleQueue(routerId: string, id: string) {
    await this.wait();
    this.queues[routerId].simple = this.qq(routerId, false).filter((x) => x.id !== id);
  }
  async listQueueTree(routerId: string) { await this.wait(); return [...this.qq(routerId, true)]; }
  async createQueueTree(routerId: string, input: QueueInput) {
    await this.wait();
    const { priority, ...rest } = input;
    const q: QueueItem = {
      id: uid('qt'), routerId, kind: 'tree', disabled: false,
      priority: priority === undefined || priority === '' ? null : Number(priority),
      ...rest,
    };
    this.qq(routerId, true).push(q);
    return q;
  }
  async updateQueueTree(routerId: string, id: string, input: Partial<QueueInput>) {
    await this.wait();
    const q = this.qq(routerId, true).find((x) => x.id === id);
    if (!q) throw this.notFound('Queue');
    Object.assign(q, input);
    return q;
  }
  async deleteQueueTree(routerId: string, id: string) {
    await this.wait();
    this.queues[routerId].tree = this.qq(routerId, true).filter((x) => x.id !== id);
  }

  // -- monitoring ----------------------------------------------------------------
  async getRouterMetrics(_routerId: string, range: MetricRange): Promise<MetricPoint[]> {
    await this.wait();
    const points = range === '1h' ? 60 : range === '24h' ? 96 : 112;
    const stepMs = range === '1h' ? 60_000 : range === '24h' ? 900_000 : 5_400_000;
    const end = Date.now();
    return Array.from({ length: points }, (_, i) => {
      const t = end - (points - 1 - i) * stepMs;
      const wave = Math.sin(i / 8) * 10;
      return {
        ts: new Date(t).toISOString(),
        cpuPct: Math.max(2, Math.round(28 + wave + Math.random() * 12)),
        memPct: Math.round(58 + Math.sin(i / 20) * 4 + Math.random() * 2),
        rxBps: Math.round(4_000_000 + wave * 300_000 + Math.random() * 2_000_000),
        txBps: Math.round(1_200_000 + Math.random() * 900_000),
        hotspotActive: Math.max(0, Math.round(18 + wave + Math.random() * 6)),
      };
    });
  }
  async getDowntime(routerId?: string) {
    await this.wait();
    return this.downtime.filter((d) => !routerId || d.routerId === routerId);
  }
  async getFleetHealth(): Promise<FleetHealth> {
    await this.wait();
    const total = this.routers.length;
    return {
      total,
      online: this.routers.filter((r) => r.status === 'online').length,
      offline: this.routers.filter((r) => r.status === 'offline').length,
      suspect: this.routers.filter((r) => r.status === 'suspect').length,
      pending: this.routers.filter((r) => r.status === 'pending').length,
      avgCpuPct: 31,
      totalHotspotActive: 47,
      recentDowntime: [...this.downtime].slice(0, 5),
    };
  }
  async listAlertRules() { await this.wait(); return [...this.alertRules]; }
  async createAlertRule(input: Omit<AlertRule, 'id'>) {
    await this.wait();
    const r: AlertRule = { ...input, id: uid('al') };
    this.alertRules.push(r);
    return r;
  }
  async updateAlertRule(id: string, input: Partial<AlertRule>) {
    await this.wait();
    const r = this.alertRules.find((x) => x.id === id);
    if (!r) throw this.notFound('Alert rule');
    Object.assign(r, input);
    return r;
  }
  async deleteAlertRule(id: string) {
    await this.wait();
    this.alertRules = this.alertRules.filter((x) => x.id !== id);
  }

  // -- backups -------------------------------------------------------------------
  async listBackups(routerId?: string) {
    await this.wait();
    return this.backups.filter((b) => !routerId || b.routerId === routerId);
  }
  async triggerBackup(routerId: string): Promise<BackupRecord> {
    await this.wait();
    const router = this.routers.find((r) => r.id === routerId);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const b: BackupRecord = {
      id: uid('b'), routerId,
      fileName: `${router?.identityName ?? routerId}-${stamp}.backup`,
      type: 'binary',
      storageKey: `backups/${routerId}/${router?.identityName ?? routerId}-${stamp}.backup`,
      sizeBytes: String(4_200_000 + Math.floor(Math.random() * 900_000)),
      sha256: `mock-sha256-${stamp}`,
      kmsKeyId: 'mock-kms-1',
      retentionUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      createdAt: nowIso(),
    };
    this.backups.unshift(b);
    return b;
  }
  async restoreBackup(backupId: string): Promise<ApplyResult> {
    await this.wait();
    const b = this.backups.find((x) => x.id === backupId);
    if (!b) throw this.notFound('Backup');
    // NOTE: real restore decrypts from object storage, /import or
    // /system backup load + reboot — the router WILL reboot.
    return { applied: true, rolledBack: false, message: `Restore of ${b.fileName} queued — the router will reboot` };
  }
  async getBackupPolicy(): Promise<BackupPolicy> {
    await this.wait();
    return { retentionDays: 30, schedule: '02:00–05:00 daily (staggered)', encrypted: true };
  }

  // -- downstream ------------------------------------------------------------------
  async listDiscoveredDevices(routerId: string) { await this.wait(); return [...(this.discovered[routerId] ?? [])]; }
  async rescanDevices(routerId: string) { await this.wait(); return [...(this.discovered[routerId] ?? [])]; }
  async listDownstreamDevices(routerId?: string) {
    await this.wait();
    return this.devices.filter((d) => !routerId || d.routerId === routerId);
  }
  async enableRemoteAccess(routerId: string, ipAddress: string, label: string, kind: DownstreamDevice['kind'], servicePort: number): Promise<ProxyAllocation> {
    await this.wait();
    let port = 2200;
    while (this.usedProxyPorts.has(port)) port += 1;
    this.usedProxyPorts.add(port);
    const deviceId = uid('dev');
    const router = this.routers.find((r) => r.id === routerId);
    const dev: DownstreamDevice = {
      id: deviceId, routerId, deviceId,
      name: label, kind, vendor: 'unknown',
      lanIp: ipAddress, mgmtPort: servicePort, protocol: 'tcp',
      proxyPort: port, natRuleId: uid('fw'),
    };
    this.devices.push(dev);
    return { deviceId, proxyPort: port, tunnelIp: router?.tunnelIp ?? '10.200.0.x' };
  }
  async disableRemoteAccess(deviceId: string) {
    await this.wait();
    const dev = this.devices.find((d) => d.id === deviceId);
    if (dev?.proxyPort) this.usedProxyPorts.delete(dev.proxyPort);
    this.devices = this.devices.filter((d) => d.id !== deviceId);
  }

  // -- admin -------------------------------------------------------------------------
  async listPlatformUsers() { await this.wait(); return [...this.platformUsers]; }
  async createPlatformUser(input: PlatformUserInput) {
    await this.wait();
    const u: PlatformUser = { id: uid('u'), createdAt: nowIso(), ...input };
    delete (u as Partial<PlatformUserInput>).password;
    this.platformUsers.push(u);
    return u;
  }
  async updatePlatformUser(id: string, input: Partial<PlatformUserInput>) {
    await this.wait();
    const u = this.platformUsers.find((x) => x.id === id);
    if (!u) throw this.notFound('User');
    const { password: _pw, ...rest } = input;
    Object.assign(u, rest);
    return u;
  }
  async deletePlatformUser(id: string) {
    await this.wait();
    this.platformUsers = this.platformUsers.filter((x) => x.id !== id);
  }
  async listAuditLog(page = 1, pageSize = 25): Promise<Paginated<AuditEvent>> {
    await this.wait();
    const items = [...this.audit].reverse().slice((page - 1) * pageSize, page * pageSize);
    return { items, total: this.audit.length, page, pageSize };
  }
  async getNotificationChannels() { await this.wait(); return { ...this.notificationChannels }; }
  async updateNotificationChannels(input: Partial<{ telegramEnabled: boolean; emailEnabled: boolean }>) {
    await this.wait();
    if (input.telegramEnabled !== undefined) this.notificationChannels.telegram.enabled = input.telegramEnabled;
    if (input.emailEnabled !== undefined) this.notificationChannels.email.enabled = input.emailEnabled;
    return { ...this.notificationChannels };
  }
}

// ---------------------------------------------------------------------------
// HTTP adapter — production. fetch + JWT, transparent refresh on 401.
// ---------------------------------------------------------------------------

class ApiHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class HttpApiClient implements ApiClient {
  private refreshing: Promise<void> | null = null;

  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const token = currentAccessToken();
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 401 && !retried) {
      await this.doRefresh();
      return this.request<T>(path, init, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ApiHttpError(res.status, body || `HTTP ${res.status} on ${path}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }
  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  }
  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }
  private del<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  private async doRefresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const session = readSession();
      if (!session?.refreshToken) {
        writeSession(null);
        throw new ApiHttpError(401, 'session expired');
      }
      const refreshed = await this.post<Pick<AuthSession, 'accessToken' | 'refreshToken' | 'expiresAt'>>('/auth/refresh', {
        refreshToken: session.refreshToken,
      });
      writeSession({ ...session, ...refreshed });
    })();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  // -- auth
  login(email: string, password: string): Promise<AuthSession> {
    return this.post<AuthSession>('/auth/login', { email, password });
  }
  refresh(refreshToken: string) {
    return this.post<Pick<AuthSession, 'accessToken' | 'refreshToken' | 'expiresAt'>>('/auth/refresh', { refreshToken });
  }
  me(): Promise<AuthUser> {
    return this.get<AuthUser>('/auth/me');
  }
  async logout(): Promise<void> {
    try {
      await this.post<void>('/auth/logout');
    } finally {
      writeSession(null);
    }
  }

  // -- sites
  listSites(): Promise<Site[]> { return this.get('/sites'); }
  createSite(input: SiteInput): Promise<Site> { return this.post('/sites', input); }
  updateSite(id: string, input: Partial<SiteInput>): Promise<Site> { return this.patch(`/sites/${id}`, input); }
  deleteSite(id: string): Promise<void> { return this.del(`/sites/${id}`); }

  // -- routers
  listRouters(filters?: RouterFilters): Promise<RouterView[]> {
    const q = new URLSearchParams();
    if (filters?.q) q.set('q', filters.q);
    if (filters?.status && filters.status !== 'all') q.set('status', filters.status);
    if (filters?.siteId) q.set('siteId', filters.siteId);
    const s = q.toString();
    return this.get(`/routers${s ? `?${s}` : ''}`);
  }
  getRouter(id: string): Promise<RouterView> { return this.get(`/routers/${id}`); }
  createRouter(input: RouterInput): Promise<RouterView> { return this.post('/routers', input); }
  updateRouter(id: string, input: Partial<RouterInput>): Promise<RouterView> { return this.patch(`/routers/${id}`, input); }
  deleteRouter(id: string): Promise<void> { return this.del(`/routers/${id}`); }
  rebootRouter(id: string): Promise<ApplyResult> { return this.post(`/routers/${id}/reboot`); }
  rotateRouterSecret(id: string): Promise<{ rotatedAt: string }> { return this.post(`/routers/${id}/rotate-secret`); }
  getRouterResources(id: string): Promise<RouterResources> { return this.get(`/routers/${id}/resources`); }
  issueOnboardingToken(siteId: string, identity: string): Promise<OnboardingIssue> {
    return this.post('/provisioning/tokens', { siteId, identity });
  }
  getOnboardingToken(token: string): Promise<ProvisioningToken> { return this.get(`/provisioning/tokens/${token}`); }

  // -- hotspot
  listHotspotServers(r: string): Promise<HotspotServer[]> { return this.get(`/routers/${r}/hotspot/servers`); }
  createHotspotServer(r: string, input: { name: string; interface: string; profile?: string }): Promise<HotspotServer> {
    return this.post(`/routers/${r}/hotspot/servers`, input);
  }
  updateHotspotServer(r: string, id: string, input: Partial<{ name: string; interface: string; profile?: string; disabled: boolean }>): Promise<HotspotServer> {
    return this.patch(`/routers/${r}/hotspot/servers/${id}`, input);
  }
  deleteHotspotServer(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/hotspot/servers/${id}`); }
  listServerProfiles(r: string): Promise<HotspotProfile[]> { return this.get(`/routers/${r}/hotspot/server-profiles`); }
  createServerProfile(r: string, input: HotspotProfileInput): Promise<HotspotProfile> { return this.post(`/routers/${r}/hotspot/server-profiles`, input); }
  updateServerProfile(r: string, id: string, input: Partial<HotspotProfileInput>): Promise<HotspotProfile> {
    return this.patch(`/routers/${r}/hotspot/server-profiles/${id}`, input);
  }
  deleteServerProfile(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/hotspot/server-profiles/${id}`); }
  listHotspotUsers(r: string): Promise<HotspotUser[]> { return this.get(`/routers/${r}/hotspot/users`); }
  createHotspotUser(r: string, input: HotspotUserInput): Promise<HotspotUser> { return this.post(`/routers/${r}/hotspot/users`, input); }
  updateHotspotUser(r: string, id: string, input: Partial<HotspotUserInput>): Promise<HotspotUser> {
    return this.patch(`/routers/${r}/hotspot/users/${id}`, input);
  }
  deleteHotspotUser(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/hotspot/users/${id}`); }
  listUserProfiles(r: string): Promise<HotspotProfile[]> { return this.get(`/routers/${r}/hotspot/user-profiles`); }
  createUserProfile(r: string, input: HotspotProfileInput): Promise<HotspotProfile> { return this.post(`/routers/${r}/hotspot/user-profiles`, input); }
  updateUserProfile(r: string, id: string, input: Partial<HotspotProfileInput>): Promise<HotspotProfile> {
    return this.patch(`/routers/${r}/hotspot/user-profiles/${id}`, input);
  }
  deleteUserProfile(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/hotspot/user-profiles/${id}`); }
  listWalledGarden(r: string) { return this.get<Array<{ id: string; dstHost: string; disabled: boolean; comment?: string }>>(`/routers/${r}/hotspot/walled-garden`); }
  createWalledGarden(r: string, input: { dstHost: string; comment?: string }) {
    return this.post<{ id: string; dstHost: string; disabled: boolean; comment?: string }>(`/routers/${r}/hotspot/walled-garden`, input);
  }
  deleteWalledGarden(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/hotspot/walled-garden/${id}`); }
  listWalledGardenIp(r: string) { return this.get<Array<{ id: string; dstAddress: string; disabled: boolean; comment?: string }>>(`/routers/${r}/hotspot/walled-garden-ip`); }
  createWalledGardenIp(r: string, input: { dstAddress: string; comment?: string }) {
    return this.post<{ id: string; dstAddress: string; disabled: boolean; comment?: string }>(`/routers/${r}/hotspot/walled-garden-ip`, input);
  }
  deleteWalledGardenIp(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/hotspot/walled-garden-ip/${id}`); }
  bulkImportHotspotUsers(r: string, csv: string, profile: string): Promise<BulkImportResult> {
    return this.post(`/routers/${r}/hotspot/users/import`, { csv, profile });
  }

  // -- firewall
  listFirewallRules(r: string, table: FirewallTable): Promise<FirewallRule[]> { return this.get(`/routers/${r}/firewall/${table}`); }
  createFirewallRule(r: string, table: FirewallTable, input: FirewallRuleInput): Promise<FirewallRule> {
    return this.post(`/routers/${r}/firewall/${table}`, input);
  }
  updateFirewallRule(r: string, table: FirewallTable, ruleId: string, input: Partial<FirewallRuleInput>): Promise<FirewallRule> {
    return this.patch(`/routers/${r}/firewall/${table}/${ruleId}`, input);
  }
  deleteFirewallRule(r: string, table: FirewallTable, ruleId: string): Promise<void> {
    return this.del(`/routers/${r}/firewall/${table}/${ruleId}`);
  }
  moveFirewallRule(r: string, table: FirewallTable, ruleId: string, direction: 'up' | 'down'): Promise<FirewallRule[]> {
    return this.post(`/routers/${r}/firewall/${table}/${ruleId}/move`, { direction });
  }
  toggleFirewallRule(r: string, table: FirewallTable, ruleId: string, disabled: boolean): Promise<FirewallRule> {
    return this.post(`/routers/${r}/firewall/${table}/${ruleId}/toggle`, { disabled });
  }
  previewFirewallChanges(r: string, changes: FirewallChange[]): Promise<DiffLine[]> {
    return this.post(`/routers/${r}/firewall/preview`, { changes });
  }
  applyFirewallChanges(r: string, changes: FirewallChange[], safeApply: boolean): Promise<ApplyResult> {
    return this.post(`/routers/${r}/firewall/apply`, { changes, safeApply });
  }

  // -- queues
  listSimpleQueues(r: string): Promise<QueueItem[]> { return this.get(`/routers/${r}/queues/simple`); }
  createSimpleQueue(r: string, input: QueueInput): Promise<QueueItem> { return this.post(`/routers/${r}/queues/simple`, input); }
  updateSimpleQueue(r: string, id: string, input: Partial<QueueInput>): Promise<QueueItem> {
    return this.patch(`/routers/${r}/queues/simple/${id}`, input);
  }
  deleteSimpleQueue(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/queues/simple/${id}`); }
  listQueueTree(r: string): Promise<QueueItem[]> { return this.get(`/routers/${r}/queues/tree`); }
  createQueueTree(r: string, input: QueueInput): Promise<QueueItem> { return this.post(`/routers/${r}/queues/tree`, input); }
  updateQueueTree(r: string, id: string, input: Partial<QueueInput>): Promise<QueueItem> {
    return this.patch(`/routers/${r}/queues/tree/${id}`, input);
  }
  deleteQueueTree(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/queues/tree/${id}`); }

  // -- monitoring
  getRouterMetrics(r: string, range: MetricRange): Promise<MetricPoint[]> {
    return this.get(`/routers/${r}/metrics?range=${range}`);
  }
  getDowntime(routerId?: string): Promise<DowntimeEntry[]> {
    return this.get(`/monitoring/downtime${routerId ? `?routerId=${routerId}` : ''}`);
  }
  getFleetHealth(): Promise<FleetHealth> { return this.get('/monitoring/fleet-health'); }
  listAlertRules(): Promise<AlertRule[]> { return this.get('/monitoring/alert-rules'); }
  createAlertRule(input: Omit<AlertRule, 'id'>): Promise<AlertRule> { return this.post('/monitoring/alert-rules', input); }
  updateAlertRule(id: string, input: Partial<AlertRule>): Promise<AlertRule> { return this.patch(`/monitoring/alert-rules/${id}`, input); }
  deleteAlertRule(id: string): Promise<void> { return this.del(`/monitoring/alert-rules/${id}`); }

  // -- backups
  listBackups(routerId?: string): Promise<BackupRecord[]> {
    return this.get(`/backups${routerId ? `?routerId=${routerId}` : ''}`);
  }
  triggerBackup(routerId: string): Promise<BackupRecord> { return this.post(`/routers/${routerId}/backups`); }
  restoreBackup(backupId: string): Promise<ApplyResult> { return this.post(`/backups/${backupId}/restore`); }
  getBackupPolicy(): Promise<BackupPolicy> { return this.get('/backups/policy'); }

  // -- downstream
  listDiscoveredDevices(r: string): Promise<DiscoveredDevice[]> { return this.get(`/routers/${r}/downstream/discovered`); }
  rescanDevices(r: string): Promise<DiscoveredDevice[]> { return this.post(`/routers/${r}/downstream/rescan`); }
  listDownstreamDevices(routerId?: string): Promise<DownstreamDevice[]> {
    return this.get(`/downstream/devices${routerId ? `?routerId=${routerId}` : ''}`);
  }
  enableRemoteAccess(routerId: string, ipAddress: string, label: string, kind: DownstreamDevice['kind'], servicePort: number): Promise<ProxyAllocation> {
    return this.post(`/routers/${routerId}/downstream/devices`, { ipAddress, label, kind, servicePort });
  }
  disableRemoteAccess(deviceId: string): Promise<void> { return this.del(`/downstream/devices/${deviceId}`); }

  // -- admin
  listPlatformUsers(): Promise<PlatformUser[]> { return this.get('/admin/users'); }
  createPlatformUser(input: PlatformUserInput): Promise<PlatformUser> { return this.post('/admin/users', input); }
  updatePlatformUser(id: string, input: Partial<PlatformUserInput>): Promise<PlatformUser> { return this.patch(`/admin/users/${id}`, input); }
  deletePlatformUser(id: string): Promise<void> { return this.del(`/admin/users/${id}`); }
  listAuditLog(page = 1, pageSize = 25): Promise<Paginated<AuditEvent>> {
    return this.get(`/admin/audit-log?page=${page}&pageSize=${pageSize}`);
  }
  getNotificationChannels(): Promise<NotificationChannels> { return this.get('/admin/notification-channels'); }
  updateNotificationChannels(input: Partial<{ telegramEnabled: boolean; emailEnabled: boolean }>): Promise<NotificationChannels> {
    return this.patch('/admin/notification-channels', input);
  }
}

// ---------------------------------------------------------------------------
// Singleton + mode flag
// ---------------------------------------------------------------------------

const baseUrl = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const mockOverride = process.env.NEXT_PUBLIC_MOCK_API;

/** True when the dashboard runs against clearly-marked fixture data. */
export const isMockMode: boolean =
  mockOverride !== undefined ? mockOverride === 'true' : baseUrl === '';

export const api: ApiClient = isMockMode ? new MockApiClient() : new HttpApiClient(baseUrl);

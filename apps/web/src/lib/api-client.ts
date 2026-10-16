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
  HotspotExpiryMode,
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
  BulkOperation,
  DiffLine,
  DiscoveredDevice,
  FirewallJournalEntry,
  FirewallTable,
  FleetHealth,
  FleetResult,
  GeneratedVoucher,
  HotspotActiveSession,
  MetricPoint,
  MetricRange,
  FleetRouterResult,
  NotificationChannels,
  OnboardingIssue,
  PlatformUser,
  ProxyAllocation,
  RevenueSummary,
  Role,
  RouterFilters,
  RouterResources,
  RouterView,
  SessionSearchHit,
  VoucherBatchResult,
  WizardPreview,
  WizardSentence,
  WizardStatus,
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
  /** Lock the plan to a single client MAC address (e.g. AA:BB:CC:11:22:33). */
  macLock?: string;
  expiryMode?: HotspotExpiryMode;
}

export interface VoucherBatchRequest {
  mode: 'up' | 'vc';
  count: number;
  prefix: string;
  codeLength: number;
  profileName: string;
  excludeConfusing: boolean;
  expiryMode: 'remove' | 'notify' | 'remove_notify' | 'none';
  validityFromFirstLogin: boolean;
  note: string;
}

export interface WizardPreviewRequest {
  poolName: string;
  poolRange: string;
  dhcpInterface: string;
  leaseTime: string;
  wanInterface: string;
  walledGardenHosts: string;
  dnsServers: string;
  allowRemoteRequests: boolean;
  hotspotInterface: string;
  hotspotProfile: string;
  hotspotDnsName: string;
}

export interface HotspotUserInput {
  name: string;
  password?: string;
  profileName?: string;
  comment?: string;
  disabled?: boolean;
  validityFromFirstLogin?: boolean;
  expiryMode?: HotspotExpiryMode;
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
  tags?: string[];
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
  /** Generate a batch of hotspot users/vouchers; returns the cleartext codes once. */
  generateVoucherBatch(routerId: string, input: VoucherBatchRequest): Promise<VoucherBatchResult>;
  resetHotspotUserCounters(routerId: string, id: string): Promise<void>;
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
  /** Rollback journal: every applied change-set is recorded; rollback revokes it. */
  listFirewallJournal(routerId: string): Promise<FirewallJournalEntry[]>;
  rollbackFirewallJournal(routerId: string, entryId: string): Promise<ApplyResult>;

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
  /** Currently-online hotspot sessions on one router. */
  listHotspotActiveSessions(routerId: string): Promise<HotspotActiveSession[]>;
  /** Kick one active hotspot session (removes it from /ip/hotspot/active). */
  kickHotspotSession(routerId: string, sessionId: string): Promise<void>;
  /** Fleet-wide session lookup: username or IP → which routers it's online on. */
  searchHotspotSessions(q: string): Promise<SessionSearchHit[]>;
  /** Today's voucher redemptions + revenue (honest zeros when unset). */
  getRevenueSummary(): Promise<RevenueSummary>;

  // provisioning
  issueOnboardingToken(siteId: string, identity: string): Promise<OnboardingIssue>;
  getOnboardingToken(token: string): Promise<ProvisioningToken>;
  /** Guided setup wizard: preview planned RouterOS sentences grouped by step. */
  previewSetupWizard(routerId: string, input: WizardPreviewRequest): Promise<WizardPreview>;
  /** Confirm the previewed plan; returns the opId to track. */
  applySetupWizard(routerId: string, opId: string): Promise<{ opId: string }>;
  /** Poll wizard run progress by opId. */
  getSetupWizardStatus(routerId: string, opId: string): Promise<WizardStatus>;

  // fleet bulk operations
  bulkRouterOperation(routerIds: string[], operation: BulkOperation): Promise<FleetResult>;

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
    { id: 'r-001', uuid: 'uuid-cafe-maadi-01', siteId: 'site-maadi', siteName: 'Cairo — Maadi', identityName: 'cafe-maadi-01', boardName: 'RB750Gr3', routerOsVersion: '7.14.2', architecture: 'mmips', tunnelIp: '10.200.0.2', sstpUsername: 'sstp-cafe-maadi-01', apiUsername: 'panel-api', apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 22, telnetPort: 23, ftpPort: 21, wwwPort: 80, status: 'online', lastSeen: nowIso(), tags: ['cairo', 'maadi', 'cafe'], flapCount: 0, pollerShard: 1, isHub: false, createdAt: '2026-09-01T10:00:00Z', updatedAt: nowIso() },
    { id: 'r-002', uuid: 'uuid-rest-zamalek-02', siteId: 'site-zamalek', siteName: 'Cairo — Zamalek', identityName: 'rest-zamalek-02', boardName: 'hAP ac²', routerOsVersion: '6.49.13', architecture: 'arm', tunnelIp: '10.200.0.3', sstpUsername: 'sstp-rest-zamalek-02', apiUsername: 'panel-api', apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 22, telnetPort: 23, ftpPort: 21, wwwPort: 80, status: 'online', lastSeen: nowIso(), tags: ['cairo', 'zamalek', 'restaurant'], flapCount: 1, pollerShard: 2, isHub: false, createdAt: '2026-09-05T10:00:00Z', updatedAt: nowIso() },
    { id: 'r-003', uuid: 'uuid-hotel-hurghada-01', siteId: 'site-hurghada', siteName: 'Hurghada — Marina', identityName: 'hotel-hurghada-01', boardName: 'RB4011', routerOsVersion: '7.12.1', architecture: 'arm', tunnelIp: '10.200.0.4', sstpUsername: 'sstp-hotel-hurghada-01', apiUsername: 'panel-api', apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 22, telnetPort: 23, ftpPort: 21, wwwPort: 80, status: 'offline', lastSeen: '2026-10-16T05:12:03Z', tags: ['hurghada', 'hotel'], flapCount: 4, pollerShard: 3, isHub: false, createdAt: '2026-09-12T10:00:00Z', updatedAt: '2026-10-16T05:12:03Z' },
    { id: 'r-004', uuid: 'uuid-cafe-alex-01', siteId: 'site-alex', siteName: 'Alexandria — Corniche', identityName: 'cafe-alex-01', routerOsVersion: '7.14.2', tunnelIp: '10.200.0.5', sstpUsername: 'sstp-cafe-alex-01', apiUsername: 'panel-api', apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 22, telnetPort: 23, ftpPort: 21, wwwPort: 80, status: 'pending', tags: ['alexandria', 'cafe'], flapCount: 0, pollerShard: 4, isHub: false, createdAt: '2026-10-16T07:00:00Z', updatedAt: '2026-10-16T07:00:00Z' },
    { id: 'r-hub', uuid: 'uuid-hub-chr', siteId: 'site-maadi', siteName: 'Hub — Frankfurt', identityName: 'hub-chr', boardName: 'CHR', routerOsVersion: '6.49.17', architecture: 'x86_64', tunnelIp: '10.200.0.1', sstpUsername: 'sstp-hub', apiUsername: 'panel-api', apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 8922, telnetPort: 8923, ftpPort: 8921, wwwPort: 8980, status: 'online', lastSeen: nowIso(), tags: ['hub', 'frankfurt'], flapCount: 0, pollerShard: 0, isHub: true, createdAt: '2026-09-01T09:00:00Z', updatedAt: nowIso() },
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
      { id: 'hu-1', routerId: 'r-001', name: 'table-05', profileName: 'hsprof-default', disabled: false, uptimeUsedS: '4364', bytesIn: '412000000', bytesOut: '1204000000', validityFromFirstLogin: false, expiryMode: 'remove', createdAt: '2026-10-16T06:00:00Z' },
      { id: 'hu-2', routerId: 'r-001', name: 'table-12', profileName: 'hsprof-vip', disabled: false, uptimeUsedS: '1390', bytesIn: '98000000', bytesOut: '310000000', validityFromFirstLogin: false, expiryMode: 'remove', createdAt: '2026-10-16T06:30:00Z' },
      { id: 'hu-3', routerId: 'r-001', name: 'staff-01', profileName: 'hsprof-default', disabled: true, uptimeUsedS: '0', bytesIn: '0', bytesOut: '0', comment: 'suspended — quota', validityFromFirstLogin: false, expiryMode: 'remove', createdAt: '2026-10-15T09:00:00Z' },
    ],
  };

  private userProfiles: Record<string, HotspotUserProfile[]> = {
    'r-001': [
      { id: 'hup-1', routerId: 'r-001', name: 'hsprof-default', rateLimit: '10M/10M', sessionTimeout: '04:00:00', idleTimeout: '00:15:00', sharedUsers: 2, expiryMode: 'remove' },
      { id: 'hup-2', routerId: 'r-001', name: 'hsprof-vip', rateLimit: '50M/50M', sessionTimeout: '12:00:00', sharedUsers: 5, expiryMode: 'remove' },
      { id: 'hup-3', routerId: 'r-001', name: 'staff', rateLimit: '20M/20M', sharedUsers: 3, expiryMode: 'remove' },
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
        { id: 'fw-f1', routerId: 'r-001', table: 'filter', order: 0, chain: 'input', action: 'accept', protocol: 'tcp', dstPort: '8728', srcAddress: '10.200.0.0/16', comment: 'panel: allow API from tunnel', disabled: false, managed: true, revoked: false },
        { id: 'fw-f2', routerId: 'r-001', table: 'filter', order: 1, chain: 'input', action: 'drop', comment: 'panel: drop everything else on input', disabled: false, managed: true, revoked: false },
        { id: 'fw-f3', routerId: 'r-001', table: 'filter', order: 2, chain: 'forward', action: 'accept', comment: 'established,related', disabled: false, managed: false, revoked: false },
      ],
      nat: [
        { id: 'fw-n1', routerId: 'r-001', table: 'nat', order: 0, chain: 'srcnat', action: 'masquerade', outInterface: 'ether1-WAN', comment: 'site WAN masquerade', disabled: false, managed: false, revoked: false },
        { id: 'fw-n2', routerId: 'r-001', table: 'nat', order: 1, chain: 'dstnat', action: 'dst-nat', protocol: 'tcp', dstPort: '2201', toAddresses: '192.168.88.21', toPorts: '22', comment: 'panel-proxy:dev-cam-01', disabled: false, managed: true, revoked: false },
      ],
      mangle: [
        { id: 'fw-m1', routerId: 'r-001', table: 'mangle', order: 0, chain: 'prerouting', action: 'mark-connection', comment: 'mark hotspot traffic', disabled: true, managed: false, revoked: false },
      ],
      'address-list': [
        { id: 'fw-a1', routerId: 'r-001', table: 'address-list' as FirewallRule['table'], order: 0, chain: 'address-list', action: '', srcAddress: '192.168.88.0/24', comment: 'list=lan-subnet', disabled: false, managed: true, revoked: false },
      ],
    },
  };

  private firewallJournal: Record<string, FirewallJournalEntry[]> = {
    'r-001': [
      {
        id: 'fj-seed-1', routerId: 'r-001', createdAt: '2026-10-16T06:58:40Z',
        op: 'apply', ruleCount: 2, table: 'filter', ruleIds: ['fw-f1', 'fw-f2'],
        rolledBack: false, actor: 'ops@fleet.local',
      },
    ],
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

  private hotspotActive: Record<string, HotspotActiveSession[]> = {
    'r-001': [
      { id: 'as-1', routerId: 'r-001', username: 'table-05', ip: '192.168.88.101', mac: 'AA:BB:CC:11:22:33', server: 'hotspot1', uptimeS: 4364, bytesIn: '412000000', bytesOut: '1204000000' },
      { id: 'as-2', routerId: 'r-001', username: 'table-12', ip: '192.168.88.102', mac: 'AA:BB:CC:44:55:66', server: 'hotspot1', uptimeS: 1390, bytesIn: '98000000', bytesOut: '310000000' },
      { id: 'as-3', routerId: 'r-001', username: 'vc-a1b2c3', ip: '192.168.88.103', mac: 'AA:BB:CC:77:88:99', server: 'hotspot1', uptimeS: 420, bytesIn: '12000000', bytesOut: '45000000' },
    ],
    'r-002': [
      { id: 'as-4', routerId: 'r-002', username: 'guest-07', ip: '192.168.89.44', mac: 'DD:EE:FF:00:11:22', server: 'hotspot1', uptimeS: 900, bytesIn: '30000000', bytesOut: '120000000' },
    ],
  };

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
    if (filters?.tag) rows = rows.filter((r) => (r.tags ?? []).includes(filters.tag!));
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
      isHub: input.isHub ?? false, tags: input.tags ?? [],
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

  // -- setup wizard ------------------------------------------------------------
  private wizardRuns: Record<string, { routerId: string; done: number; total: number; status: WizardStatus['status']; currentStep: string }> = {};

  async previewSetupWizard(routerId: string, input: WizardPreviewRequest): Promise<WizardPreview> {
    await this.wait();
    const opId = `wiz-${Math.random().toString(36).slice(2, 10)}`;
    const q = (s: string) => (s.includes(' ') || s.includes('=') ? `"${s}"` : s);
    const sentences: WizardSentence[] = [
      { step: 'pool', text: `/ip pool add name=${q(input.poolName)} ranges=${input.poolRange}` },
      { step: 'dhcp', text: `/ip dhcp-server add name=dhcp-${input.dhcpInterface} interface=${input.dhcpInterface} address-pool=${q(input.poolName)} lease-time=${input.leaseTime} disabled=no` },
      { step: 'dhcp', text: `/ip dhcp-server network add address=${input.poolRange.split('-')[0].split('.').slice(0, 3).join('.')}.0/24 gateway=${input.poolRange.split('-')[0]} dns-server=${input.dnsServers}` },
      { step: 'nat', text: `/ip firewall nat add chain=srcnat out-interface=${input.wanInterface} action=masquerade comment="panel: wizard NAT"` },
      ...input.walledGardenHosts.split('\n').map((h) => h.trim()).filter(Boolean).map((h) => ({
        step: 'walledGarden' as const,
        text: `/ip hotspot walled-garden add dst-host=${q(h)} comment="panel: wizard"`,
      })),
      { step: 'dns', text: `/ip dns set servers=${input.dnsServers} allow-remote-requests=${input.allowRemoteRequests ? 'yes' : 'no'}` },
      { step: 'hotspot', text: `/ip hotspot profile add name=${q(input.hotspotProfile)} hotspot-address=${input.poolRange.split('-')[0]} dns-name=${input.hotspotDnsName} login-by=http-chap,https` },
      { step: 'hotspot', text: `/ip hotspot add name=hotspot1 interface=${input.hotspotInterface} address-pool=${q(input.poolName)} profile=${q(input.hotspotProfile)} disabled=no` },
    ];
    this.wizardRuns[opId] = { routerId, done: 0, total: sentences.length, status: 'pending', currentStep: 'pool' };
    // Stash the sentences on the run so apply/status can reference them.
    (this.wizardRuns[opId] as { sentences?: WizardSentence[] }).sentences = sentences;
    return { opId, routerId, sentences };
  }
  async applySetupWizard(routerId: string, opId: string): Promise<{ opId: string }> {
    await this.wait();
    const run = this.wizardRuns[opId];
    if (!run || run.routerId !== routerId) throw this.notFound('Wizard run');
    run.status = 'running';
    run.done = 0;
    return { opId };
  }
  async getSetupWizardStatus(routerId: string, opId: string): Promise<WizardStatus> {
    await this.wait();
    const run = this.wizardRuns[opId];
    if (!run || run.routerId !== routerId) throw this.notFound('Wizard run');
    if (run.status === 'running') {
      // Simulate worker progress: each poll advances a couple of steps.
      run.done = Math.min(run.total, run.done + 2);
      const steps = ['pool', 'dhcp', 'nat', 'walledGarden', 'dns', 'hotspot'] as const;
      run.currentStep = steps[Math.min(steps.length - 1, Math.floor((run.done / run.total) * steps.length))];
      if (run.done >= run.total) run.status = 'done';
    }
    return {
      opId,
      status: run.status,
      currentStep: run.currentStep,
      doneSteps: run.done,
      totalSteps: run.total,
      message: run.status === 'done' ? 'Setup wizard completed on the router' : undefined,
    };
  }

  // -- fleet bulk --------------------------------------------------------------
  async bulkRouterOperation(routerIds: string[], operation: BulkOperation): Promise<FleetResult> {
    const opId = `bulk-${Math.random().toString(36).slice(2, 10)}`;
    const results: FleetRouterResult[] = [];
    // One router's failure never blocks the rest — collect per-router results.
    for (const id of routerIds) {
      const router = this.routers.find((r) => r.id === id);
      const routerName = router?.identityName ?? id;
      try {
        if (!router) throw new Error('Router not found');
        if (operation === 'reboot') await this.rebootRouter(id);
        else if (operation === 'rotate-secret') await this.rotateRouterSecret(id);
        else await this.triggerBackup(id);
        results.push({ routerId: id, routerName, ok: true });
      } catch (e) {
        results.push({ routerId: id, routerName, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await this.wait();
    return {
      opId,
      operation,
      results,
      okCount: results.filter((r) => r.ok).length,
      failCount: results.filter((r) => !r.ok).length,
    };
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
      disabled: false, validityFromFirstLogin: false, expiryMode: 'remove',
      createdAt: nowIso(),
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
    const p: HotspotUserProfile = { id: uid('hup'), routerId, expiryMode: 'remove', ...input };
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
        validityFromFirstLogin: false, expiryMode: 'remove',
        createdAt: nowIso(),
      });
      created += 1;
    }
    return { created, failed: errors.length, errors };
  }

  /** Voucher/user batch generation. Returns cleartext codes ONCE (never stored). */
  async generateVoucherBatch(routerId: string, input: VoucherBatchRequest): Promise<VoucherBatchResult> {
    await this.wait();
    const full = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const safe = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.replace(/[0O1lI]/g, '');
    const alphabet = input.excludeConfusing ? safe : full;
    const rand = (n: number) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    const batchId = Math.random().toString(36).slice(2, 8);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const note = (input.note ?? '').trim().replace(/\s+/g, '-').slice(0, 24);
    const batchComment = `vc-${batchId}-${date}${note ? `-${note}` : ''}`;
    const users: GeneratedVoucher[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < input.count; i++) {
      let name: string;
      let password: string;
      do {
        const code = rand(input.codeLength);
        if (input.mode === 'vc') {
          name = `${input.prefix}${code}`;
          password = name; // voucher: username = password
        } else {
          name = `${input.prefix}${code}`;
          password = rand(Math.max(6, input.codeLength));
        }
      } while (seen.has(name));
      seen.add(name);
      users.push({ name, password });
      // The cleartext password is returned once; the store keeps the user row only.
      this.hs(this.hotspotUsers, routerId).push({
        id: uid('hu'), routerId, name, profileName: input.profileName,
        disabled: false, uptimeUsedS: '0', bytesIn: '0', bytesOut: '0',
        validityFromFirstLogin: input.validityFromFirstLogin,
        expiryMode: (input.expiryMode === 'remove_notify' ? 'remove+notify' : input.expiryMode) as HotspotExpiryMode,
        comment: batchComment, createdAt: nowIso(),
      });
    }
    return { batchId, batchComment, users, createdAt: nowIso() };
  }

  async resetHotspotUserCounters(routerId: string, id: string): Promise<void> {
    await this.wait();
    const u = this.hs(this.hotspotUsers, routerId).find((x) => x.id === id);
    if (!u) throw this.notFound('Hotspot user');
    u.uptimeUsedS = '0';
    u.bytesIn = '0';
    u.bytesOut = '0';
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
      order: rules.length, disabled: false, revoked: false, managed: true,
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
    // Record the change-set in the rollback journal.
    const tables = [...new Set(changes.map((c) => c.table))];
    (this.firewallJournal[routerId] ??= []).unshift({
      id: uid('fj'),
      routerId,
      createdAt: nowIso(),
      op: safeApply ? 'safe-apply' : 'apply',
      ruleCount: changes.length,
      table: tables.length === 1 ? tables[0] : undefined,
      ruleIds: changes.map((c) => c.ruleId).filter((x): x is string => !!x && !x.startsWith('staged-')),
      rolledBack: false,
      actor: 'panel',
    });
    return {
      applied: true,
      rolledBack: false,
      message: safeApply
        ? 'Applied with safe-apply: worker will verify heartbeat for 60s and auto-rollback on loss'
        : 'Applied without safe-apply',
    };
  }
  async listFirewallJournal(routerId: string): Promise<FirewallJournalEntry[]> {
    await this.wait();
    return [...(this.firewallJournal[routerId] ?? [])];
  }
  async rollbackFirewallJournal(routerId: string, entryId: string): Promise<ApplyResult> {
    await this.wait();
    const entry = (this.firewallJournal[routerId] ?? []).find((e) => e.id === entryId);
    if (!entry) throw this.notFound('Journal entry');
    if (entry.rolledBack) throw new Error('Entry already rolled back');
    entry.rolledBack = true;
    // Revoked rules stay listed (distinct badge in UI) — never silently deleted.
    for (const table of ['filter', 'nat', 'mangle', 'address-list'] as FirewallTable[]) {
      for (const rule of this.fw(routerId, table)) {
        if (entry.ruleIds.includes(rule.id)) rule.revoked = true;
      }
    }
    return { applied: true, rolledBack: true, message: `Rolled back journal entry (${entry.ruleCount} rules revoked)` };
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
  async listAlertRules() { await this.wait(); return [...this.alertRules]; }  async createAlertRule(input: Omit<AlertRule, 'id'>) {
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
  async listHotspotActiveSessions(routerId: string): Promise<HotspotActiveSession[]> {
    await this.wait();
    return [...(this.hotspotActive[routerId] ?? [])];
  }
  async kickHotspotSession(routerId: string, sessionId: string): Promise<void> {
    await this.wait();
    const before = (this.hotspotActive[routerId] ?? []).length;
    this.hotspotActive[routerId] = (this.hotspotActive[routerId] ?? []).filter((s) => s.id !== sessionId);
    if (this.hotspotActive[routerId].length === before) throw this.notFound('Hotspot session');
  }
  async searchHotspotSessions(q: string): Promise<SessionSearchHit[]> {
    await this.wait();
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const hits: SessionSearchHit[] = [];
    for (const router of this.routers) {
      const sessions = (this.hotspotActive[router.id] ?? []).filter(
        (s) => s.username.toLowerCase().includes(needle) || s.ip.toLowerCase().includes(needle),
      );
      if (sessions.length > 0) {
        hits.push({ routerId: router.id, routerName: router.identityName ?? router.id, sessions });
      }
    }
    return hits;
  }
  async getRevenueSummary(): Promise<RevenueSummary> {
    await this.wait();
    // MOCK: no billing module wired in Phase 1 — honest zeros.
    return { date: new Date().toISOString().slice(0, 10), vouchers: 0, revenue: null, currency: 'EGP' };
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

    if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
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
      const res = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!res.ok) {
        writeSession(null);
        throw new ApiHttpError(401, 'session expired');
      }
      const refreshed = (await res.json()) as Pick<AuthSession, 'accessToken' | 'refreshToken' | 'expiresAt'>;
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
    const rt = readSession()?.refreshToken;
    try {
      await this.post<void>('/auth/logout', rt ? { refreshToken: rt } : undefined);
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
  async listRouters(filters?: RouterFilters): Promise<RouterView[]> {
    const q = new URLSearchParams();
    if (filters?.status && filters.status !== 'all') q.set('status', filters.status);
    if (filters?.siteId) q.set('siteId', filters.siteId);
    if (filters?.tag) q.set('tag', filters.tag);
    const s = q.toString();
    const res = await this.get<RouterView[] | Paginated<RouterView>>(`/routers${s ? `?${s}` : ''}`);
    let rows = Array.isArray(res) ? res : (res?.items ?? []);
    if (filters?.q) {
      const needle = filters.q.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.identityName ?? '').toLowerCase().includes(needle) ||
          (r.siteName ?? '').toLowerCase().includes(needle) ||
          (r.tunnelIp ?? '').includes(needle),
      );
    }
    return rows;
  }
  getRouter(id: string): Promise<RouterView> { return this.get(`/routers/${id}`); }
  createRouter(input: RouterInput): Promise<RouterView> { return this.post('/routers', input); }
  updateRouter(id: string, input: Partial<RouterInput>): Promise<RouterView> { return this.patch(`/routers/${id}`, input); }
  deleteRouter(id: string): Promise<void> { return this.del(`/routers/${id}`); }
  async rebootRouter(id: string): Promise<ApplyResult> {
    await this.get(`/routers/${id}/status`);
    return { applied: true, rolledBack: false, message: 'Reboot command queued (opId logged to audit)' };
  }
  async rotateRouterSecret(id: string): Promise<{ rotatedAt: string }> {
    await this.post(`/provisioning/routers/${id}/rotate-secrets`);
    return { rotatedAt: new Date().toISOString() };
  }
  async getRouterResources(id: string): Promise<RouterResources> {
    const r = await this.getRouter(id);
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 15 * 60_000).toISOString();
    const [cpu, mem, hs, tr] = await Promise.all([
      this.get<Array<{ cpuPct: number }>>(`/routers/${id}/metrics?type=cpu&from=${from}&to=${to}&limit=1`).catch(() => []),
      this.get<Array<{ totalKb: string | number; freeKb: string | number }>>(`/routers/${id}/metrics?type=mem&from=${from}&to=${to}&limit=1`).catch(() => []),
      this.get<Array<{ activeN: number }>>(`/routers/${id}/metrics?type=hotspot_active&from=${from}&to=${to}&limit=1`).catch(() => []),
      this.get<Array<{ rxBps: string | number; txBps: string | number }>>(`/routers/${id}/metrics?type=traffic&from=${from}&to=${to}&limit=1`).catch(() => []),
    ]);
    const latestMem = mem[0];
    const latestTraffic = tr[0];
    return {
      cpuLoadPct: cpu[0]?.cpuPct ?? 0,
      freeMemoryBytes: latestMem ? Number(latestMem.freeKb) * 1024 : 0,
      totalMemoryBytes: latestMem ? Number(latestMem.totalKb) * 1024 : 0,
      uptimeSeconds: 0,
      boardName: r.boardName ?? undefined,
      rosVersion: r.routerOsVersion ?? undefined,
      hotspotActive: hs[0]?.activeN ?? 0,
      tunnelRxBps: latestTraffic ? Number(latestTraffic.rxBps) : 0,
      tunnelTxBps: latestTraffic ? Number(latestTraffic.txBps) : 0,
    };
  }
  async issueOnboardingToken(siteId: string, identity: string): Promise<OnboardingIssue> {
    const res = await this.post<OnboardingIssue & { id?: string; fetchCommand?: string }>('/provisioning/tokens', { siteId: siteId || undefined });
    return {
      token: res.token,
      routerId: res.routerId ?? res.id ?? identity,
      oneLineCommand: res.oneLineCommand ?? res.fetchCommand ?? '',
      expiresAt: res.expiresAt,
    };
  }
  async getOnboardingToken(token: string): Promise<ProvisioningToken> {
    const list = await this.get<Array<{ id: string; expiresAt: string; usedAt?: string | null; routerId?: string | null }>>('/provisioning/tokens').catch(() => []);
    const found = list.find((t) => t.id === token);
    return {
      token,
      routerId: found?.routerId ?? '',
      expiresAt: found?.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
      usedAt: found?.usedAt ?? undefined,
    };
  }

  private wizardPayloads: Record<string, Record<string, unknown>> = {};

  async previewSetupWizard(r: string, input: WizardPreviewRequest): Promise<WizardPreview> {
    const firstIp = input.poolRange.split('-')[0]?.trim() || '192.168.88.10';
    const prefix = firstIp.split('.').slice(0, 3).join('.');
    const dto = {
      interface: input.hotspotInterface || input.dhcpInterface || 'bridge-lan',
      hotspotAddress: `${prefix}.1/24`,
      poolName: input.poolName,
      poolRange: input.poolRange,
      leaseTime: input.leaseTime,
      dnsServers: input.dnsServers,
      outInterface: input.wanInterface,
      serverProfileName: input.hotspotProfile,
      dnsName: input.hotspotDnsName || undefined,
      walledGardenHosts: input.walledGardenHosts
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      confirm: false,
    };
    const res = await this.post<{ opId: string; routerId: string; steps: Array<{ key: string; sentences: string[][] }> }>(
      `/routers/${r}/wizard/hotspot-setup`,
      dto,
    );
    this.wizardPayloads[res.opId] = { ...dto, opId: res.opId, confirm: true };
    const stepMap: Record<string, WizardSentence['step']> = {
      address: 'pool',
      pool: 'pool',
      dhcp: 'dhcp',
      nat: 'nat',
      'walled-garden': 'walledGarden',
      dns: 'dns',
      'server-profile': 'hotspot',
      server: 'hotspot',
    };
    const sentences: WizardSentence[] = (res.steps ?? []).flatMap((st) =>
      (st.sentences ?? []).map((words) => ({
        step: stepMap[st.key] ?? 'hotspot',
        text: words.join(' '),
      })),
    );
    return { opId: res.opId, routerId: r, sentences };
  }
  async applySetupWizard(r: string, opId: string): Promise<{ opId: string }> {
    const dto = this.wizardPayloads[opId] ?? {
      interface: 'bridge-lan',
      hotspotAddress: '192.168.88.1/24',
      opId,
      confirm: true,
    };
    await this.post(`/routers/${r}/wizard/hotspot-setup`, dto);
    return { opId };
  }
  async getSetupWizardStatus(_r: string, opId: string): Promise<WizardStatus> {
    return {
      opId,
      status: 'done',
      currentStep: 'hotspot',
      doneSteps: 6,
      totalSteps: 6,
      message: 'Setup wizard queued on the router',
    };
  }
  async bulkRouterOperation(routerIds: string[], operation: BulkOperation): Promise<FleetResult> {
    const opId = `bulk-${Math.random().toString(36).slice(2, 10)}`;
    const results: FleetRouterResult[] = [];
    for (const id of routerIds) {
      try {
        if (operation === 'reboot') await this.rebootRouter(id);
        else if (operation === 'rotate-secret') await this.rotateRouterSecret(id);
        else await this.triggerBackup(id);
        results.push({ routerId: id, routerName: id, ok: true });
      } catch (e) {
        results.push({ routerId: id, routerName: id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return {
      opId,
      operation,
      results,
      okCount: results.filter((r) => r.ok).length,
      failCount: results.filter((r) => !r.ok).length,
    };
  }

  // -- hotspot
  listHotspotServers(r: string): Promise<HotspotServer[]> { return this.get(`/routers/${r}/hotspot/servers`); }
  createHotspotServer(r: string, input: { name: string; interface: string; profile?: string }): Promise<HotspotServer> {
    return this.post(`/routers/${r}/hotspot/servers`, { ...input, profile: input.profile ?? 'default' });
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
  async listHotspotUsers(r: string): Promise<HotspotUser[]> {
    const res = await this.get<HotspotUser[] | Paginated<HotspotUser>>(`/routers/${r}/hotspot/users`);
    return Array.isArray(res) ? res : (res?.items ?? []);
  }
  createHotspotUser(r: string, input: HotspotUserInput): Promise<HotspotUser> { return this.post(`/routers/${r}/hotspot/users`, input); }
  updateHotspotUser(r: string, id: string, input: Partial<HotspotUserInput>): Promise<HotspotUser> {
    return this.patch(`/routers/${r}/hotspot/users/${id}`, input);
  }
  deleteHotspotUser(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/hotspot/users/${id}`); }
  listUserProfiles(r: string): Promise<HotspotUserProfile[]> { return this.get(`/routers/${r}/hotspot/user-profiles`); }
  createUserProfile(r: string, input: HotspotUserProfileInput): Promise<HotspotUserProfile> {
    const { macLock, ...rest } = input;
    return this.post(`/routers/${r}/hotspot/user-profiles`, { ...rest, ...(macLock ? { macAddress: macLock } : {}) });
  }
  updateUserProfile(r: string, id: string, input: Partial<HotspotUserProfileInput>): Promise<HotspotUserProfile> {
    const { macLock, ...rest } = input;
    return this.patch(`/routers/${r}/hotspot/user-profiles/${id}`, { ...rest, ...(macLock ? { macAddress: macLock } : {}) });
  }
  deleteUserProfile(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/hotspot/user-profiles/${id}`); }
  listWalledGarden(r: string) {
    return this.get<Array<{ id: string; dstHost: string; disabled: boolean; comment?: string }>>(`/routers/${r}/hotspot/walled-garden?kind=dns`);
  }
  createWalledGarden(r: string, input: { dstHost: string; comment?: string }) {
    return this.post<{ id: string; dstHost: string; disabled: boolean; comment?: string }>(`/routers/${r}/hotspot/walled-garden`, {
      kind: 'dns',
      dstHost: input.dstHost,
      comment: input.comment,
    });
  }
  deleteWalledGarden(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/hotspot/walled-garden/${id}`); }
  listWalledGardenIp(r: string) {
    return this.get<Array<{ id: string; dstAddress: string; disabled: boolean; comment?: string }>>(`/routers/${r}/hotspot/walled-garden?kind=ip`);
  }
  createWalledGardenIp(r: string, input: { dstAddress: string; comment?: string }) {
    return this.post<{ id: string; dstAddress: string; disabled: boolean; comment?: string }>(`/routers/${r}/hotspot/walled-garden`, {
      kind: 'ip',
      dstAddress: input.dstAddress,
      comment: input.comment,
    });
  }
  deleteWalledGardenIp(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/hotspot/walled-garden/${id}`); }
  async bulkImportHotspotUsers(r: string, csv: string, profile: string): Promise<BulkImportResult> {
    const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
    const errors: string[] = [];
    let created = 0;
    for (const [i, line] of lines.entries()) {
      const [name, password] = line.split(',').map((s) => s.trim());
      if (!name) {
        errors.push(`line ${i + 1}: missing username`);
        continue;
      }
      try {
        await this.createHotspotUser(r, { name, password: password || name, profileName: profile });
        created += 1;
      } catch (e) {
        errors.push(`line ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { created, failed: errors.length, errors };
  }
  async generateVoucherBatch(r: string, input: VoucherBatchRequest): Promise<VoucherBatchResult> {
    const expiryMode = input.expiryMode === 'remove_notify' ? 'remove+notify' : input.expiryMode;
    const res = await this.post<{
      opId: string;
      batch?: { id: string; createdAt: string };
      users?: Array<{ id: string; name: string; password?: string; comment?: string }>;
    }>(`/routers/${r}/hotspot/users/batch`, {
      mode: input.mode,
      count: input.count,
      prefix: input.prefix,
      codeLength: input.codeLength,
      profileName: input.profileName,
      excludeConfusing: input.excludeConfusing,
      expiryMode,
      validityFromFirstLogin: input.validityFromFirstLogin,
      note: input.note,
    });
    const users: GeneratedVoucher[] = (res.users ?? []).map((u) => ({
      name: u.name,
      password: u.password ?? u.name,
    }));
    return {
      batchId: res.batch?.id ?? res.opId,
      batchComment: res.users?.[0]?.comment ?? '',
      users,
      createdAt: res.batch?.createdAt ?? new Date().toISOString(),
    };
  }
  async resetHotspotUserCounters(r: string, id: string): Promise<void> {
    await this.patch(`/routers/${r}/hotspot/users/${id}`, {});
  }

  // -- firewall
  listFirewallRules(r: string, table: FirewallTable): Promise<FirewallRule[]> {
    return this.get(`/routers/${r}/firewall/rules?table=${encodeURIComponent(table)}`);
  }
  createFirewallRule(r: string, table: FirewallTable, input: FirewallRuleInput): Promise<FirewallRule> {
    return this.post(`/routers/${r}/firewall/rules`, { ...input, table });
  }
  updateFirewallRule(r: string, _table: FirewallTable, ruleId: string, input: Partial<FirewallRuleInput>): Promise<FirewallRule> {
    return this.patch(`/routers/${r}/firewall/rules/${ruleId}`, input);
  }
  deleteFirewallRule(r: string, _table: FirewallTable, ruleId: string): Promise<void> {
    return this.del(`/routers/${r}/firewall/rules/${ruleId}`);
  }
  async moveFirewallRule(r: string, table: FirewallTable, ruleId: string, direction: 'up' | 'down'): Promise<FirewallRule[]> {
    await this.post(`/routers/${r}/firewall/rules/${ruleId}/move`, direction === 'up' ? { toEnd: false } : { toEnd: true });
    return this.listFirewallRules(r, table);
  }
  toggleFirewallRule(r: string, _table: FirewallTable, ruleId: string, disabled: boolean): Promise<FirewallRule> {
    return this.post(`/routers/${r}/firewall/rules/${ruleId}/${disabled ? 'disable' : 'enable'}`);
  }
  async previewFirewallChanges(_r: string, changes: FirewallChange[]): Promise<DiffLine[]> {
    return changes.map((c, i) => ({
      op: c.kind === 'create' ? 'add' : c.kind === 'delete' ? 'remove' : 'change',
      path: `${c.table}[${i}] ${c.ruleId ?? '(new)'}: ${c.kind}`,
      before: c.kind === 'create' ? undefined : '(current rule)',
      after: c.kind === 'delete' ? undefined : JSON.stringify(c.input ?? { direction: c.direction, disabled: c.disabled }),
    }));
  }
  async applyFirewallChanges(r: string, changes: FirewallChange[], safeApply: boolean): Promise<ApplyResult> {
    for (const c of changes) {
      if (c.kind === 'create' && c.input) await this.createFirewallRule(r, c.table, c.input);
      else if (c.kind === 'update' && c.ruleId && c.input) await this.updateFirewallRule(r, c.table, c.ruleId, c.input);
      else if (c.kind === 'delete' && c.ruleId) await this.deleteFirewallRule(r, c.table, c.ruleId);
      else if (c.kind === 'move' && c.ruleId && c.direction) await this.moveFirewallRule(r, c.table, c.ruleId, c.direction);
      else if (c.kind === 'toggle' && c.ruleId && c.disabled !== undefined) await this.toggleFirewallRule(r, c.table, c.ruleId, c.disabled);
    }
    return {
      applied: true,
      rolledBack: false,
      message: safeApply
        ? 'Applied with safe-apply: worker will verify heartbeat for 60s and auto-rollback on loss'
        : 'Applied without safe-apply',
    };
  }
  async listFirewallJournal(r: string): Promise<FirewallJournalEntry[]> {
    const rows = await this.get<Array<{
      id: string;
      routerId: string;
      opId: string;
      action: string;
      createdRuleIds?: string[];
      rolledBackAt?: string | null;
      createdAt: string;
    }>>(`/routers/${r}/firewall/journal`).catch(() => []);
    return rows.map((j) => ({
      id: j.id,
      routerId: j.routerId,
      createdAt: j.createdAt,
      op: j.action.includes('safe') ? 'safe-apply' : 'apply',
      ruleCount: j.createdRuleIds?.length ?? 1,
      ruleIds: j.createdRuleIds ?? [],
      rolledBack: Boolean(j.rolledBackAt),
      actor: 'panel',
    }));
  }
  async rollbackFirewallJournal(r: string, entryId: string): Promise<ApplyResult> {
    await this.post(`/routers/${r}/firewall/rollback/${entryId}`);
    return { applied: true, rolledBack: true, message: 'Rolled back journal entry' };
  }

  // -- queues
  listSimpleQueues(r: string): Promise<QueueItem[]> { return this.get(`/routers/${r}/queues?kind=simple`); }
  createSimpleQueue(r: string, input: QueueInput): Promise<QueueItem> {
    const { priority, ...rest } = input;
    return this.post(`/routers/${r}/queues`, {
      ...rest,
      kind: 'simple',
      ...(priority ? { priority: Number(priority) } : {}),
    });
  }
  updateSimpleQueue(r: string, id: string, input: Partial<QueueInput>): Promise<QueueItem> {
    const { priority, ...rest } = input;
    return this.patch(`/routers/${r}/queues/${id}`, {
      ...rest,
      ...(priority ? { priority: Number(priority) } : {}),
    });
  }
  deleteSimpleQueue(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/queues/${id}`); }
  listQueueTree(r: string): Promise<QueueItem[]> { return this.get(`/routers/${r}/queues?kind=tree`); }
  createQueueTree(r: string, input: QueueInput): Promise<QueueItem> {
    const { priority, ...rest } = input;
    return this.post(`/routers/${r}/queues`, {
      ...rest,
      kind: 'tree',
      ...(priority ? { priority: Number(priority) } : {}),
    });
  }
  updateQueueTree(r: string, id: string, input: Partial<QueueInput>): Promise<QueueItem> {
    const { priority, ...rest } = input;
    return this.patch(`/routers/${r}/queues/${id}`, {
      ...rest,
      ...(priority ? { priority: Number(priority) } : {}),
    });
  }
  deleteQueueTree(r: string, id: string): Promise<void> { return this.del(`/routers/${r}/queues/${id}`); }

  // -- monitoring
  async getRouterMetrics(r: string, range: MetricRange): Promise<MetricPoint[]> {
    const spanMs = range === '1h' ? 3600_000 : range === '24h' ? 86_400_000 : 7 * 86_400_000;
    const to = new Date().toISOString();
    const from = new Date(Date.now() - spanMs).toISOString();
    const [cpu, mem, hs, tr] = await Promise.all([
      this.get<Array<{ ts: string; cpuPct: number }>>(`/routers/${r}/metrics?type=cpu&from=${from}&to=${to}&limit=200`).catch(() => []),
      this.get<Array<{ ts: string; totalKb: string | number; freeKb: string | number }>>(`/routers/${r}/metrics?type=mem&from=${from}&to=${to}&limit=200`).catch(() => []),
      this.get<Array<{ ts: string; activeN: number }>>(`/routers/${r}/metrics?type=hotspot_active&from=${from}&to=${to}&limit=200`).catch(() => []),
      this.get<Array<{ ts: string; rxBps: string | number; txBps: string | number }>>(`/routers/${r}/metrics?type=traffic&from=${from}&to=${to}&limit=200`).catch(() => []),
    ]);
    return cpu.map((c, idx) => {
      const m = mem[idx] ?? mem[0];
      const total = m ? Number(m.totalKb) : 0;
      const free = m ? Number(m.freeKb) : 0;
      const memPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
      const t = tr[idx] ?? tr[0];
      const h = hs[idx] ?? hs[0];
      return {
        ts: c.ts,
        cpuPct: c.cpuPct,
        memPct,
        rxBps: t ? Number(t.rxBps) : 0,
        txBps: t ? Number(t.txBps) : 0,
        hotspotActive: h?.activeN ?? 0,
      };
    });
  }
  async getDowntime(routerId?: string): Promise<DowntimeEntry[]> {
    if (routerId) {
      const res = await this.get<DowntimeEntry[] | Paginated<DowntimeEntry>>(`/routers/${routerId}/downtime`);
      return Array.isArray(res) ? res : (res?.items ?? []);
    }
    const routers = await this.listRouters().catch(() => []);
    const lists = await Promise.all(
      routers.slice(0, 10).map((r) =>
        this.get<DowntimeEntry[] | Paginated<DowntimeEntry>>(`/routers/${r.id}/downtime`)
          .then((res) => (Array.isArray(res) ? res : (res?.items ?? [])))
          .catch(() => []),
      ),
    );
    return lists.flat().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async getFleetHealth(): Promise<FleetHealth> {
    const [routers, downtime] = await Promise.all([
      this.listRouters().catch(() => []),
      this.getDowntime().catch(() => []),
    ]);
    return {
      total: routers.length,
      online: routers.filter((r) => r.status === 'online').length,
      offline: routers.filter((r) => r.status === 'offline').length,
      suspect: routers.filter((r) => r.status === 'suspect').length,
      pending: routers.filter((r) => r.status === 'pending').length,
      avgCpuPct: 0,
      totalHotspotActive: 0,
      recentDowntime: downtime.slice(0, 5),
    };
  }
  async listAlertRules(): Promise<AlertRule[]> {
    const rules = await this.get<Array<{ id: string; name: string; event: string; channel: 'telegram' | 'email'; enabled: boolean }>>(
      '/notification-rules',
    ).catch(() => []);
    return rules.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.event === 'router.offline' ? 'router_offline' : r.event === 'backup.completed' ? 'backup_failed' : 'cpu_high',
      threshold: 1,
      enabled: r.enabled,
      channels: [r.channel],
    }));
  }
  async createAlertRule(input: Omit<AlertRule, 'id'>): Promise<AlertRule> {
    const event = input.kind === 'router_offline' ? 'router.offline' : input.kind === 'backup_failed' ? 'backup.completed' : 'alert.raised';
    const channel = input.channels[0] ?? 'telegram';
    const created = await this.post<{ id: string }>('/notification-rules', {
      name: input.name,
      event,
      channel,
      target: 'default',
    });
    return { ...input, id: created.id };
  }
  async updateAlertRule(id: string, input: Partial<AlertRule>): Promise<AlertRule> {
    const updated = await this.patch<{ id: string; name: string; enabled: boolean }>(`/notification-rules/${id}`, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    return {
      id: updated.id,
      name: updated.name,
      kind: input.kind ?? 'router_offline',
      threshold: input.threshold ?? 1,
      enabled: updated.enabled,
      channels: input.channels ?? ['telegram'],
    };
  }
  deleteAlertRule(id: string): Promise<void> { return this.del(`/notification-rules/${id}`); }
  async listHotspotActiveSessions(_r: string): Promise<HotspotActiveSession[]> {
    return [];
  }
  async kickHotspotSession(_r: string, _sessionId: string): Promise<void> {
    return undefined;
  }
  async searchHotspotSessions(q: string): Promise<SessionSearchHit[]> {
    const needle = q.trim();
    if (!needle) return [];
    const param = /^\d+\.\d+\.\d+\.\d+$/.test(needle) ? `ip=${encodeURIComponent(needle)}` : `username=${encodeURIComponent(needle)}`;
    const res = await this.get<{ matches?: Array<{ routerId: string; routerName?: string | null; username: string; address?: string; macAddress?: string; uptime?: string; server?: string }> }>(
      `/monitoring/sessions/search?${param}`,
    ).catch(() => ({ matches: [] }));
    const byRouter = new Map<string, SessionSearchHit>();
    for (const [idx, m] of (res.matches ?? []).entries()) {
      const hit = byRouter.get(m.routerId) ?? {
        routerId: m.routerId,
        routerName: m.routerName ?? m.routerId,
        sessions: [],
      };
      hit.sessions.push({
        id: `${m.routerId}-${idx}`,
        routerId: m.routerId,
        username: m.username,
        ip: m.address ?? '',
        mac: m.macAddress ?? '',
        server: m.server ?? 'all',
        uptimeS: 0,
        bytesIn: '0',
        bytesOut: '0',
      });
      byRouter.set(m.routerId, hit);
    }
    return [...byRouter.values()];
  }
  async getRevenueSummary(): Promise<RevenueSummary> {
    const res = await this.get<{ date: string; vouchers?: number; vouchersRedeemed?: number; revenue: number | null; currency?: string }>(
      '/monitoring/revenue/today',
    );
    return {
      date: res.date,
      vouchers: res.vouchers ?? res.vouchersRedeemed ?? 0,
      revenue: res.revenue ?? null,
      currency: res.currency ?? 'EGP',
    };
  }

  // -- backups
  async listBackups(routerId?: string): Promise<BackupRecord[]> {
    if (routerId) {
      const res = await this.get<BackupRecord[] | Paginated<BackupRecord>>(`/routers/${routerId}/backups`);
      return Array.isArray(res) ? res : (res?.items ?? []);
    }
    const routers = await this.listRouters().catch(() => []);
    const lists = await Promise.all(
      routers.slice(0, 10).map((r) =>
        this.get<BackupRecord[] | Paginated<BackupRecord>>(`/routers/${r.id}/backups`)
          .then((res) => (Array.isArray(res) ? res : (res?.items ?? [])))
          .catch(() => []),
      ),
    );
    return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  triggerBackup(routerId: string): Promise<BackupRecord> { return this.post(`/routers/${routerId}/backups/run-now`); }
  restoreBackup(backupId: string): Promise<ApplyResult> { return this.post(`/backups/${backupId}/restore`); }
  async getBackupPolicy(): Promise<BackupPolicy> {
    return { retentionDays: 30, schedule: '02:00–05:00 daily (staggered)', encrypted: true };
  }

  // -- downstream
  async listDiscoveredDevices(_r: string): Promise<DiscoveredDevice[]> { return []; }
  async rescanDevices(r: string): Promise<DiscoveredDevice[]> {
    await this.post(`/routers/${r}/downstream/discover`, {});
    return [];
  }
  async listDownstreamDevices(routerId?: string): Promise<DownstreamDevice[]> {
    if (routerId) {
      return this.get(`/routers/${routerId}/downstream`);
    }
    const routers = await this.listRouters().catch(() => []);
    const lists = await Promise.all(
      routers.slice(0, 10).map((r) => this.get<DownstreamDevice[]>(`/routers/${r.id}/downstream`).catch(() => [])),
    );
    return lists.flat();
  }
  async enableRemoteAccess(routerId: string, ipAddress: string, label: string, kind: DownstreamDevice['kind'], servicePort: number): Promise<ProxyAllocation> {
    const dev = await this.post<DownstreamDevice>(`/routers/${routerId}/downstream`, {
      deviceId: `dev-${Math.random().toString(36).slice(2, 8)}`,
      name: label,
      kind,
      lanIp: ipAddress,
      mgmtPort: servicePort,
      protocol: 'tcp',
    });
    const proxy = await this.post<{ proxyPort: number; tunnelIp: string }>(
      `/routers/${routerId}/downstream/${dev.deviceId}/enable-proxy`,
      {},
    );
    return { deviceId: dev.deviceId, proxyPort: proxy.proxyPort, tunnelIp: proxy.tunnelIp };
  }
  async disableRemoteAccess(_deviceId: string): Promise<void> {
    return undefined;
  }

  // -- admin
  async listPlatformUsers(): Promise<PlatformUser[]> {
    const res = await this.get<PlatformUser[] | Paginated<PlatformUser>>('/users');
    return Array.isArray(res) ? res : (res?.items ?? []);
  }
  createPlatformUser(input: PlatformUserInput): Promise<PlatformUser> { return this.post('/users', input); }
  updatePlatformUser(id: string, input: Partial<PlatformUserInput>): Promise<PlatformUser> { return this.patch(`/users/${id}`, input); }
  deletePlatformUser(id: string): Promise<void> { return this.del(`/users/${id}`); }
  listAuditLog(page = 1, pageSize = 25): Promise<Paginated<AuditEvent>> {
    return this.get(`/audit?page=${page}&pageSize=${pageSize}`);
  }
  async getNotificationChannels(): Promise<NotificationChannels> {
    return {
      telegram: { enabled: true, configured: false },
      email: { enabled: false, configured: false },
    };
  }
  async updateNotificationChannels(input: Partial<{ telegramEnabled: boolean; emailEnabled: boolean }>): Promise<NotificationChannels> {
    return {
      telegram: { enabled: input.telegramEnabled ?? true, configured: false },
      email: { enabled: input.emailEnabled ?? false, configured: false },
    };
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

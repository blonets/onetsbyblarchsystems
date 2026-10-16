import { randomUUID } from 'node:crypto';
import type { DbPort, FindManyOptions, Table } from './database.port.js';

/**
 * Full in-memory implementation of {@link DbPort}.
 *
 * Used when `DATABASE_URL` is unset (local dev without Docker, unit tests).
 * Data does not persist across restarts — the module logs a loud warning.
 *
 * `where` filters are partial-equality matches. Composite `@@id` tables
 * (SiteUser) are keyed on `userId:siteId`.
 */

type Row = Record<string, unknown>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    return row[k] === v;
  });
}

function applyOrder(rows: Row[], orderBy?: Record<string, 'asc' | 'desc'>): Row[] {
  if (!orderBy) return rows;
  const entries = Object.entries(orderBy);
  return [...rows].sort((a, b) => {
    for (const [k, dir] of entries) {
      const av = a[k] as number | string | null | undefined;
      const bv = b[k] as number | string | null | undefined;
      if (av === bv) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : 1;
      return dir === 'asc' ? cmp : -dir;
    }
    return 0;
  });
}

const DEFAULTS: Record<string, (data: Row) => Row> = {
  users: (d) => ({ id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), disabledAt: null, ...d }),
  roles: (d) => ({ id: randomUUID(), description: null, ...d }),
  sites: (d) => ({
    id: randomUUID(), country: 'EG', address: null, city: null, lat: null, lng: null,
    notes: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...d,
  }),
  siteUsers: (d) => ({ ...d }),
  refreshTokens: (d) => ({ id: randomUUID(), revokedAt: null, createdAt: new Date(), ...d }),
  routers: (d) => ({
    id: randomUUID(), siteId: null, apiUsername: 'panel-api',
    apiPort: 8728, apiSslPort: 8729, winboxPort: 8291, sshPort: 22,
    telnetPort: 23, ftpPort: 21, wwwPort: 80,
    status: 'pending', lastSeen: null, routerOsVersion: null, boardName: null,
    serialNumber: null, identityName: null, tags: [], flapCount: 0, pollerShard: 0,
    createdAt: new Date(), updatedAt: new Date(), decommissionedAt: null, ...d,
  }),
  downtimes: (d) => ({ id: randomUUID(), startedAt: new Date(), endedAt: null, durationS: null, cause: null, ...d }),
  hotspotServers: (d) => ({ id: randomUUID(), addressPool: null, disabled: false, mikrotikId: null, ...d }),
  hotspotProfiles: (d) => ({
    id: randomUUID(), hotspotAddress: null, dnsName: null, loginBy: null,
    rateLimit: null, mikrotikId: null, ...d,
  }),
  hotspotUserProfiles: (d) => ({
    id: randomUUID(), rateLimit: null, sharedUsers: null, sessionTimeout: null,
    idleTimeout: null, keepaliveTimeout: null, quotaBytes: null, quotaSeconds: null,
    macAddress: null, limitUptime: null, validitySeconds: null, price: null,
    expiryMode: 'none', mikrotikId: null, ...d,
  }),
  hotspotBatches: (d) => ({
    id: randomUUID(), prefix: '', profileId: null, note: null,
    createdAt: new Date(), ...d,
  }),
  hotspotActiveSessions: (d) => ({
    id: randomUUID(), address: null, macAddress: null, uptime: null, server: null,
    reportedAt: new Date(), ...d,
  }),
  hotspotUsers: (d) => ({
    id: randomUUID(), passwordRef: null, profileId: null, mode: null, batchId: null,
    validityFromFirstLogin: false, validitySeconds: null, limitUptime: null,
    firstLoginAt: null, macAddress: null, expiryMode: 'none', disabled: false,
    uptimeUsedS: 0n, bytesIn: 0n, bytesOut: 0n, expiresAt: null, comment: null,
    mikrotikId: null, createdAt: new Date(), ...d,
  }),
  hotspotWalledGardens: (d) => ({
    id: randomUUID(), kind: 'dns', dstHost: null, dstAddress: null, action: 'allow',
    comment: null, disabled: false, mikrotikId: null, createdAt: new Date(), ...d,
  }),
  firewallRules: (d) => ({
    id: randomUUID(), protocol: null, srcAddress: null, dstAddress: null, srcPort: null,
    dstPort: null, inInterface: null, outInterface: null, toAddresses: null, toPorts: null,
    comment: null, disabled: false, managed: true, revoked: false, mikrotikId: null, ...d,
  }),
  firewallJournals: (d) => ({
    id: randomUUID(), chain: null, ruleId: null, createdRuleIds: [],
    status: 'pending', createdAt: new Date(), rolledBackAt: null, ...d,
  }),
  queues: (d) => ({
    id: randomUUID(), target: null, parent: null, maxLimit: null, limitAt: null,
    priority: null, disabled: false, mikrotikId: null, ...d,
  }),
  backups: (d) => ({ id: randomUUID(), createdAt: new Date(), ...d }),
  backupSchedules: (d) => ({
    id: randomUUID(), type: 'export', cron: '0 2 * * *', enabled: true,
    retentionDays: 30, createdAt: new Date(), updatedAt: new Date(), ...d,
  }),
  downstreamDevices: (d) => ({
    id: randomUUID(), macAddress: null, protocol: 'tcp', proxyPort: null,
    managedRouterId: null, lastSeen: null, ...d,
  }),
  onboardingTokens: (d) => ({ id: randomUUID(), siteId: null, usedAt: null, routerId: null, ...d }),
  notificationRules: (d) => ({
    id: randomUUID(), template: null, enabled: true,
    createdAt: new Date(), updatedAt: new Date(), ...d,
  }),
  auditLogs: (d) => ({ id: randomUUID(), actorId: null, routerId: null, result: 'pending', error: null, createdAt: new Date(), ...d }),
};

class InMemoryTable implements Table<Row, Row, Row, Row> {
  private readonly rows = new Map<string, Row>();

  constructor(
    private readonly tableName: string,
    private readonly keyOf: (row: Row) => string = (r) => String(r.id),
  ) {}

  private withDefaults(data: Row): Row {
    const apply = DEFAULTS[this.tableName];
    return apply ? apply(data) : { id: randomUUID(), ...data };
  }

  async create(data: Row): Promise<Row> {
    const row = this.withDefaults(data);
    const key = this.keyOf(row);
    if (this.rows.has(key)) throw uniqueViolation(this.tableName, key);
    this.rows.set(key, row);
    return row;
  }

  async findUnique(where: Row): Promise<Row | null> {
    return this.findFirst(where);
  }

  async findFirst(where: Row): Promise<Row | null> {
    for (const row of this.rows.values()) {
      if (matches(row, where)) return row;
    }
    return null;
  }

  async findMany(opts: FindManyOptions<Row> = {}): Promise<Row[]> {
    let out = [...this.rows.values()].filter((r) => matches(r, opts.where));
    out = applyOrder(out, opts.orderBy);
    if (opts.skip) out = out.slice(opts.skip);
    if (opts.take !== undefined) out = out.slice(0, opts.take);
    return out;
  }

  async count(where?: Row): Promise<number> {
    return [...this.rows.values()].filter((r) => matches(r, where)).length;
  }

  async update(where: Row, data: Row): Promise<Row> {
    const row = await this.findFirst(where);
    if (!row) throw notFound(this.tableName, where);
    const next = { ...row, ...definedOnly(data), updatedAt: new Date() };
    this.rows.set(this.keyOf(row), next);
    return next;
  }

  async upsert(where: Row, create: Row, update: Row): Promise<Row> {
    const existing = await this.findFirst(where);
    if (existing) return this.update(where, update);
    return this.create({ ...create });
  }

  async delete(where: Row): Promise<Row> {
    const row = await this.findFirst(where);
    if (!row) throw notFound(this.tableName, where);
    this.rows.delete(this.keyOf(row));
    return row;
  }

  async deleteMany(where: Row): Promise<number> {
    let n = 0;
    for (const row of [...this.rows.values()]) {
      if (matches(row, where)) {
        this.rows.delete(this.keyOf(row));
        n++;
      }
    }
    return n;
  }
}

function uniqueViolation(table: string, key: string): Error {
  const e = new Error(`unique constraint violated on ${table} (key ${key})`);
  e.name = 'UniqueViolationError';
  return e;
}

function notFound(table: string, where: Row): Error {
  const e = new Error(`${table} not found for ${JSON.stringify(where)}`);
  e.name = 'RecordNotFoundError';
  return e;
}

function definedOnly(data: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Full in-memory {@link DbPort}. */
export class InMemoryDatabase implements DbPort {
  users = new InMemoryTable('users') as unknown as DbPort['users'];
  roles = new InMemoryTable('roles') as unknown as DbPort['roles'];
  sites = new InMemoryTable('sites') as unknown as DbPort['sites'];
  siteUsers = new InMemoryTable('siteUsers', (r) => `${r.userId}:${r.siteId}`) as unknown as DbPort['siteUsers'];
  refreshTokens = new InMemoryTable('refreshTokens') as unknown as DbPort['refreshTokens'];
  routers = new InMemoryTable('routers') as unknown as DbPort['routers'];
  downtimes = new InMemoryTable('downtimes') as unknown as DbPort['downtimes'];
  hotspotServers = new InMemoryTable('hotspotServers') as unknown as DbPort['hotspotServers'];
  hotspotProfiles = new InMemoryTable('hotspotProfiles') as unknown as DbPort['hotspotProfiles'];
  hotspotUserProfiles = new InMemoryTable('hotspotUserProfiles') as unknown as DbPort['hotspotUserProfiles'];
  hotspotBatches = new InMemoryTable('hotspotBatches') as unknown as DbPort['hotspotBatches'];
  hotspotActiveSessions = new InMemoryTable('hotspotActiveSessions') as unknown as DbPort['hotspotActiveSessions'];
  hotspotUsers = new InMemoryTable('hotspotUsers') as unknown as DbPort['hotspotUsers'];
  hotspotWalledGardens = new InMemoryTable('hotspotWalledGardens') as unknown as DbPort['hotspotWalledGardens'];
  firewallRules = new InMemoryTable('firewallRules') as unknown as DbPort['firewallRules'];
  firewallJournals = new InMemoryTable('firewallJournals') as unknown as DbPort['firewallJournals'];
  queues = new InMemoryTable('queues') as unknown as DbPort['queues'];
  backups = new InMemoryTable('backups') as unknown as DbPort['backups'];
  backupSchedules = new InMemoryTable('backupSchedules') as unknown as DbPort['backupSchedules'];
  downstreamDevices = new InMemoryTable('downstreamDevices') as unknown as DbPort['downstreamDevices'];
  onboardingTokens = new InMemoryTable('onboardingTokens') as unknown as DbPort['onboardingTokens'];
  notificationRules = new InMemoryTable('notificationRules') as unknown as DbPort['notificationRules'];
  auditLogs = new InMemoryTable('auditLogs') as unknown as DbPort['auditLogs'];
}

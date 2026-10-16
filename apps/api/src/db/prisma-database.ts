import type { DbPort, FindManyOptions, Table } from './database.port.js';
import type { PrismaService } from './prisma.service.js';

/**
 * Prisma-backed {@link DbPort}.
 *
 * Every Prisma delegate (`prisma.user`, `prisma.router`, …) already exposes
 * the exact call shapes this adapter forwards (`create({data})`,
 * `findMany({where, orderBy, skip, take})`, …), so the adapter is a thin,
 * mechanical mapping. Row-type mismatches surface as runtime cast errors,
 * never silent corruption.
 */
class PrismaTable<Row, Create, Update = Partial<Create>, Where = Partial<Row>>
  implements Table<Row, Create, Update, Where>
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly pick: (db: any) => any,
  ) {}

  private get d(): any {
    return this.pick(this.prisma.db);
  }

  create(data: Create): Promise<Row> {
    return this.d.create({ data });
  }
  findUnique(where: Where): Promise<Row | null> {
    return this.d.findUnique({ where });
  }
  findFirst(where: Where): Promise<Row | null> {
    return this.d.findFirst({ where });
  }
  findMany(opts: FindManyOptions<Where> = {}): Promise<Row[]> {
    const { where, orderBy, skip, take } = opts;
    return this.d.findMany({ where, orderBy, skip, take });
  }
  count(where?: Where): Promise<number> {
    return this.d.count({ where });
  }
  update(where: Where, data: Update): Promise<Row> {
    return this.d.update({ where, data });
  }
  upsert(where: Where, create: Create, update: Update): Promise<Row> {
    return this.d.upsert({ where, create, update });
  }
  delete(where: Where): Promise<Row> {
    return this.d.delete({ where });
  }
  async deleteMany(where: Where): Promise<number> {
    const r = await this.d.deleteMany({ where });
    return r.count;
  }
}

/** Prisma-backed {@link DbPort}. Constructed once by {@link DatabaseModule}. */
export class PrismaDatabase implements DbPort {
  readonly users: DbPort['users'];
  readonly roles: DbPort['roles'];
  readonly sites: DbPort['sites'];
  readonly siteUsers: DbPort['siteUsers'];
  readonly refreshTokens: DbPort['refreshTokens'];
  readonly routers: DbPort['routers'];
  readonly downtimes: DbPort['downtimes'];
  readonly hotspotServers: DbPort['hotspotServers'];
  readonly hotspotProfiles: DbPort['hotspotProfiles'];
  readonly hotspotUserProfiles: DbPort['hotspotUserProfiles'];
  readonly hotspotUsers: DbPort['hotspotUsers'];
  readonly hotspotWalledGardens: DbPort['hotspotWalledGardens'];
  readonly firewallRules: DbPort['firewallRules'];
  readonly queues: DbPort['queues'];
  readonly backups: DbPort['backups'];
  readonly backupSchedules: DbPort['backupSchedules'];
  readonly downstreamDevices: DbPort['downstreamDevices'];
  readonly onboardingTokens: DbPort['onboardingTokens'];
  readonly notificationRules: DbPort['notificationRules'];
  readonly auditLogs: DbPort['auditLogs'];
  readonly vaultEntries: DbPort['vaultEntries'];

  constructor(prisma: PrismaService) {
    const t = <R, C, U, W>(pick: (db: any) => any): Table<R, C, U, W> =>
      new PrismaTable<R, C, U, W>(prisma, pick);
    this.users = t((db) => db.user);
    this.roles = t((db) => db.role);
    this.sites = t((db) => db.site);
    this.siteUsers = t((db) => db.siteUser);
    this.refreshTokens = t((db) => db.refreshToken);
    this.routers = t((db) => db.router);
    this.downtimes = t((db) => db.downtime);
    this.hotspotServers = t((db) => db.hotspotServer);
    this.hotspotProfiles = t((db) => db.hotspotProfile);
    this.hotspotUserProfiles = t((db) => db.hotspotUserProfile);
    this.hotspotUsers = t((db) => db.hotspotUser);
    this.hotspotWalledGardens = t((db) => db.hotspotWalledGarden);
    this.firewallRules = t((db) => db.firewallRule);
    this.queues = t((db) => db.queue);
    this.backups = t((db) => db.backup);
    this.backupSchedules = t((db) => db.backupSchedule);
    this.downstreamDevices = t((db) => db.downstreamDevice);
    this.onboardingTokens = t((db) => db.onboardingToken);
    this.notificationRules = t((db) => db.notificationRule);
    this.auditLogs = t((db) => db.auditLog);
    this.vaultEntries = t((db) => db.vaultEntry);
  }
}

import type { DbPort, FindManyOptions, Table } from './database.port.js';
import type { PrismaService } from './prisma.service.js';

/**
 * Prisma-backed {@link DbPort}.
 *
 * Every delegate (`prisma.user`, `prisma.router`, …) already exposes the
 * exact call shapes this adapter forwards (`create({data})`,
 * `findMany({where, orderBy, skip, take})`, …), so the adapter is a thin,
 * mechanical mapping. Row-type mismatches surface as runtime cast errors,
 * never silent corruption.
 */
class PrismaTable<Row, Create, Update, Where> implements Table<Row, Create, Update, Where> {
  constructor(private readonly delegateOf: (db: any) => any) {}

  private d(prisma: PrismaService): any {
    return this.delegateOf(prisma.db);
  }

  constructor_delegate?: never;

  create(data: Create, prisma?: PrismaService): Promise<Row> {
    return this.d(prisma!).create({ data });
  }
  findUnique(where: Where, prisma?: PrismaService): Promise<Row | null> {
    return this.d(prisma!).findUnique({ where });
  }
  findFirst(where: Where, prisma?: PrismaService): Promise<Row | null> {
    return this.d(prisma!).findFirst({ where });
  }
  findMany(opts: FindManyOptions<Where> = {}, prisma?: PrismaService): Promise<Row[]> {
    const { where, orderBy, skip, take } = opts;
    return this.d(prisma!).findMany({ where, orderBy, skip, take });
  }
  count(where?: Where, prisma?: PrismaService): Promise<number> {
    return this.d(prisma!).count({ where });
  }
  update(where: Where, data: Update, prisma?: PrismaService): Promise<Row> {
    return this.d(prisma!).update({ where, data });
  }
  upsert(where: Where, create: Create, update: Update, prisma?: PrismaService): Promise<Row> {
    return this.d(prisma!).upsert({ where, create, update });
  }
  delete(where: Where, prisma?: PrismaService): Promise<Row> {
    return this.d(prisma!).delete({ where });
  }
  deleteMany(where: Where, prisma?: PrismaService): Promise<number> {
    return this.d(prisma!).deleteMany({ where }).then((r: { count: number }) => r.count);
  }
}

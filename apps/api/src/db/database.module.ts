import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DB_PORT, type DbPort } from './database.port.js';
import { InMemoryDatabase } from './in-memory-database.js';
import { InMemoryMetricsStore, METRICS_STORE, type MetricsStore } from './metrics-store.js';
import { PrismaDatabase } from './prisma-database.js';
import { PrismaMetricsStore } from './prisma-metrics-store.js';
import { PrismaService } from './prisma.service.js';

/**
 * Database module (global).
 *
 * - `DATABASE_URL` set → Prisma/Postgres (+TimescaleDB hypertables).
 * - unset → full in-memory fake (dev without Docker, unit tests).
 *
 * Services inject `DB_PORT` / `METRICS_STORE` — never Prisma directly.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: DB_PORT,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService): DbPort => {
        if (config.get('DATABASE_URL')) return new PrismaDatabase(prisma);
        new Logger('DatabaseModule').warn(
          'DATABASE_URL is not set — using the in-memory database. Data will NOT persist across restarts.',
        );
        return new InMemoryDatabase();
      },
    },
    {
      provide: METRICS_STORE,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService): MetricsStore => {
        if (config.get('DATABASE_URL')) return new PrismaMetricsStore(prisma);
        return new InMemoryMetricsStore();
      },
    },
  ],
  exports: [DB_PORT, METRICS_STORE, PrismaService],
})
export class DatabaseModule {}

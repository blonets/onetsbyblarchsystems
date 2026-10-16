import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

/**
 * Lazily-instantiated Prisma client.
 *
 * The client is created on first use (not at module init) so the API can boot
 * without a database for commands that don't need it. `@prisma/client` is
 * imported dynamically: the generated client must exist at deploy time
 * (`prisma generate` runs in the Docker build / Dokploy pre-deploy), but unit
 * tests and typecheck never touch it.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private client: unknown | undefined;

  /** The raw PrismaClient. Throws a clear error if generation was skipped. */
  get db(): any {
    if (!this.client) {
      let PrismaClient: new () => unknown;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        PrismaClient = require('@prisma/client').PrismaClient;
      } catch (err) {
        throw new Error(
          'PrismaClient is not generated. Run `prisma generate` (needs the schema + network for the engine download), then restart the API.',
        );
      }
      this.client = new PrismaClient();
      this.logger.log('PrismaClient instantiated');
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    const c = this.client as { $disconnect?: () => Promise<void> } | undefined;
    await c?.$disconnect?.().catch(() => undefined);
  }
}

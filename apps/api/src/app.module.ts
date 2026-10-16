import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { BackupsModule } from './backups/backups.module.js';
import { CommandsModule } from './commands/commands.module.js';
import { InternalGuard } from './common/guards/internal.guard.js';
import { DatabaseModule } from './db/database.module.js';
import { DownstreamModule } from './downstream/downstream.module.js';
import { EventsModule } from './events/events.module.js';
import { FirewallModule } from './firewall/firewall.module.js';
import { HealthModule } from './health/health.module.js';
import { HotspotModule } from './hotspot/hotspot.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MonitoringModule } from './monitoring/monitoring.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ProvisioningModule } from './provisioning/provisioning.module.js';
import { QueuesModule } from './queues/queues.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RoutersModule } from './routers/routers.module.js';
import { VaultModule } from './vault/vault.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global infrastructure (ports): must be imported once so their
    // providers (DB_PORT, METRICS_STORE, JOBS_PORT, VAULT_PORT, EventsService)
    // resolve application-wide.
    DatabaseModule,
    EventsModule,
    JobsModule,
    VaultModule,
    AuthModule,
    HealthModule,
    RoutersModule,
    ProvisioningModule,
    CommandsModule,
    HotspotModule,
    FirewallModule,
    QueuesModule,
    MonitoringModule,
    BackupsModule,
    DownstreamModule,
    NotificationsModule,
    RealtimeModule,
  ],
  providers: [
    // Every route requires a JWT unless marked @Public(); roles enforced via @Roles();
    // @Internal() routes additionally require the x-internal-key header.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: InternalGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

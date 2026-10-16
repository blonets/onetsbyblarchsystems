import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { HealthModule } from './health/health.module.js';
import { ProvisioningModule } from './provisioning/provisioning.module.js';
import { RoutersModule } from './routers/routers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    HealthModule,
    RoutersModule,
    ProvisioningModule,
  ],
  providers: [
    // Every route requires a JWT unless marked @Public(); roles enforced via @Roles().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

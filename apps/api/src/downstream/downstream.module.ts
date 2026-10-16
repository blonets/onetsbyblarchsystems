import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { VaultModule } from '../vault/vault.module.js';
import { DownstreamController } from './downstream.controller.js';
import { DownstreamService } from './downstream.service.js';

@Module({
  imports: [AuditModule, CommandsModule, RealtimeModule, VaultModule],
  controllers: [DownstreamController],
  providers: [DownstreamService],
  exports: [DownstreamService],
})
export class DownstreamModule {}

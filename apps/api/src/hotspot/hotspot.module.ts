import { Module } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module.js';
import { VaultModule } from '../vault/vault.module.js';
import { HotspotBatchService } from './hotspot-batch.service.js';
import { HotspotController } from './hotspot.controller.js';
import { HotspotInternalController } from './hotspot-internal.controller.js';
import { HotspotService } from './hotspot.service.js';

@Module({
  imports: [CommandsModule, VaultModule],
  controllers: [HotspotController, HotspotInternalController],
  providers: [HotspotService, HotspotBatchService],
  exports: [HotspotService, HotspotBatchService],
})
export class HotspotModule {}

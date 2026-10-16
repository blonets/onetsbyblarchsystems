import { Module } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module.js';
import { VaultModule } from '../vault/vault.module.js';
import { HotspotController } from './hotspot.controller.js';
import { HotspotService } from './hotspot.service.js';

@Module({
  imports: [CommandsModule, VaultModule],
  controllers: [HotspotController],
  providers: [HotspotService],
  exports: [HotspotService],
})
export class HotspotModule {}

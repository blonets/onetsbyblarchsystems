import { Module } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module.js';
import { FirewallController } from './firewall.controller.js';
import { FirewallService } from './firewall.service.js';

@Module({
  imports: [CommandsModule],
  controllers: [FirewallController],
  providers: [FirewallService],
  exports: [FirewallService],
})
export class FirewallModule {}

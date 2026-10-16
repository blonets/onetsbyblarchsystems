import { Module } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module.js';
import { FirewallController } from './firewall.controller.js';
import { FirewallJournalController } from './firewall-journal.controller.js';
import { FirewallJournalService } from './firewall-journal.service.js';
import { FirewallService } from './firewall.service.js';

@Module({
  imports: [CommandsModule],
  controllers: [FirewallController, FirewallJournalController],
  providers: [FirewallService, FirewallJournalService],
  exports: [FirewallService, FirewallJournalService],
})
export class FirewallModule {}

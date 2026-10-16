import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { CommandsController, CommandsInternalController } from './commands.controller.js';
import { RouterCommandsService } from './commands.service.js';

@Module({
  imports: [AuditModule, RealtimeModule],
  controllers: [CommandsController, CommandsInternalController],
  providers: [RouterCommandsService],
  exports: [RouterCommandsService],
})
export class CommandsModule {}

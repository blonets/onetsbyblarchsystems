import { Module } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module.js';
import { QueuesController } from './queues.controller.js';
import { QueuesService } from './queues.service.js';

@Module({
  imports: [CommandsModule],
  controllers: [QueuesController],
  providers: [QueuesService],
  exports: [QueuesService],
})
export class QueuesModule {}

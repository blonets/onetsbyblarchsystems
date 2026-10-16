import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import type { QueueKind } from '@mtk/types';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import { CreateQueueDto, MoveQueueDto, UpdateQueueDto } from './dto/queues.dto.js';
import { QueuesService } from './queues.service.js';

class QueueQuery {
  @IsOptional()
  @IsIn(['simple', 'tree'])
  kind?: QueueKind;
}

/**
 * Queues manager REST. Reads: technician+. Mutations: operator+
 * (technicians cannot change queues).
 */
@Controller('routers/:routerId/queues')
@Roles('technician')
export class QueuesController {
  constructor(private readonly queues: QueuesService) {}

  @Get()
  list(@Param('routerId') routerId: string, @Query() q: QueueQuery) {
    return this.queues.listQueues(routerId, q.kind);
  }

  @Roles('operator')
  @Post()
  @HttpCode(201)
  create(@Param('routerId') routerId: string, @Body() dto: CreateQueueDto, @CurrentUser() actor: CurrentUserType) {
    return this.queues.createQueue(routerId, dto, actor);
  }

  @Roles('operator')
  @Patch(':id')
  update(@Param('routerId') routerId: string, @Param('id') id: string, @Body() dto: UpdateQueueDto, @CurrentUser() actor: CurrentUserType) {
    return this.queues.updateQueue(routerId, id, dto, actor);
  }

  @Roles('operator')
  @Post(':id/enable')
  enable(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.queues.setQueueDisabled(routerId, id, false, opId, actor);
  }

  @Roles('operator')
  @Post(':id/disable')
  disable(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.queues.setQueueDisabled(routerId, id, true, opId, actor);
  }

  @Roles('operator')
  @Post(':id/move')
  move(@Param('routerId') routerId: string, @Param('id') id: string, @Body() dto: MoveQueueDto, @CurrentUser() actor: CurrentUserType) {
    return this.queues.moveQueue(routerId, id, dto, actor);
  }

  @Roles('operator')
  @Delete(':id')
  remove(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.queues.deleteQueue(routerId, id, opId, actor);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { RouterStatus } from '@mtk/types';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PaginationQuery } from '../common/dto/pagination.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import { CreateRouterDto, UpdateRouterDto } from './dto/router.dto.js';
import { RoutersService } from './routers.service.js';

class RouterQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  siteId?: string;

  @IsOptional()
  @IsIn(['pending', 'online', 'offline', 'suspect', 'decommissioned'])
  status?: RouterStatus;

  /** Tag filter — routers carrying this label (see Router.tags). */
  @IsOptional()
  @IsString()
  tag?: string;
}

@Controller('routers')
@Roles('technician')
export class RoutersController {
  constructor(private readonly routers: RoutersService) {}

  @Get()
  findAll(@Query() q: RouterQuery) {
    return this.routers.findAll({ page: q.page, pageSize: q.pageSize, siteId: q.siteId, status: q.status, tag: q.tag });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.routers.findOne(id);
  }

  @Get(':id/status')
  getStatus(@Param('id') id: string) {
    return this.routers.getStatus(id);
  }

  @Roles('operator')
  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateRouterDto, @CurrentUser() actor: CurrentUserType) {
    return this.routers.create(dto, actor);
  }

  @Roles('operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRouterDto, @CurrentUser() actor: CurrentUserType) {
    return this.routers.update(id, dto, actor);
  }

  /**
   * Decommission (soft): marks the router decommissioned and enqueues
   * hub-secret removal. The row is kept for history.
   */
  @Roles('admin')
  @Delete(':id')
  decommission(@Param('id') id: string, @CurrentUser() actor: CurrentUserType) {
    return this.routers.decommission(id, actor);
  }
}

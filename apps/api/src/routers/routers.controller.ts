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
  @IsIn(['pending', 'online', 'offline', 'suspect', 'decommissioned', 'all'])
  status?: RouterStatus | 'all';

  /** Tag filter — routers carrying this label (see Router.tags). */
  @IsOptional()
  @IsString()
  tag?: string;

  /** General search query (identityName, tunnelIp, version, boardName) */
  @IsOptional()
  @IsString()
  q?: string;

  /** Whether to include decommissioned routers in results */
  @IsOptional()
  includeDecommissioned?: string | boolean;
}

@Controller('routers')
@Roles('technician')
export class RoutersController {
  constructor(private readonly routers: RoutersService) {}

  @Get()
  findAll(@Query() q: RouterQuery) {
    const incDecom =
      q.includeDecommissioned === true ||
      q.includeDecommissioned === 'true' ||
      q.includeDecommissioned === '1';
    return this.routers.findAll({
      page: q.page,
      pageSize: q.pageSize,
      siteId: q.siteId,
      status: q.status,
      tag: q.tag,
      includeDecommissioned: incDecom,
      q: q.q,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.routers.findOne(id);
  }

  @Get(':id/status')
  getStatus(@Param('id') id: string) {
    return this.routers.getStatus(id);
  }

  @Roles('technician')
  @Post(':id/test-connection')
  testConnection(@Param('id') id: string) {
    return this.routers.testConnection(id);
  }

  @Roles('operator')
  @Post(':id/sync')
  sync(@Param('id') id: string, @CurrentUser() actor: CurrentUserType) {
    return this.routers.sync(id, actor);
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
   * Delete router:
   * - permanent=true: Completely purges router from Hub secret, Vault, and DB.
   * - default: Soft decommission.
   */
  @Roles('admin')
  @Delete(':id')
  delete(
    @Param('id') id: string,
    @Query('permanent') permanent: string,
    @CurrentUser() actor: CurrentUserType,
  ) {
    if (permanent === 'true' || permanent === '1') {
      return this.routers.deletePermanently(id, actor);
    }
    return this.routers.decommission(id, actor);
  }

  /**
   * Explicit permanent delete:
   * Completely deletes the router, hub secret, vault entry, and DB row.
   */
  @Roles('admin')
  @Delete(':id/permanent')
  deletePermanent(@Param('id') id: string, @CurrentUser() actor: CurrentUserType) {
    return this.routers.deletePermanently(id, actor);
  }
}

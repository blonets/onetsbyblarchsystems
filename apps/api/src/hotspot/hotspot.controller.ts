import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PaginationQuery } from '../common/dto/pagination.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import {
  CreateHotspotBatchDto,
  CreateHotspotServerDto,
  CreateHotspotUserDto,
  CreateServerProfileDto,
  CreateUserProfileDto,
  CreateWalledGardenDto,
  UpdateHotspotServerDto,
  UpdateHotspotUserDto,
  UpdateServerProfileDto,
  UpdateUserProfileDto,
  UpdateWalledGardenDto,
} from './dto/hotspot.dto.js';
import { HotspotBatchService } from './hotspot-batch.service.js';
import { HotspotService } from './hotspot.service.js';

class UserQuery extends PaginationQuery {
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  @IsOptional()
  @IsIn(['up', 'vc'])
  mode?: 'up' | 'vc';

  @IsOptional()
  @IsString()
  batchId?: string;
}

class WalledGardenQuery {
  @IsOptional()
  @IsString()
  kind?: string;
}

/**
 * Hotspot v1 REST. Reads: technician+. Mutations: operator+ (technicians can
 * onboard routers and view, but cannot change hotspot/firewall/queues).
 * Every mutation is audited and enqueued; the device applies asynchronously.
 */
@Controller('routers/:routerId/hotspot')
@Roles('technician')
export class HotspotController {
  constructor(
    private readonly hotspot: HotspotService,
    private readonly batches: HotspotBatchService,
  ) {}

  // ------------------------------------------------------------- servers --

  @Get('servers')
  listServers(@Param('routerId') routerId: string) {
    return this.hotspot.listServers(routerId);
  }

  @Roles('operator')
  @Post('servers')
  @HttpCode(201)
  createServer(
    @Param('routerId') routerId: string,
    @Body() dto: CreateHotspotServerDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.hotspot.createServer(routerId, dto, actor);
  }

  @Roles('operator')
  @Patch('servers/:id')
  updateServer(
    @Param('routerId') routerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateHotspotServerDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.hotspot.updateServer(routerId, id, dto, actor);
  }

  @Roles('operator')
  @Post('servers/:id/enable')
  setServerEnabled(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.setServerDisabled(routerId, id, false, opId, actor);
  }

  @Roles('operator')
  @Post('servers/:id/disable')
  setServerDisabled(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.setServerDisabled(routerId, id, true, opId, actor);
  }

  @Roles('operator')
  @Delete('servers/:id')
  deleteServer(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.deleteServer(routerId, id, opId, actor);
  }

  // ------------------------------------------------------ server profiles --

  @Get('server-profiles')
  listServerProfiles(@Param('routerId') routerId: string) {
    return this.hotspot.listServerProfiles(routerId);
  }

  @Roles('operator')
  @Post('server-profiles')
  @HttpCode(201)
  createServerProfile(@Param('routerId') routerId: string, @Body() dto: CreateServerProfileDto, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.createServerProfile(routerId, dto, actor);
  }

  @Roles('operator')
  @Patch('server-profiles/:id')
  updateServerProfile(@Param('routerId') routerId: string, @Param('id') id: string, @Body() dto: UpdateServerProfileDto, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.updateServerProfile(routerId, id, dto, actor);
  }

  @Roles('operator')
  @Delete('server-profiles/:id')
  deleteServerProfile(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.deleteServerProfile(routerId, id, opId, actor);
  }

  // -------------------------------------------------------- user profiles --

  @Get('user-profiles')
  listUserProfiles(@Param('routerId') routerId: string) {
    return this.hotspot.listUserProfiles(routerId);
  }

  @Roles('operator')
  @Post('user-profiles')
  @HttpCode(201)
  createUserProfile(@Param('routerId') routerId: string, @Body() dto: CreateUserProfileDto, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.createUserProfile(routerId, dto, actor);
  }

  @Roles('operator')
  @Patch('user-profiles/:id')
  updateUserProfile(@Param('routerId') routerId: string, @Param('id') id: string, @Body() dto: UpdateUserProfileDto, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.updateUserProfile(routerId, id, dto, actor);
  }

  @Roles('operator')
  @Post('user-profiles/:id/enable')
  enableUserProfile(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.setUserProfileDisabled(routerId, id, false, opId, actor);
  }

  @Roles('operator')
  @Post('user-profiles/:id/disable')
  disableUserProfile(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.setUserProfileDisabled(routerId, id, true, opId, actor);
  }

  @Roles('operator')
  @Delete('user-profiles/:id')
  deleteUserProfile(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.deleteUserProfile(routerId, id, opId, actor);
  }

  // ----------------------------------------------------------------- users --

  @Get('users')
  listUsers(@Param('routerId') routerId: string, @Query() q: UserQuery) {
    return this.hotspot.listUsers(routerId, { page: q.page, pageSize: q.pageSize, disabled: q.disabled, mode: q.mode, batchId: q.batchId });
  }

  /**
   * Batch-generate credentials (`up` = username+random password,
   * `vc` = voucher code). One BullMQ job, idempotent by opId; every user
   * comment is encoded `vc-<batchId>-<YYYYMMDD>-<note>`.
   */
  @Roles('operator')
  @Post('users/batch')
  @HttpCode(201)
  createBatch(
    @Param('routerId') routerId: string,
    @Body() dto: CreateHotspotBatchDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.batches.generateBatch(routerId, dto, actor);
  }

  @Get('users/batches')
  listBatches(@Param('routerId') routerId: string) {
    return this.batches.listBatches(routerId);
  }

  /**
   * Expired-but-still-connected detection: users past expiry (absolute or
   * first-login validity) with active sessions. Read model for the worker's
   * expiry/alert pipeline.
   */
  @Get('stale-sessions')
  findStaleSessions(@Param('routerId') routerId: string) {
    return this.hotspot.findStaleSessions(routerId);
  }

  @Roles('operator')
  @Post('users')
  @HttpCode(201)
  createUser(@Param('routerId') routerId: string, @Body() dto: CreateHotspotUserDto, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.createUser(routerId, dto, actor);
  }

  @Roles('operator')
  @Patch('users/:id')
  updateUser(@Param('routerId') routerId: string, @Param('id') id: string, @Body() dto: UpdateHotspotUserDto, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.updateUser(routerId, id, dto, actor);
  }

  @Roles('operator')
  @Post('users/:id/enable')
  enableUser(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.setUserDisabled(routerId, id, false, opId, actor);
  }

  @Roles('operator')
  @Post('users/:id/disable')
  disableUser(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.setUserDisabled(routerId, id, true, opId, actor);
  }

  @Roles('operator')
  @Delete('users/:id')
  deleteUser(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.deleteUser(routerId, id, opId, actor);
  }

  /** Trigger a quota-enforcer run for this router (operator+). */
  @Roles('operator')
  @Post('quota/enforce')
  @HttpCode(202)
  enforceQuota(@Param('routerId') routerId: string, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.enforceQuota(routerId, actor);
  }

  // ---------------------------------------------------------- walled garden --

  @Get('walled-garden')
  listWalledGarden(@Param('routerId') routerId: string, @Query() q: WalledGardenQuery) {
    return this.hotspot.listWalledGarden(routerId, q.kind);
  }

  @Roles('operator')
  @Post('walled-garden')
  @HttpCode(201)
  createWalledGarden(@Param('routerId') routerId: string, @Body() dto: CreateWalledGardenDto, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.createWalledGarden(routerId, dto, actor);
  }

  @Roles('operator')
  @Patch('walled-garden/:id')
  updateWalledGarden(@Param('routerId') routerId: string, @Param('id') id: string, @Body() dto: UpdateWalledGardenDto, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.updateWalledGarden(routerId, id, dto, actor);
  }

  @Roles('operator')
  @Post('walled-garden/:id/enable')
  enableWalledGarden(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.setWalledGardenDisabled(routerId, id, false, opId, actor);
  }

  @Roles('operator')
  @Post('walled-garden/:id/disable')
  disableWalledGarden(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.setWalledGardenDisabled(routerId, id, true, opId, actor);
  }

  @Roles('operator')
  @Delete('walled-garden/:id')
  deleteWalledGarden(@Param('routerId') routerId: string, @Param('id') id: string, @Body('opId') opId: string | undefined, @CurrentUser() actor: CurrentUserType) {
    return this.hotspot.deleteWalledGarden(routerId, id, opId, actor);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import { RegisterDeviceDto, UpdateDeviceDto } from './dto/downstream.dto.js';
import { DownstreamService } from './downstream.service.js';

/**
 * Downstream-device proxy REST. Reads: technician+. Mutations: operator+.
 */
@Controller('routers/:routerId/downstream')
@Roles('technician')
export class DownstreamController {
  constructor(private readonly downstream: DownstreamService) {}

  @Get()
  list(@Param('routerId') routerId: string) {
    return this.downstream.list(routerId);
  }

  @Roles('operator')
  @Post()
  @HttpCode(201)
  register(
    @Param('routerId') routerId: string,
    @Body() dto: RegisterDeviceDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.downstream.register(routerId, dto, actor);
  }

  @Roles('operator')
  @Patch(':deviceId')
  update(
    @Param('routerId') routerId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.downstream.update(routerId, deviceId, dto, actor);
  }

  @Roles('operator')
  @Delete(':deviceId')
  remove(
    @Param('routerId') routerId: string,
    @Param('deviceId') deviceId: string,
    @Body('opId') opId: string | undefined,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.downstream.remove(routerId, deviceId, opId, actor).then(() => ({ deleted: true }));
  }

  /**
   * Vendor-neutral status probe via the DeviceDriver contract (Phase 1: TCP
   * probe of the proxy endpoint; Phase 2 drivers plug in behind getDriver()).
   */
  @Get(':deviceId/status')
  getStatus(@Param('routerId') routerId: string, @Param('deviceId') deviceId: string) {
    return this.downstream.getStatus(routerId, deviceId);
  }

  /** Trigger `/ip/neighbor` discovery on the site router (operator+). */
  @Roles('operator')
  @Post('discover')
  @HttpCode(202)
  discover(
    @Param('routerId') routerId: string,
    @Body('opId') opId: string | undefined,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.downstream.discover(routerId, opId, actor);
  }

  /**
   * Allocate a tunnel-side port and install the `panel-proxy:<deviceId>`
   * dst-nat rule — the device becomes reachable at `<tunnelIp>:<proxyPort>`.
   */
  @Roles('operator')
  @Post(':deviceId/enable-proxy')
  @HttpCode(202)
  enableProxy(
    @Param('routerId') routerId: string,
    @Param('deviceId') deviceId: string,
    @Body('opId') opId: string | undefined,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.downstream.enableProxy(routerId, deviceId, opId, actor);
  }

  @Roles('operator')
  @Post(':deviceId/disable-proxy')
  @HttpCode(202)
  disableProxy(
    @Param('routerId') routerId: string,
    @Param('deviceId') deviceId: string,
    @Body('opId') opId: string | undefined,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.downstream.disableProxy(routerId, deviceId, opId, actor);
  }

  /**
   * Register a downstream MikroTik as a managed router (cascade).
   * Hub-side onboarding still goes through the provisioning token flow.
   */
  @Roles('operator')
  @Post(':deviceId/register-router')
  @HttpCode(201)
  registerCascade(
    @Param('routerId') routerId: string,
    @Param('deviceId') deviceId: string,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.downstream.registerCascade(routerId, deviceId, actor);
  }
}

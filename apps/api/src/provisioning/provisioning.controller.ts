import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ProvisionRouterDto } from './dto/provision-router.dto.js';
import { ProvisioningService } from './provisioning.service.js';

@Controller('provisioning')
export class ProvisioningController {
  constructor(private readonly provisioning: ProvisioningService) {}

  /**
   * Onboard a new site router: mint SSTP credentials, allocate the static
   * tunnel IP, create the hub-side /ppp secret.
   * The SSTP password is vaulted server-side and never returned.
   */
  @Roles('admin')
  @Post('routers')
  @HttpCode(201)
  provisionRouter(
    @Body() dto: ProvisionRouterDto,
  ): Promise<{ sstpUsername: string; tunnelIp: string }> {
    return this.provisioning.provisionNewRouter(dto);
  }
}

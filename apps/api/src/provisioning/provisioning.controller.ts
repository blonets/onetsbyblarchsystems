import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import { ProvisioningService } from './provisioning.service.js';

class IssueTokenDto {
  @IsOptional()
  @IsString()
  siteId?: string;
}

@Controller('provisioning')
@Roles('technician')
export class ProvisioningController {
  constructor(private readonly provisioning: ProvisioningService) {}

  /**
   * Issue an onboarding token: mints SSTP credentials, allocates the tunnel
   * IP, creates the hub /ppp secret. Returns the one-line terminal command
   * for the tech. Passwords are never returned.
   */
  @Post('tokens')
  @HttpCode(201)
  issueToken(@Body() dto: IssueTokenDto, @CurrentUser() actor: CurrentUserType) {
    return this.provisioning.issueToken(dto, actor);
  }

  @Get('tokens')
  listTokens() {
    return this.provisioning.listTokens();
  }

  @Delete('tokens/:id')
  @HttpCode(204)
  async revokeToken(@Param('id') id: string, @CurrentUser() actor: CurrentUserType): Promise<void> {
    await this.provisioning.revokeToken(id, actor);
  }

  /** Enqueue an SSTP + API secret rotation for a router (admin). */
  @Roles('admin')
  @Post('routers/:id/rotate-secrets')
  @HttpCode(202)
  rotateSecrets(@Param('id') id: string, @CurrentUser() actor: CurrentUserType) {
    return this.provisioning.rotateSecrets(id, actor);
  }

  /**
   * Create a DISPOSABLE hub secret (`test-del-<rand>`) for live connectivity
   * tests. Must be deleted afterwards via DELETE below.
   */
  @Roles('admin')
  @Post('hub/test-secrets')
  @HttpCode(201)
  createTestSecret() {
    return this.provisioning.createDisposableTestSecret();
  }

  @Roles('admin')
  @Delete('hub/test-secrets/:name')
  @HttpCode(204)
  async deleteTestSecret(@Param('name') name: string): Promise<void> {
    await this.provisioning.deleteHubSecretByName(name);
  }
}

import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import type { OnboardCallback } from '@mtk/types';
import { Public } from '../auth/decorators/public.decorator.js';
import { ProvisioningService } from './provisioning.service.js';

class CallbackDto implements OnboardCallback {
  @IsString()
  uuid!: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  board?: string;

  @IsOptional()
  @IsString()
  serial?: string;
}

/**
 * Router-facing onboarding endpoints. Public (no JWT) — the single-use token
 * in the path is the credential. The token burns on first successful callback.
 */
@Controller('onboard')
export class OnboardController {
  constructor(private readonly provisioning: ProvisioningService) {}

  @Public()
  @Get(':token/onboard.rsc')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  getScript(@Param('token') token: string): Promise<string> {
    return this.provisioning.getOnboardScript(token);
  }

  @Public()
  @Post(':token/callback')
  @HttpCode(200)
  callback(
    @Param('token') token: string,
    @Body() dto: CallbackDto,
  ): Promise<{ routerId: string }> {
    return this.provisioning.handleCallback(token, dto);
  }
}

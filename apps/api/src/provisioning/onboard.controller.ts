import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import type { OnboardCallback } from '@mtk/types';
import { Public } from '../auth/decorators/public.decorator.js';
import { ProvisioningService } from './provisioning.service.js';

class CallbackDto implements Partial<OnboardCallback> {
  @IsOptional()
  @IsString()
  uuid?: string;

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
  getScript(
    @Param('token') token: string,
    @Query('v') version?: string,
  ): Promise<string> {
    return this.provisioning.getOnboardScript(token, version);
  }

  @Public()
  @Get(':uuid/sync.rsc')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  getSyncScript(
    @Param('uuid') uuid: string,
    @Query('v') version?: string,
  ): Promise<string> {
    return this.provisioning.getSyncScript(uuid, version);
  }

  @Public()
  @Post(':token/callback')
  @HttpCode(200)
  callback(
    @Param('token') token: string,
    @Body() dto: CallbackDto,
    @Query('uuid') qUuid?: string,
    @Query('version') qVersion?: string,
    @Query('board') qBoard?: string,
    @Req() req?: any,
  ): Promise<{ routerId: string }> {
    let payload: any = dto || {};
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }
    const finalDto: OnboardCallback = {
      uuid: payload.uuid || qUuid || req?.query?.uuid || 'uuid-router',
      version: payload.version || qVersion || req?.query?.version,
      board: payload.board || qBoard || req?.query?.board,
      serial: payload.serial || req?.query?.serial,
    };
    return this.provisioning.handleCallback(token, finalDto);
  }

  @Public()
  @Get(':token/callback')
  @HttpCode(200)
  callbackGet(
    @Param('token') token: string,
    @Query('uuid') uuid?: string,
    @Query('version') version?: string,
    @Query('board') board?: string,
  ): Promise<{ routerId: string }> {
    return this.provisioning.handleCallback(token, {
      uuid: uuid || 'uuid-router',
      version,
      board,
    });
  }
}

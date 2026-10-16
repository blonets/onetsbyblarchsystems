import { BadRequestException, Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { CommandResultPayload } from '@mtk/types';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Internal } from '../common/decorators/internal.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import { RouterCommandsService } from './commands.service.js';

class SafeApplyDto {
  /** Ms to wait before the worker verifies the router is still reachable. */
  @IsInt()
  @Min(1000)
  @Max(600_000)
  verifyAfterMs!: number;
}

class ExecuteCommandDto {
  /** Idempotency key; generated when omitted. */
  @IsOptional()
  @IsString()
  opId?: string;

  /**
   * Raw RouterOS API sentences (word arrays), e.g.
   * `[["/system/resource/print"]]`. First word of each sentence must be a
   * command path. Prefer the typed domain endpoints (hotspot/firewall/…)
   * over this escape hatch.
   */
  @IsArray()
  sentences!: string[][];

  @IsOptional()
  @ValidateNested()
  @Type(() => SafeApplyDto)
  safeApply?: SafeApplyDto;
}

/**
 * Generic command execution + the worker's result callback.
 *
 * The result endpoint is worker/internal-only: @Public() skips the JWT guard
 * and @Internal() requires the `x-internal-key` header (fails closed when
 * INTERNAL_API_KEY is unset).
 */
@Controller()
export class CommandsController {
  constructor(private readonly commands: RouterCommandsService) {}

  /**
   * Escape-hatch: run arbitrary typed sentences on a router.
   * Operator+ only. Everything is audited and idempotent by opId.
   */
  @Roles('operator')
  @Post('routers/:routerId/commands')
  @HttpCode(202)
  execute(
    @Param('routerId') routerId: string,
    @Body() dto: ExecuteCommandDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    for (const sentence of dto.sentences) {
      if (!Array.isArray(sentence) || sentence.length === 0 || !sentence[0].startsWith('/')) {
        throw new BadRequestException('each sentence must be a non-empty word array starting with a command path');
      }
    }
    return this.commands.enqueueRos({
      routerId,
      action: 'command.execute',
      sentences: dto.sentences,
      opId: dto.opId,
      actorId: actor.sub,
      safeApply: dto.safeApply,
    });
  }
}

@Controller('internal/commands')
@Public()
@Internal()
export class CommandsInternalController {
  constructor(private readonly commands: RouterCommandsService) {}

  /** Posted by the worker when a `commands`-queue job settles. */
  @Post('results')
  @HttpCode(202)
  reportResult(@Body() payload: CommandResultPayload) {
    if (!payload || typeof payload.opId !== 'string') {
      throw new BadRequestException('payload.opId is required');
    }
    return this.commands.reportResult(payload).then(() => ({ accepted: true }));
  }
}

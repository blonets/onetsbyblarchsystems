import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  @Public()
  @Get()
  check(): { status: string; version: string; uptimeSeconds: number } {
    return {
      status: 'ok',
      version: '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }
}

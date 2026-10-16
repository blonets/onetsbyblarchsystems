import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import { Internal } from '../common/decorators/internal.decorator.js';
import { HotspotService } from './hotspot.service.js';

/**
 * Worker-facing hotspot reads (NOT part of the public REST surface).
 *
 * Auth: @Public() skips JWT; @Internal() requires the `x-internal-key`
 * header to match INTERNAL_API_KEY (fails closed when unset) — the same
 * pattern as the other /internal/* endpoints.
 *
 * Contract with the worker expiry sweep: every user record carries
 * `expiryMode` ('remove' | 'notify' | 'remove+notify' | 'none'; the sweep
 * treats unknown/absent as 'disable' and removes immediately for 'remove').
 * Unknown router → 404, which the sweep treats as an empty user list.
 */
@Controller('internal/worker/routers/:routerId')
export class HotspotInternalController {
  constructor(private readonly hotspot: HotspotService) {}

  @Get('hotspot-users')
  @Public()
  @Internal()
  listUsers(@Param('routerId') routerId: string) {
    return this.hotspot.listUsersInternal(routerId);
  }
}

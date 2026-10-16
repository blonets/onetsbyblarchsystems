import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import { HotspotSetupWizardDto } from './dto/wizard.dto.js';
import { HotspotSetupWizardService } from './wizard.service.js';

/**
 * Hotspot setup wizard (operator+): ONE guided, opId-tracked step.
 * Without `confirm` → returns a step-by-step preview (sentences grouped by
 * step). With `confirm: true` → enqueues the full batch as a single
 * idempotent command.
 */
@Controller('routers/:routerId/wizard')
@Roles('operator')
export class WizardController {
  constructor(private readonly wizard: HotspotSetupWizardService) {}

  @Post('hotspot-setup')
  @HttpCode(200)
  hotspotSetup(
    @Param('routerId') routerId: string,
    @Body() dto: HotspotSetupWizardDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return dto.confirm
      ? this.wizard.run(routerId, dto, actor)
      : this.wizard.preview(routerId, dto);
  }
}

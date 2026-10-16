import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { OnboardController } from './onboard.controller.js';
import { ProvisioningController } from './provisioning.controller.js';
import { ProvisioningService, provisioningProviders } from './provisioning.service.js';
import { WizardController } from './wizard.controller.js';
import { HotspotSetupWizardService } from './wizard.service.js';

@Module({
  imports: [AuditModule, CommandsModule],
  controllers: [ProvisioningController, OnboardController, WizardController],
  providers: [...provisioningProviders(), HotspotSetupWizardService],
  exports: [ProvisioningService, HotspotSetupWizardService],
})
export class ProvisioningModule {}

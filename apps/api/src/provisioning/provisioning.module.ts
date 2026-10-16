import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { OnboardController } from './onboard.controller.js';
import { ProvisioningController } from './provisioning.controller.js';
import { ProvisioningService, provisioningProviders } from './provisioning.service.js';

@Module({
  imports: [AuditModule],
  controllers: [ProvisioningController, OnboardController],
  providers: [...provisioningProviders()],
  exports: [ProvisioningService],
})
export class ProvisioningModule {}

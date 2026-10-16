import { Module } from '@nestjs/common';
import { ProvisioningController } from './provisioning.controller.js';
import { provisioningProviders } from './provisioning.service.js';

@Module({
  controllers: [ProvisioningController],
  providers: [...provisioningProviders()],
  exports: [],
})
export class ProvisioningModule {}

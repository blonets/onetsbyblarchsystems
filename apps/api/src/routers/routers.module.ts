import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ProvisioningModule } from '../provisioning/provisioning.module.js';
import { RoutersController } from './routers.controller.js';
import { RoutersService } from './routers.service.js';

@Module({
  imports: [AuditModule, ProvisioningModule],
  controllers: [RoutersController],
  providers: [RoutersService],
  exports: [RoutersService],
})
export class RoutersModule {}

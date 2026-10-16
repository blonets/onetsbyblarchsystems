import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { RoutersController } from './routers.controller.js';
import { RoutersService } from './routers.service.js';

@Module({
  imports: [AuditModule],
  controllers: [RoutersController],
  providers: [RoutersService],
  exports: [RoutersService],
})
export class RoutersModule {}

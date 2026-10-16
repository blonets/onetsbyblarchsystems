import { Module } from '@nestjs/common';
import { RoutersController } from './routers.controller.js';
import { RoutersService } from './routers.service.js';

@Module({
  controllers: [RoutersController],
  providers: [RoutersService],
  exports: [RoutersService],
})
export class RoutersModule {}

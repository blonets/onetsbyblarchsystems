import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { Router } from '@mtk/types';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateRouterDto } from './dto/create-router.dto.js';
import { UpdateRouterDto } from './dto/update-router.dto.js';
import { RoutersService } from './routers.service.js';

@Controller('routers')
export class RoutersController {
  constructor(private readonly routers: RoutersService) {}

  @Get()
  findAll(): Router[] {
    return this.routers.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Router {
    return this.routers.findOne(id);
  }

  @Get(':id/status')
  getStatus(@Param('id') id: string): { id: string; status: string; lastSeenAt?: string } {
    return this.routers.getStatus(id);
  }

  @Roles('admin', 'operator')
  @Post()
  create(@Body() dto: CreateRouterDto): Router {
    return this.routers.create(dto);
  }

  @Roles('admin', 'operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRouterDto): Router {
    return this.routers.update(id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): void {
    this.routers.remove(id);
  }
}

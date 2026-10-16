import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto.js';
import { SitesService } from './sites.service.js';

@Controller('sites')
@Roles('technician')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  findAll() {
    return this.sites.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sites.findOne(id);
  }

  @Get(':id/routers')
  routersOf(@Param('id') id: string) {
    return this.sites.routersOf(id);
  }

  @Roles('operator')
  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateSiteDto, @CurrentUser() actor: CurrentUserType) {
    return this.sites.create(dto, actor);
  }

  @Roles('operator')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSiteDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.sites.update(id, dto, actor);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() actor: CurrentUserType): Promise<void> {
    await this.sites.remove(id, actor);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { RoleName, User } from '@mtk/types';
import { PaginationQuery, paginate } from '../common/dto/pagination.dto.js';
import { Roles } from './decorators/roles.decorator.js';
import { UsersService } from './users.service.js';

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  name!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsIn(['viewer', 'technician', 'operator', 'admin'])
  role?: RoleName;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  siteIds?: string[];
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['viewer', 'technician', 'operator', 'admin'])
  role?: RoleName;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  siteIds?: string[];
}

class SetPasswordDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

/** User administration — admin only. */
@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(@Query() q: PaginationQuery) {
    const { items, total } = await this.users.list({ page: q.page, pageSize: q.pageSize });
    return paginate(items, total, q.page ?? 1, q.pageSize ?? 50);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<User> {
    return this.users.findById(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto): Promise<User> {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<User> {
    return this.users.update(id, dto);
  }

  @Post(':id/password')
  @HttpCode(204)
  async setPassword(@Param('id') id: string, @Body() dto: SetPasswordDto): Promise<void> {
    await this.users.setPassword(id, dto.password);
  }

  @Post(':id/disable')
  disable(@Param('id') id: string): Promise<User> {
    return this.users.setDisabled(id, true);
  }

  @Post(':id/enable')
  enable(@Param('id') id: string): Promise<User> {
    return this.users.setDisabled(id, false);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    // Soft-delete via disable — audit history must keep pointing at the user.
    await this.users.setDisabled(id, true);
  }
}

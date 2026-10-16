import { Controller, Get, Query } from '@nestjs/common';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQuery, paginate } from '../common/dto/pagination.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AuditService } from './audit.service.js';

class AuditQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  routerId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDateString()
  from?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDateString()
  to?: string;
}

/** Append-only audit log query API (technician+ can read; nobody can mutate). */
@Controller('audit')
@Roles('technician')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async query(@Query() q: AuditQuery) {
    const { items, total } = await this.audit.query({
      actorId: q.actorId,
      routerId: q.routerId,
      action: q.action,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      page: q.page,
      pageSize: q.pageSize,
    });
    return paginate(items, total, q.page ?? 1, q.pageSize ?? 50);
  }
}

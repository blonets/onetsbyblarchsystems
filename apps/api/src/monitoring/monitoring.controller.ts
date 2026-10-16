import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { MetricType, MetricsIngestBatch } from '@mtk/types';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Internal } from '../common/decorators/internal.decorator.js';
import { MonitoringService, type HeartbeatInput } from './monitoring.service.js';

class MetricPointDto {
  @IsString()
  ts!: string;
}

class CpuDto extends MetricPointDto {
  @IsString() routerId!: string;
  @Type(() => Number) cpuPct!: number;
}
class MemDto extends MetricPointDto {
  @IsString() routerId!: string;
  @Type(() => Number) totalKb!: number;
  @Type(() => Number) freeKb!: number;
}
class TrafficDto extends MetricPointDto {
  @IsString() routerId!: string;
  @IsString() iface!: string;
  @Type(() => Number) rxBps!: number;
  @Type(() => Number) txBps!: number;
}
class HotspotActiveDto extends MetricPointDto {
  @IsString() routerId!: string;
  @Type(() => Number) activeN!: number;
}

class MetricsIngestDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CpuDto) cpu?: CpuDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MemDto) mem?: MemDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TrafficDto) traffic?: TrafficDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => HotspotActiveDto) hotspotActive?: HotspotActiveDto[];
}

class HeartbeatDto {
  @IsIn(['pending', 'online', 'offline', 'suspect'])
  status!: HeartbeatInput['status'];

  @IsOptional()
  @IsString()
  cause?: string;
}

class MetricsQuery {
  @IsIn(['cpu', 'mem', 'traffic', 'hotspot_active'])
  type!: MetricType;

  /** ISO-8601 start. */
  @IsString()
  from!: string;

  /** ISO-8601 end. */
  @IsString()
  to!: string;

  @IsOptional()
  @IsString()
  iface?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number;
}

/**
 * Monitoring REST: dashboards read metrics + the downtime ledger
 * (technician+); the worker posts metrics batches and heartbeats to the
 * internal endpoints (@Public + @Internal with `x-internal-key`).
 */
@Controller()
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('routers/:routerId/metrics')
  @Roles('technician')
  getMetrics(@Param('routerId') routerId: string, @Query() q: MetricsQuery) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from/to must be ISO-8601 timestamps');
    }
    return this.monitoring.getMetrics(routerId, q.type, from, to, { iface: q.iface, limit: q.limit });
  }

  @Get('routers/:routerId/downtime')
  @Roles('technician')
  listDowntime(
    @Param('routerId') routerId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.monitoring.listDowntime(routerId, Number(page ?? 1), Number(pageSize ?? 50));
  }

  @Post('internal/metrics')
  @Public()
  @Internal()
  @HttpCode(202)
  ingest(@Body() dto: MetricsIngestDto) {
    const batch: MetricsIngestBatch = {
      cpu: dto.cpu,
      mem: dto.mem,
      traffic: dto.traffic,
      hotspotActive: dto.hotspotActive,
    };
    return this.monitoring.ingest(batch).then((r) => ({ accepted: true, ...r }));
  }

  @Post('internal/routers/:routerId/heartbeat')
  @Public()
  @Internal()
  @HttpCode(200)
  heartbeat(@Param('routerId') routerId: string, @Body() dto: HeartbeatDto) {
    return this.monitoring.heartbeat(routerId, { status: dto.status, cause: dto.cause });
  }
}

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

class SessionReportDto {
  @IsString()
  username!: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  macAddress?: string;

  @IsOptional()
  @IsString()
  uptime?: string;

  @IsOptional()
  @IsString()
  server?: string;
}

class SessionsIngestDto {
  @IsString()
  routerId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionReportDto)
  sessions!: SessionReportDto[];
}

class SessionSearchQuery {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  ip?: string;
}

class BulkSelectorDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  routerIds?: string[];

  @IsOptional()
  @IsString()
  tag?: string;
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

  /**
   * Worker/internal: replace the router's reported active hotspot sessions
   * wholesale (poller reports the full /ip/hotspot/active list each cycle).
   */
  @Post('internal/monitoring/sessions')
  @Public()
  @Internal()
  @HttpCode(202)
  ingestSessions(@Body() dto: SessionsIngestDto) {
    return this.monitoring.ingestSessions(dto.routerId, dto.sessions).then((r) => ({ accepted: true, ...r }));
  }

  /**
   * Session lookup: which router(s) a user is online on, by username and/or
   * IP. Aggregates worker-reported active sessions. At least one of
   * `username` / `ip` is required.
   */
  @Get('monitoring/sessions/search')
  @Roles('technician')
  searchSessions(@Query() q: SessionSearchQuery) {
    if (!q.username && !q.ip) {
      throw new BadRequestException('username or ip is required');
    }
    return this.monitoring.searchSessions({ username: q.username, ip: q.ip });
  }

  /**
   * Revenue tile: voucher-mode first-logins today × profile face value
   * (unset price counts as 0 — never faked).
   */
  @Get('monitoring/revenue/today')
  @Roles('technician')
  revenueToday() {
    return this.monitoring.revenueToday();
  }

  /**
   * Bulk status read over a router selector ({ routerIds?, tag? }).
   * Per-router results — one failure never stops the rest.
   */
  @Post('monitoring/bulk/status')
  @Roles('technician')
  @HttpCode(200)
  bulkStatus(@Body() dto: BulkSelectorDto) {
    return this.monitoring.bulkStatus({ routerIds: dto.routerIds, tag: dto.tag });
  }
}

import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { BackupType } from '@mtk/types';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Internal } from '../common/decorators/internal.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import { BackupsService, type BackupCompletedPayload } from './backups.service.js';

class BackupScheduleDto {
  @IsIn(['export', 'binary', 'both'])
  type!: BackupType | 'both';

  /** 5-field cron in the site's local time, e.g. "0 2 * * *". */
  @IsString()
  cron!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(1)
  @Max(365)
  retentionDays!: number;
}

class BackupCompletedDto {
  @IsString() opId!: string;
  @IsString() routerId!: string;
  @IsIn(['export', 'binary']) type!: BackupType;
  @IsString() fileName!: string;
  @IsString() storageKey!: string;
  @IsString() sizeBytes!: string;
  @IsString() sha256!: string;
  @IsString() kmsKeyId!: string;
  @IsString() retentionUntil!: string;
}

/**
 * Backups REST. Reads + schedules: operator+. Run-now: operator+.
 * Restore: admin only. Completion callback: worker/internal only.
 */
@Controller()
@Roles('technician')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get('routers/:routerId/backup-schedules')
  listSchedules(@Param('routerId') routerId: string) {
    return this.backups.listSchedules(routerId);
  }

  @Roles('operator')
  @Put('routers/:routerId/backup-schedules/:type')
  upsertSchedule(
    @Param('routerId') routerId: string,
    @Param('type') type: string,
    @Body() dto: BackupScheduleDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    if (dto.type !== type) {
      throw new BadRequestException('body.type must match the :type path parameter');
    }
    return this.backups.upsertSchedule(routerId, dto, actor);
  }

  @Roles('operator')
  @Delete('routers/:routerId/backup-schedules/:type')
  deleteSchedule(@Param('routerId') routerId: string, @Param('type') type: string, @CurrentUser() actor: CurrentUserType) {
    return this.backups.deleteSchedule(routerId, type, actor).then(() => ({ deleted: true }));
  }

  @Get('routers/:routerId/backups')
  listBackups(
    @Param('routerId') routerId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.backups.listBackups(routerId, Number(page ?? 1), Number(pageSize ?? 50));
  }

  @Roles('operator')
  @Post('routers/:routerId/backups/run-now')
  @HttpCode(202)
  runNow(@Param('routerId') routerId: string, @CurrentUser() actor: CurrentUserType) {
    return this.backups.runNow(routerId, actor);
  }

  @Roles('admin')
  @Post('backups/:backupId/restore')
  @HttpCode(202)
  restore(@Param('backupId') backupId: string, @CurrentUser() actor: CurrentUserType) {
    return this.backups.restore(backupId, actor);
  }

  @Post('internal/backups/completed')
  @Public()
  @Internal()
  @HttpCode(202)
  reportCompleted(@Body() dto: BackupCompletedDto) {
    const payload: BackupCompletedPayload = { ...dto };
    return this.backups.reportCompleted(payload).then((r) => ({ accepted: true, backup: r }));
  }
}

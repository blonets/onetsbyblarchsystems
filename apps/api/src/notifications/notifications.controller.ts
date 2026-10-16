import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import type { BusEventName, NotificationChannel } from '@mtk/types';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import { NotificationsService } from './notifications.service.js';

const EVENTS: BusEventName[] = [
  'router.online',
  'router.offline',
  'hotspot.user.login',
  'hotspot.user.logout',
  'quota.exceeded',
  'backup.completed',
  'config.changed',
  'alert.raised',
];

const CHANNELS: NotificationChannel[] = ['telegram', 'email'];

export class CreateNotificationRuleDto {
  @IsString()
  name!: string;

  @IsIn(EVENTS)
  event!: BusEventName;

  @IsIn(CHANNELS)
  channel!: NotificationChannel;

  /** Telegram chat id or email address. */
  @IsString()
  target!: string;

  @IsOptional()
  @IsString()
  template?: string;
}

export class UpdateNotificationRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(EVENTS)
  event?: BusEventName;

  @IsOptional()
  @IsIn(CHANNELS)
  channel?: NotificationChannel;

  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsString()
  template?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Notification rules REST. Reads: technician+. Mutations: operator+.
 *
 * NOTE: Telegram/email delivery requires channel configuration
 * (`TELEGRAM_BOT_TOKEN` / `SMTP_*`); without it the worker fails notify jobs
 * with a clear NEEDS-CONFIG error. Sends are never faked.
 */
@Controller('notification-rules')
@Roles('technician')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query('event') event?: string) {
    return this.notifications.listRules(event);
  }

  @Get('events')
  events() {
    return { events: this.notifications.subscribedEvents(), channels: CHANNELS };
  }

  @Roles('operator')
  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateNotificationRuleDto, @CurrentUser() actor: CurrentUserType) {
    return this.notifications.createRule(dto, actor);
  }

  @Roles('operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNotificationRuleDto, @CurrentUser() actor: CurrentUserType) {
    return this.notifications.updateRule(id, dto, actor);
  }

  @Roles('operator')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.notifications.deleteRule(id).then(() => ({ deleted: true }));
  }

  /** Enqueue a clearly-labeled test notification through a rule. */
  @Roles('operator')
  @Post(':id/test')
  @HttpCode(202)
  test(@Param('id') id: string, @CurrentUser() actor: CurrentUserType) {
    return this.notifications.testRule(id, actor);
  }
}

import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import { FirewallService } from './firewall.service.js';

class JournalQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/**
 * Firewall rollback journal REST (sits next to the rules controller).
 * Reads: technician+. Rollback: operator+ — restoring a snapshot is a
 * mutating firewall change (audited, enqueued, safe-applied for filter).
 */
@Controller('routers/:routerId/firewall')
@Roles('technician')
export class FirewallJournalController {
  constructor(private readonly firewall: FirewallService) {}

  @Get('journal')
  listJournal(
    @Param('routerId') routerId: string,
    @Query() q: JournalQuery,
  ) {
    return this.firewall.listJournals(routerId, q.limit);
  }

  /**
   * Roll back a journaled change: restores the before-snapshot; rules the
   * journaled op created are REVOKED (revoked=true, disabled) — never
   * hard-deleted.
   */
  @Roles('operator')
  @Post('rollback/:journalId')
  @HttpCode(202)
  rollback(
    @Param('routerId') routerId: string,
    @Param('journalId') journalId: string,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.firewall.rollbackJournal(routerId, journalId, actor);
  }
}

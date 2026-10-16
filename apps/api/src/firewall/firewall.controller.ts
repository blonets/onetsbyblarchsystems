import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserType } from '../common/types.js';
import {
  CreateFirewallRuleDto,
  ListFirewallRulesQuery,
  MoveFirewallRuleDto,
  UpdateFirewallRuleDto,
} from './dto/firewall.dto.js';
import { FirewallService } from './firewall.service.js';

/**
 * Firewall manager REST. Reads: technician+. Mutations: operator+
 * (technicians cannot change firewall rules). Filter-table mutations are
 * safe-applied: the worker verifies the router is still reachable ~60 s
 * after apply and rolls back on failure.
 */
@Controller('routers/:routerId/firewall/rules')
@Roles('technician')
export class FirewallController {
  constructor(private readonly firewall: FirewallService) {}

  @Get()
  list(@Param('routerId') routerId: string, @Query() q: ListFirewallRulesQuery) {
    return this.firewall.listRules(routerId, q);
  }

  @Roles('operator')
  @Post()
  @HttpCode(201)
  create(
    @Param('routerId') routerId: string,
    @Body() dto: CreateFirewallRuleDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.firewall.createRule(routerId, dto, actor);
  }

  @Roles('operator')
  @Patch(':id')
  update(
    @Param('routerId') routerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFirewallRuleDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.firewall.updateRule(routerId, id, dto, actor);
  }

  @Roles('operator')
  @Post(':id/enable')
  enable(
    @Param('routerId') routerId: string,
    @Param('id') id: string,
    @Body('opId') opId: string | undefined,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.firewall.setRuleDisabled(routerId, id, false, opId, actor);
  }

  @Roles('operator')
  @Post(':id/disable')
  disable(
    @Param('routerId') routerId: string,
    @Param('id') id: string,
    @Body('opId') opId: string | undefined,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.firewall.setRuleDisabled(routerId, id, true, opId, actor);
  }

  /**
   * Reorder within (table, chain): `{ "beforeId": "<id>" }` or `{ "toEnd": true }`.
   */
  @Roles('operator')
  @Post(':id/move')
  move(
    @Param('routerId') routerId: string,
    @Param('id') id: string,
    @Body() dto: MoveFirewallRuleDto,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.firewall.moveRule(routerId, id, dto, actor);
  }

  @Roles('operator')
  @Delete(':id')
  remove(
    @Param('routerId') routerId: string,
    @Param('id') id: string,
    @Body('opId') opId: string | undefined,
    @CurrentUser() actor: CurrentUserType,
  ) {
    return this.firewall.deleteRule(routerId, id, opId, actor);
  }
}

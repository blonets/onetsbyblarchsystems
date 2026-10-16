import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_RANK, type RoleName } from '@mtk/types';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * Global guard: enforces `@Roles(...)` by privilege *rank*, not name.
 * `@Roles('operator')` passes for operator AND admin (rank >= required).
 * Roles with no listed rank are treated as rank 0 (deny).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const minRequired = Math.min(...required.map((r) => ROLE_RANK[r as RoleName] ?? Infinity));
    if (!Number.isFinite(minRequired)) return true;

    const userRoles: string[] = context.switchToHttp().getRequest().user?.roles ?? [];
    const userRank = Math.max(0, ...userRoles.map((r) => ROLE_RANK[r as RoleName] ?? 0));
    if (userRank < minRequired) {
      throw new ForbiddenException('insufficient role');
    }
    return true;
  }
}

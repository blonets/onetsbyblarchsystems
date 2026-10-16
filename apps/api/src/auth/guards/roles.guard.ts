import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/** Global guard: enforces `@Roles(...)` against `req.user.roles`. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const roles: string[] = context.switchToHttp().getRequest().user?.roles ?? [];
    if (!required.some((r) => roles.includes(r))) {
      throw new ForbiddenException('insufficient role');
    }
    return true;
  }
}

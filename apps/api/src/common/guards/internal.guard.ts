import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { INTERNAL_KEY } from '../decorators/internal.decorator.js';

/**
 * Global guard: on routes marked @Internal(), requires the `x-internal-key`
 * request header to equal INTERNAL_API_KEY. Fail-closed: when the env var is
 * unset, every internal route is denied.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const internal = this.reflector.getAllAndOverride<boolean>(INTERNAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!internal) return true;
    const expected = this.config.get<string>('INTERNAL_API_KEY');
    if (!expected) {
      throw new UnauthorizedException('internal API key is not configured');
    }
    const request = context.switchToHttp().getRequest();
    const provided: string | undefined = request.headers?.['x-internal-key'];
    if (provided !== expected) {
      throw new UnauthorizedException('invalid internal key');
    }
    return true;
  }
}

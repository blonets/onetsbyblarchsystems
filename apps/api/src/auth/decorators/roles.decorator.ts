import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Require one of the given roles (checked against `req.user.roles`). */
export const Roles = (...roles: string[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);

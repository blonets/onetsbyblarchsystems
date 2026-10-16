import { SetMetadata } from '@nestjs/common';

export const INTERNAL_KEY = 'internal';

/**
 * Marks a route as worker/internal-only. Combined with @Public() (skips JWT),
 * the InternalGuard then requires the `x-internal-key` header to match
 * INTERNAL_API_KEY. Fails closed when the env var is unset.
 */
export const Internal = (): ReturnType<typeof SetMetadata> => SetMetadata(INTERNAL_KEY, true);

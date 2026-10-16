/**
 * Exponential backoff with jitter for reconnect loops.
 *
 * Delays: baseMs, 2*baseMs, 4*baseMs, … capped at maxMs. Jitter multiplies the
 * delay by a uniform factor in [0.5, 1.0] so a fleet of workers does not retry
 * in lockstep. The `sleep` and `random` functions are injectable so tests can
 * assert the exact schedule deterministically.
 */

export interface BackoffOptions {
  /** total attempts including the first (default 5) */
  maxAttempts?: number;
  /** base delay in ms (default 500) */
  baseMs?: number;
  /** cap per delay in ms (default 30_000) */
  maxMs?: number;
  /** apply 0.5–1.0 jitter (default true) */
  jitter?: boolean;
}

export interface BackoffDeps {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface BackoffResult<T> {
  value: T;
  /** attempts used (1 = first try succeeded) */
  attempts: number;
}

/**
 * Run `op` until it succeeds or attempts are exhausted. Rejects with the last
 * error. `shouldRetry` can veto a retry (e.g. auth failures are not transient).
 */
export async function withBackoff<T>(
  op: (attempt: number) => Promise<T>,
  options: BackoffOptions = {},
  deps: BackoffDeps = {},
  shouldRetry: (err: unknown, attempt: number) => boolean = () => true,
): Promise<BackoffResult<T>> {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseMs = options.baseMs ?? 500;
  const maxMs = options.maxMs ?? 30_000;
  const jitter = options.jitter ?? true;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return { value: await op(attempt), attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !shouldRetry(err, attempt)) break;
      const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      await sleep(jitter ? Math.floor(delay * (0.5 + random() * 0.5)) : delay);
    }
  }
  throw lastError;
}

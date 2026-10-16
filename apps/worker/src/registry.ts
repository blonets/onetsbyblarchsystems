/**
 * Router registry — resolves a router id to its RouterOS API endpoint.
 *
 * Credentials NEVER live in files or git: the registry hands the worker
 * endpoint descriptors, and passwords are supplied only via the process
 * environment at runtime (vault/KMS reference) or fetched from the API's
 * internal credentials endpoint (itself bearer-authenticated).
 */

export interface RouterEndpoint {
  routerId: string;
  /** platform uuid stamped in /system note (for bus events) */
  uuid: string;
  /** tunnel-side address, e.g. 10.200.0.7 (never the site's WAN IP) */
  host: string;
  /** per-router configurable RouterOS API port (never hard-coded) */
  apiPort: number;
  username: string;
  /** resolved from the environment / vault at runtime — never persisted */
  password: string;
  /** display identity for logs */
  identity?: string;
}

export interface RouterRegistry {
  /** All router ids this deployment manages. */
  listRouterIds(): Promise<string[]>;
  /** Endpoint for one router; throws when unknown. */
  getEndpoint(routerId: string): Promise<RouterEndpoint>;
}

export class UnknownRouterError extends Error {
  constructor(routerId: string) {
    super(`unknown router: ${routerId}`);
    this.name = 'UnknownRouterError';
  }
}

/**
 * Static registry for tests and for single-router live validation.
 * Passwords come from env vars named in `passwordEnv`.
 */
export class StaticRouterRegistry implements RouterRegistry {
  constructor(
    private readonly entries: Array<{
      routerId: string;
      host: string;
      apiPort: number;
      username: string;
      passwordEnv: string;
      identity?: string;
    }>,
  ) {}

  async listRouterIds(): Promise<string[]> {
    return this.entries.map((e) => e.routerId);
  }

  async getEndpoint(routerId: string): Promise<RouterEndpoint> {
    const entry = this.entries.find((e) => e.routerId === routerId);
    if (!entry) throw new UnknownRouterError(routerId);
    const password = process.env[entry.passwordEnv];
    if (!password) {
      throw new Error(
        `credential env var ${entry.passwordEnv} is not set (router ${routerId}) — refusing to connect without a password`,
      );
    }
    return {
      routerId,
      uuid: routerId, // static registry has no uuid column; tests use the id
      host: entry.host,
      apiPort: entry.apiPort,
      username: entry.username,
      password,
      identity: entry.identity,
    };
  }
}

/**
 * HTTP registry backed by the platform API (deploy-time wiring).
 * The API owns the Router table + vault references; the worker fetches
 * endpoint descriptors and short-lived per-router passwords from the API's
 * internal endpoints with a service bearer token.
 */
export class HttpRouterRegistry implements RouterRegistry {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listRouterIds(): Promise<string[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/worker/routers`, {
      headers: { authorization: `Bearer ${this.serviceToken}` },
    });
    if (!res.ok) throw new Error(`router registry list failed: HTTP ${res.status}`);
    const body = (await res.json()) as { routerIds: string[] };
    return body.routerIds;
  }

  async getEndpoint(routerId: string): Promise<RouterEndpoint> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/internal/worker/routers/${encodeURIComponent(routerId)}/endpoint`,
      { headers: { authorization: `Bearer ${this.serviceToken}` } },
    );
    if (res.status === 404) throw new UnknownRouterError(routerId);
    if (!res.ok) throw new Error(`router endpoint fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as Omit<RouterEndpoint, 'password'> & { password: string };
    return { ...body, routerId };
  }
}

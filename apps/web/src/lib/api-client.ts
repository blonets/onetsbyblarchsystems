import type { RouterStatus } from '@mtk/types';

export interface RouterSummary {
  id: string;
  identity: string;
  siteName: string;
  status: RouterStatus;
  tunnelIp?: string;
  rosVersion?: string;
  lastSeenAt?: string;
}

export interface ApiClient {
  listRouters(): Promise<RouterSummary[]>;
  getRouter(id: string): Promise<RouterSummary | null>;
}

/**
 * MOCK adapter — clearly marked demo data. Lets the dashboard shell render
 * without a running API.
 *
 * TODO: replace with `HttpApiClient` hitting `process.env.NEXT_PUBLIC_API_URL`
 * (GET /routers → RouterSummary[]). Sketch:
 *
 *   export class HttpApiClient implements ApiClient {
 *     constructor(private readonly baseUrl: string) {}
 *     async listRouters(): Promise<RouterSummary[]> {
 *       const res = await fetch(`${this.baseUrl}/routers`, { cache: 'no-store' });
 *       if (!res.ok) throw new Error(`api ${res.status}`);
 *       return res.json();
 *     }
 *     ...
 *   }
 */
export class MockApiClient implements ApiClient {
  private readonly fixtures: RouterSummary[] = [
    { id: 'r-hub', identity: 'hub-chr', siteName: 'Hub — Frankfurt', status: 'online', tunnelIp: '10.200.0.1', rosVersion: '7.14.2', lastSeenAt: '2026-10-16T07:30:00Z' },
    { id: 'r-001', identity: 'cafe-maadi-01', siteName: 'Cairo — Maadi', status: 'online', tunnelIp: '10.200.0.2', rosVersion: '7.14.2', lastSeenAt: '2026-10-16T07:31:12Z' },
    { id: 'r-002', identity: 'rest-zamalek-02', siteName: 'Cairo — Zamalek', status: 'online', tunnelIp: '10.200.0.3', rosVersion: '6.49.13', lastSeenAt: '2026-10-16T07:29:44Z' },
    { id: 'r-003', identity: 'hotel-hurghada-01', siteName: 'Hurghada', status: 'offline', tunnelIp: '10.200.0.4', rosVersion: '7.12.1', lastSeenAt: '2026-10-16T05:12:03Z' },
    { id: 'r-004', identity: 'cafe-alex-01', siteName: 'Alexandria', status: 'provisioning', tunnelIp: '10.200.0.5', lastSeenAt: undefined },
    { id: 'r-005', identity: 'rest-giza-01', siteName: 'Giza', status: 'error', tunnelIp: '10.200.0.6', rosVersion: '7.14.2', lastSeenAt: '2026-10-16T06:58:20Z' },
  ];

  private async latency(): Promise<void> {
    await new Promise((r) => setTimeout(r, 250));
  }

  async listRouters(): Promise<RouterSummary[]> {
    await this.latency();
    return this.fixtures;
  }

  async getRouter(id: string): Promise<RouterSummary | null> {
    await this.latency();
    return this.fixtures.find((r) => r.id === id) ?? null;
  }
}

export const apiClient: ApiClient = new MockApiClient();

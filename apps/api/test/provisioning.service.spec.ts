import { describe, expect, it } from 'vitest';
import type { Transport } from '@mtk/ros-api';
import {
  allocateTunnelIp,
  generateRouterCredentials,
  issueOnboardingToken,
} from '../src/provisioning/credentials.js';
import { ProvisioningService } from '../src/provisioning/provisioning.service.js';

/** Minimal in-memory Transport — no network. */
class FakeTransport implements Transport {
  readonly sent: string[][] = [];
  private queue: string[][] = [];
  private connected = false;

  constructor(private readonly respond: (sent: string[]) => string[][] = () => [['!done']]) {}

  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  onClose(): void {}
  async sendSentence(words: string[]): Promise<void> {
    this.sent.push(words);
    this.queue.push(...this.respond(words));
  }
  async readSentence(): Promise<string[]> {
    const next = this.queue.shift();
    if (!next) throw new Error('no scripted reply');
    return next;
  }
}

describe('generateRouterCredentials', () => {
  it('produces unique usernames and strong passwords', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const { username, password } = generateRouterCredentials();
      expect(username).toMatch(/^sstp-[0-9a-f]{12}$/);
      expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(seen.has(username)).toBe(false);
      seen.add(username);
    }
  });
});

describe('allocateTunnelIp', () => {
  it('starts at 10.200.0.2 (skips network .0 and hub .1)', () => {
    expect(allocateTunnelIp(new Set())).toBe('10.200.0.2');
  });

  it('returns the first free IP', () => {
    expect(allocateTunnelIp(new Set(['10.200.0.2', '10.200.0.3']))).toBe('10.200.0.4');
  });

  it('skips .0/.255 endings and rolls into the next /24', () => {
    const used = new Set<string>();
    for (let d = 2; d <= 254; d++) used.add(`10.200.0.${d}`);
    expect(allocateTunnelIp(used)).toBe('10.200.1.1');
  });

  it('respects a custom hub IP', () => {
    // hub at 10.200.0.3 → 10.200.0.1 is allocatable
    expect(allocateTunnelIp(new Set(['10.200.0.1']), '10.200.0.3')).toBe('10.200.0.2');
    expect(allocateTunnelIp(new Set(), '10.200.0.2')).toBe('10.200.0.1');
  });

  it('throws when the pool is exhausted', () => {
    const used = new Set<string>();
    for (let c = 0; c <= 255; c++) {
      for (let d = 1; d <= 254; d++) {
        const ip = `10.200.${c}.${d}`;
        if (ip !== '10.200.0.1') used.add(ip);
      }
    }
    expect(() => allocateTunnelIp(used)).toThrow(/exhausted/);
  });
});

describe('issueOnboardingToken', () => {
  it('issues a 24h token bound to the router', () => {
    const now = Date.UTC(2026, 9, 16, 12, 0, 0);
    const t = issueOnboardingToken('router-uuid-1', 24, now);
    expect(t.token).toMatch(/^[0-9a-f]{64}$/);
    expect(t.routerId).toBe('router-uuid-1');
    expect(t.expiresAt).toBe(new Date(now + 24 * 3_600_000).toISOString());
  });
});

describe('ProvisioningService.provisionRouterOnHub', () => {
  it('logs into the hub and adds the /ppp secret — no network', async () => {
    const transports: FakeTransport[] = [];
    const svc = new ProvisioningService(
      { hubHost: 'hub.test', hubPort: 8728, hubUsername: 'api', hubPassword: 'pw' },
      (host, port) => {
        expect(host).toBe('hub.test');
        expect(port).toBe(8728);
        const t = new FakeTransport();
        transports.push(t);
        return t;
      },
    );

    await svc.provisionRouterOnHub({
      routerUuid: 'uuid-1',
      sstpUsername: 'sstp-abc123',
      sstpPassword: 'secret-pw',
      tunnelIp: '10.200.0.7',
    });

    const sent = transports[0]!.sent;
    // 1. modern login against the hub API user
    expect(sent[0]).toEqual(['/login', '=name=api', '=password=pw']);
    // 2. the hub-side SSTP secret with static tunnel IP + uuid comment
    expect(sent[1]).toEqual([
      '/ppp/secret/add',
      '=name=sstp-abc123',
      '=password=secret-pw',
      '=service=sstp',
      '=profile=default',
      '=remote-address=10.200.0.7',
      '=comment=panel-router:uuid-1',
    ]);
    // 3. connection closed afterwards
    expect(transports[0]!.isConnected()).toBe(false);
  });

  it('propagates hub-side failures', async () => {
    const svc = new ProvisioningService(
      { hubHost: 'hub.test', hubPort: 8728, hubUsername: 'api', hubPassword: 'pw' },
      () => new FakeTransport(() => [['!trap', '=message=no such command prefix']]),
    );
    await expect(
      svc.provisionRouterOnHub({
        routerUuid: 'uuid-1',
        sstpUsername: 'sstp-x',
        sstpPassword: 'pw',
        tunnelIp: '10.200.0.9',
      }),
    ).rejects.toThrow(/no such command prefix/);
  });
});

describe('ProvisioningService.provisionNewRouter', () => {
  it('orchestrates credentials + IP + hub secret, never returning the password', async () => {
    const transports: FakeTransport[] = [];
    const svc = new ProvisioningService(
      { hubHost: 'hub.test', hubPort: 8728, hubUsername: 'api', hubPassword: 'pw' },
      () => {
        const t = new FakeTransport();
        transports.push(t);
        return t;
      },
    );

    const result = await svc.provisionNewRouter({
      routerUuid: 'uuid-9',
      usedTunnelIps: ['10.200.0.2', '10.200.0.3'],
    });

    expect(result.sstpUsername).toMatch(/^sstp-[0-9a-f]{12}$/);
    expect(result.tunnelIp).toBe('10.200.0.4');
    expect(result).not.toHaveProperty('sstpPassword');
    const pppAdd = transports[0]!.sent[1]!;
    expect(pppAdd).toContain('=remote-address=10.200.0.4');
    expect(pppAdd).toContain('=comment=panel-router:uuid-9');
  });
});

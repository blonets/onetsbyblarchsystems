import { describe, expect, it } from 'vitest';
import type { Transport } from '@mtk/ros-api';
import { AuditService } from '../src/audit/audit.service.js';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { EventsService } from '../src/events/events.module.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { InMemoryVault } from '../src/vault/vault.port.js';
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
/** Wiring for service-level tests: real service, fake DB/vault/jobs, fake transport. */
function makeService(
  respond: (sent: string[]) => string[][] = () => [['!done']],
  hubHost = 'vpn.onetsbyblarch.online',
) {
  const transports: FakeTransport[] = [];
  const db = new InMemoryDatabase();
  const vault = new InMemoryVault();
  const jobs = new InMemoryJobs();
  const events = new EventsService();
  const audit = new AuditService(db);
  const svc = new ProvisioningService(
    {
      hubHost,
      hubPort: 8728,
      hubUsername: 'api',
      hubPassword: 'pw',
      hubPppProfile: 'sstp-profile',
      panelHost: 'admin.onetsbyblarch.online',
    },
    db,
    vault,
    jobs,
    events,
    audit,
    (_host, _port) => {
      const t = new FakeTransport(respond);
      transports.push(t);
      return t;
    },
  );
  return { svc, db, vault, jobs, events, transports };
}

const ACTOR = { sub: 'user-1', email: 'tech@example.com', role: 'technician', roles: ['technician'] };

async function seedUser(db: InMemoryDatabase): Promise<void> {
  const role = await db.roles.create({ name: 'technician', description: null });
  await db.users.create({
    id: 'user-1',
    email: 'tech@example.com',
    name: 'Tech',
    passwordHash: 'x',
    roleId: role.id,
  });
}

describe('ProvisioningService.issueToken', () => {
  it('mints credentials, creates the hub secret, persists the token — never returns passwords', async () => {
    const { svc, db, transports } = makeService();
    await seedUser(db);

    const result = await svc.issueToken({}, ACTOR);

    expect(result.sstpUsername).toMatch(/^sstp-[0-9a-f]{12}$/);
    expect(result.tunnelIp).toBe('10.200.0.2');
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result).not.toHaveProperty('sstpPassword');
    expect(result).not.toHaveProperty('apiPassword');
    expect(result.fetchCommand).toContain(`/api/v1/onboard/${result.token}/onboard.rsc`);

    // 15-minute TTL
    const ttlMs = new Date(result.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(14 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60_000);

    // hub got login + /ppp/secret/add with the live-validated profile
    const sent = transports[0]!.sent;
    expect(sent[0]![0]).toBe('/login');
    const add = sent[1]!;
    expect(add[0]).toBe('/ppp/secret/add');
    expect(add).toContain(`=name=${result.sstpUsername}`);
    expect(add).toContain('=service=sstp');
    expect(add).toContain('=profile=sstp-profile');
    expect(add).toContain(`=remote-address=${result.tunnelIp}`);
    expect(transports[0]!.isConnected()).toBe(false);

    // token row persisted with vault refs (never plaintext)
    const row = await db.onboardingTokens.findUnique({ token: result.token });
    expect(row).not.toBeNull();
    expect(row!.sstpPasswordRef).toMatch(/^mem:/);
    expect(row!.usedAt).toBeNull();
  });

  it('propagates hub-side failures', async () => {
    // Live-verified device contract: a failed command sends `!trap` BEFORE the
    // final `!done` — the fake must script both, otherwise talkRaw() blocks on
    // the missing terminator.
    const { svc, db } = makeService(() => [
      ['!trap', '=message=no such command prefix'],
      ['!done'],
    ]);
    await seedUser(db);
    await expect(svc.issueToken({}, ACTOR)).rejects.toThrow(/no such command prefix/);
  });
});

describe('ProvisioningService hub-secret safety', () => {
  it('refuses to delete the protected sstp-test-01 secret', async () => {
    const { svc, transports } = makeService();
    await expect(svc.deleteHubSecretByName('sstp-test-01')).rejects.toThrow(/protected/);
    expect(transports).toHaveLength(0); // never even dialed the hub
  });

  it('refuses unmanaged secret names', async () => {
    const { svc, transports } = makeService();
    await expect(svc.deleteHubSecretByName('admin')).rejects.toThrow(/unmanaged/);
    expect(transports).toHaveLength(0);
  });

  it('creates disposable test secrets with the test-del- prefix', async () => {
    const { svc, transports } = makeService();
    const { name, tunnelIp } = await svc.createDisposableTestSecret();
    expect(name).toMatch(/^test-del-[0-9a-f]{6}$/);
    expect(tunnelIp).toBe('10.200.0.2');
    const add = transports[0]!.sent[1]!;
    expect(add).toContain(`=name=${name}`);
  });
});

describe('ProvisioningService onboarding flow', () => {
  it('renders onboard.rsc against the DNS hub address and completes the callback', async () => {
    const { svc, db, jobs, events } = makeService();
    await seedUser(db);

    const issued = await svc.issueToken({}, ACTOR);
    const script = await svc.getOnboardScript(issued.token);

    // DNS-parameterized: no hardcoded IP in generated artifacts
    expect(script).toContain('connect-to="vpn.onetsbyblarch.online"');
    expect(script).not.toContain('34.91.70.17');
    expect(script).toContain(`/api/v1/onboard/${issued.token}/callback`);
    expect(script).toContain('panel-uuid=');

    const onlineEvents: unknown[] = [];
    events.onEvent('router.online', (p) => onlineEvents.push(p));

    const { routerId } = await svc.handleCallback(issued.token, {
      uuid: 'router-uuid-1',
      version: '6.49.17',
      board: 'CHR',
    });

    const router = await db.routers.findUnique({ id: routerId });
    expect(router).not.toBeNull();
    expect(router!.uuid).toBe('router-uuid-1');
    expect(router!.tunnelIp).toBe(issued.tunnelIp);
    expect(router!.status).toBe('online');
    expect(router!.sstpPasswordRef).toMatch(/^mem:/);

    // token burned
    const tokenRow = await db.onboardingTokens.findUnique({ token: issued.token });
    expect(tokenRow!.usedAt).not.toBeNull();
    expect(tokenRow!.routerId).toBe(routerId);

    // bus event + worker job
    expect(onlineEvents).toHaveLength(1);
    const pending = jobs.pending('provision');
    expect(pending.map((j) => j.name)).toContain('verify-tunnel');

    // duplicate callback is idempotent
    const retry = await svc.handleCallback(issued.token, { uuid: 'router-uuid-1' });
    expect(retry.routerId).toBe(routerId);
  });

  it('rejects burned or expired tokens', async () => {
    const { svc, db } = makeService();
    await seedUser(db);
    const issued = await svc.issueToken({}, ACTOR);
    await db.onboardingTokens.update({ token: issued.token }, { usedAt: new Date() });
    await expect(svc.getOnboardScript(issued.token)).rejects.toThrow(/unknown or burned/);
    await expect(svc.handleCallback(issued.token, { uuid: 'x' })).rejects.toThrow(/unknown or burned/);
  });
});

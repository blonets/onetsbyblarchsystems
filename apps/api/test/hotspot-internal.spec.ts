import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY } from '../src/auth/decorators/public.decorator.js';
import { INTERNAL_KEY } from '../src/common/decorators/internal.decorator.js';
import { RouterCommandsService } from '../src/commands/commands.service.js';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { InMemoryVault } from '../src/vault/vault.port.js';
import { AuditService } from '../src/audit/audit.service.js';
import { EventsService } from '../src/events/events.module.js';
import { HotspotInternalController } from '../src/hotspot/hotspot-internal.controller.js';
import { HotspotService } from '../src/hotspot/hotspot.service.js';

/**
 * Contract test for the worker expiry sweep:
 * GET /internal/worker/routers/:id/hotspot-users must expose every user
 * record with an `expiryMode` field; unknown router → 404 (sweep treats as
 * empty); the route must be @Public + @Internal (x-internal-key), never JWT.
 */
describe('HotspotInternalController (worker sweep contract)', () => {
  let db: InMemoryDatabase;
  let service: HotspotService;
  let controller: HotspotInternalController;
  let routerId: string;

  beforeEach(async () => {
    db = new InMemoryDatabase();
    const vault = new InMemoryVault();
    const jobs = new InMemoryJobs();
    const audit = new AuditService(db as never);
    const events = new EventsService();
    const realtime = { emitToRouter: () => undefined, emitToSite: () => undefined };
    const commands = new RouterCommandsService(
      db as never, jobs as never, realtime as never, events, audit,
    );
    service = new HotspotService(db as never, vault as never, commands as never);
    controller = new HotspotInternalController(service);

    const router = await db.routers.create({
      uuid: 'sweep-router', tunnelIp: '10.200.9.9',
      sstpUsername: 'sstp-sweep', sstpPasswordRef: 'ref', apiPasswordRef: 'ref',
    } as never);
    routerId = (router as { id: string }).id;
  });

  it('returns every user with an expiryMode field', async () => {
    await service.createUser(routerId, { name: 'u-expire', expiryMode: 'remove' } as never);
    await service.createUser(routerId, { name: 'u-keep' } as never); // default 'none'
    const users = await controller.listUsers(routerId);
    expect(users).toHaveLength(2);
    const byName = new Map(users.map((u) => [u.name, u]));
    expect(byName.get('u-expire')!.expiryMode).toBe('remove');
    expect(byName.get('u-keep')!.expiryMode).toBe('none');
    // Sweep also needs the expiry clocks on the same record.
    for (const u of users) {
      expect(u).toHaveProperty('expiresAt');
      expect(u).toHaveProperty('validityFromFirstLogin');
      expect(u).toHaveProperty('validitySeconds');
      expect(u).toHaveProperty('firstLoginAt');
      expect(u).not.toHaveProperty('password');
    }
  });

  it('throws NotFoundException for an unknown router (→ 404, sweep treats as empty)', async () => {
    await expect(controller.listUsers('no-such-router')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is @Public + @Internal (service-key auth, no JWT)', () => {
    const handler = Object.getOwnPropertyDescriptor(HotspotInternalController.prototype, 'listUsers')!.value;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(INTERNAL_KEY, handler)).toBe(true);
  });
});

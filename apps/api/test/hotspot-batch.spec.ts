import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { InMemoryVault } from '../src/vault/vault.port.js';
import { AuditService } from '../src/audit/audit.service.js';
import { EventsService } from '../src/events/events.module.js';
import { RouterCommandsService } from '../src/commands/commands.service.js';
import { HotspotService, computeUserExpiry } from '../src/hotspot/hotspot.service.js';
import {
  CLEAR_ALPHABET,
  HotspotBatchService,
  encodeBatchComment,
  randomCode,
} from '../src/hotspot/hotspot-batch.service.js';

function harness() {
  const db = new InMemoryDatabase();
  const vault = new InMemoryVault();
  const jobs = new InMemoryJobs();
  const audit = new AuditService(db as never);
  const events = new EventsService();
  const realtime = { emitToRouter: () => undefined, emitToSite: () => undefined };
  const commands = new RouterCommandsService(db as never, jobs as never, realtime as never, events, audit);
  const hotspot = new HotspotService(db as never, vault as never, commands as never);
  const batches = new HotspotBatchService(db as never, vault as never, commands as never);
  return { db, vault, jobs, hotspot, batches };
}

async function makeRouter(db: InMemoryDatabase): Promise<string> {
  const row = (await db.routers.create({
    uuid: `batch-${Math.random()}`, tunnelIp: `10.200.9.${Math.floor(Math.random() * 200) + 10}`,
    sstpUsername: `sstp-${Math.random()}`, sstpPasswordRef: 'ref', apiPasswordRef: 'ref',
  } as never)) as { id: string };
  return row.id;
}

describe('batch code generation', () => {
  it('CLEAR_ALPHABET strips l,L,q,Q,o,O,1,0', () => {
    for (const c of ['l', 'L', 'q', 'Q', 'o', 'O', '1', '0']) {
      expect(CLEAR_ALPHABET).not.toContain(c);
    }
    expect(CLEAR_ALPHABET.length).toBe(62 - 8);
  });

  it('randomCode honors length and the clear alphabet', () => {
    const code = randomCode(12, true);
    expect(code).toHaveLength(12);
    for (const c of code) expect(CLEAR_ALPHABET).toContain(c);
    const full = randomCode(200, false);
    expect(full).toHaveLength(200); // exercises the full alphabet path
  });

  it('encodeBatchComment follows vc-<batchId>-<YYYYMMDD>-<note>', () => {
    const at = new Date('2026-10-16T10:00:00Z');
    expect(encodeBatchComment('vc', 'ab12cd34', at, 'cafe promo')).toBe('vc-ab12cd34-20261016-cafe-promo');
    expect(encodeBatchComment('up', 'ff00ff00', at)).toBe('up-ff00ff00-20261016');
  });
});

describe('generateBatch', () => {
  let h: ReturnType<typeof harness>;
  let routerId: string;
  beforeEach(async () => {
    h = harness();
    routerId = await makeRouter(h.db);
  });

  it('vc mode: username == password (single code), one job, encoded comments', async () => {
    const res = await h.batches.generateBatch(routerId, { mode: 'vc', count: 3, prefix: 'CAFE-', opId: 'op-vc-1' });
    expect(res.replayed).toBe(false);
    expect(res.batch.mode).toBe('vc');
    expect(res.users).toHaveLength(3);

    // Exactly ONE BullMQ job for the whole batch.
    const pending = h.jobs.pending('commands');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('op-vc-1');
    expect(pending[0].data.sentences).toHaveLength(3);

    for (const u of res.users) {
      expect(u.name.startsWith('CAFE-')).toBe(true);
      expect(u.comment).toMatch(/^vc-[0-9a-f]{8}-202\d{5}-?/);
      const row = (await h.db.hotspotUsers.findUnique({ id: u.id })) as { passwordRef: string; mode: string; batchId: string };
      expect(row.mode).toBe('vc');
      expect(row.batchId).toBe(res.batch.id);
      const password = await h.vault.retrieve(row.passwordRef);
      expect(password).toBe(u.name); // voucher: username == password
    }
  });

  it('up mode: username + independent random password', async () => {
    const res = await h.batches.generateBatch(routerId, { mode: 'up', count: 5, codeLength: 10, opId: 'op-up-1' });
    expect(res.users).toHaveLength(5);
    const names = new Set(res.users.map((u) => u.name));
    expect(names.size).toBe(5); // unique
    for (const u of res.users) {
      const row = (await h.db.hotspotUsers.findUnique({ id: u.id })) as { passwordRef: string };
      const password = await h.vault.retrieve(row.passwordRef);
      expect(password).toHaveLength(10);
      expect(password).not.toBe(u.name);
      expect(u.comment.startsWith('up-')).toBe(true);
    }
  });

  it('is idempotent by batch opId — replay creates nothing', async () => {
    const first = await h.batches.generateBatch(routerId, { mode: 'vc', count: 2, opId: 'op-replay-1' });
    const second = await h.batches.generateBatch(routerId, { mode: 'vc', count: 2, opId: 'op-replay-1' });
    expect(second.replayed).toBe(true);
    expect(second.batch.id).toBe(first.batch.id);
    expect(await h.db.hotspotUsers.count({ routerId })).toBe(2);
    expect(h.jobs.pending('commands')).toHaveLength(1);
  });

  it('inherits profile defaults (limitUptime, validitySeconds, expiryMode) explicitly', async () => {
    const profile = (await h.db.hotspotUserProfiles.create({
      routerId, name: 'plan-gold', limitUptime: '12:00:00', validitySeconds: 86400,
      expiryMode: 'remove+notify', price: 50,
    } as never)) as { id: string };
    const res = await h.batches.generateBatch(routerId, {
      mode: 'vc', count: 1, profileId: profile.id, opId: 'op-inherit-1',
    });
    const row = (await h.db.hotspotUsers.findUnique({ id: res.users[0].id })) as {
      limitUptime: string; validitySeconds: number; expiryMode: string; validityFromFirstLogin: boolean;
    };
    expect(row.limitUptime).toBe('12:00:00');
    expect(row.validitySeconds).toBe(86400);
    expect(row.expiryMode).toBe('remove+notify');
    expect(row.validityFromFirstLogin).toBe(false); // explicit default, not conflated
    // The device sentence carries limit-uptime (session cap), not the validity clock.
    const job = h.jobs.pending('commands')[0];
    const sentence = (job.data.sentences[0] as string[]).join(' ');
    expect(sentence).toContain('=limit-uptime=12:00:00');
  });

  it('dto values win over profile defaults', async () => {
    const profile = (await h.db.hotspotUserProfiles.create({
      routerId, name: 'plan-x', limitUptime: '12:00:00', expiryMode: 'none',
    } as never)) as { id: string };
    const res = await h.batches.generateBatch(routerId, {
      mode: 'vc', count: 1, profileId: profile.id, limitUptime: '01:00:00',
      validityFromFirstLogin: true, validitySeconds: 3600, expiryMode: 'notify',
      opId: 'op-override-1',
    });
    const row = (await h.db.hotspotUsers.findUnique({ id: res.users[0].id })) as {
      limitUptime: string; validitySeconds: number; expiryMode: string; validityFromFirstLogin: boolean;
    };
    expect(row.limitUptime).toBe('01:00:00');
    expect(row.validitySeconds).toBe(3600);
    expect(row.validityFromFirstLogin).toBe(true);
    expect(row.expiryMode).toBe('notify');
  });
});

describe('computeUserExpiry', () => {
  const base = { expiresAt: null, validityFromFirstLogin: false, validitySeconds: null, firstLoginAt: null };
  const now = new Date('2026-10-16T12:00:00Z');

  it('absolute expiry fires', () => {
    const r = computeUserExpiry({ ...base, expiresAt: new Date('2026-10-16T11:00:00Z') }, now);
    expect(r.expiredAt?.toISOString()).toBe('2026-10-16T11:00:00.000Z');
    expect(r.expiryKind).toBe('absolute');
  });

  it('validity-from-first-login is a separate clock', () => {
    const r = computeUserExpiry({
      ...base,
      validityFromFirstLogin: true,
      validitySeconds: 3600,
      firstLoginAt: new Date('2026-10-16T10:00:00Z'),
    }, now);
    expect(r.expiryKind).toBe('validity');
    expect(r.expiredAt?.toISOString()).toBe('2026-10-16T11:00:00.000Z');
    expect(r.absolute).toBeNull();
  });

  it('not expired when neither clock passed', () => {
    const r = computeUserExpiry({
      ...base,
      expiresAt: new Date('2026-10-17T00:00:00Z'),
      validityFromFirstLogin: true,
      validitySeconds: 86400,
      firstLoginAt: new Date('2026-10-16T10:00:00Z'),
    }, now);
    expect(r.expiredAt).toBeNull();
    expect(r.expiryKind).toBeNull();
  });

  it('validity clock does not run before first login', () => {
    const r = computeUserExpiry({ ...base, validityFromFirstLogin: true, validitySeconds: 3600 }, now);
    expect(r.validity).toBeNull();
    expect(r.expiredAt).toBeNull();
  });

  it('earliest clock wins when both fire', () => {
    const r = computeUserExpiry({
      ...base,
      expiresAt: new Date('2026-10-16T09:00:00Z'),
      validityFromFirstLogin: true,
      validitySeconds: 3600,
      firstLoginAt: new Date('2026-10-16T10:00:00Z'),
    }, now);
    expect(r.expiryKind).toBe('absolute');
  });
});

describe('findStaleSessions', () => {
  let h: ReturnType<typeof harness>;
  let routerId: string;
  beforeEach(async () => {
    h = harness();
    routerId = await makeRouter(h.db);
  });

  it('flags expired-but-connected users and MAC mismatches', async () => {
    const expired = await h.hotspot.createUser(routerId, {
      name: 'old-user', password: 'x', expiresAt: '2026-10-15T00:00:00Z',
      macAddress: 'AA:BB:CC:DD:EE:01',
    } as never);
    await h.hotspot.createUser(routerId, { name: 'fresh-user', password: 'x' } as never);
    await h.db.hotspotActiveSessions.create({
      routerId, username: 'old-user', address: '192.168.10.50', macAddress: 'AA:BB:CC:DD:EE:FF',
    } as never);
    await h.db.hotspotActiveSessions.create({
      routerId, username: 'fresh-user', address: '192.168.10.51',
    } as never);

    const stale = await h.hotspot.findStaleSessions(routerId, new Date('2026-10-16T12:00:00Z'));
    expect(stale).toHaveLength(1);
    expect(stale[0].username).toBe('old-user');
    expect(stale[0].userId).toBe(expired.user.id);
    expect(stale[0].expiryKind).toBe('absolute');
    expect(stale[0].sessionIp).toBe('192.168.10.50');
    expect(stale[0].macMismatch).toBe(true); // pinned :01 vs session :FF
  });

  it('flags validity-clock expiry from first login', async () => {
    const u = await h.hotspot.createUser(routerId, {
      name: 'day-pass', password: 'x', validityFromFirstLogin: true, validitySeconds: 3600,
    } as never);
    await h.db.hotspotUsers.update({ id: u.user.id }, { firstLoginAt: new Date('2026-10-16T08:00:00Z') });
    await h.db.hotspotActiveSessions.create({ routerId, username: 'day-pass', address: '192.168.10.60' } as never);
    const stale = await h.hotspot.findStaleSessions(routerId, new Date('2026-10-16T12:00:00Z'));
    expect(stale).toHaveLength(1);
    expect(stale[0].expiryKind).toBe('validity');
  });

  it('returns empty when nothing is stale', async () => {
    const stale = await h.hotspot.findStaleSessions(routerId);
    expect(stale).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { RouterCommandsService } from '../src/commands/commands.service.js';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { EventsService } from '../src/events/events.module.js';
import { HotspotService } from '../src/hotspot/hotspot.service.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { NullRealtime } from '../src/realtime/realtime.port.js';
import { InMemoryVault } from '../src/vault/vault.port.js';

function setup() {
  const db = new InMemoryDatabase();
  const jobs = new InMemoryJobs();
  const vault = new InMemoryVault();
  const audit = new AuditService(db);
  const commands = new RouterCommandsService(db, jobs, new NullRealtime(), new EventsService(), audit);
  const svc = new HotspotService(db, vault, commands);
  return { db, jobs, vault, svc };
}

async function makeRouter(db: InMemoryDatabase) {
  return db.routers.create({
    uuid: 'uuid-hs',
    tunnelIp: '10.200.0.3',
    sstpUsername: 'sstp-hs',
    sstpPasswordRef: 'ref-1',
    apiPasswordRef: 'ref-2',
  });
}

describe('HotspotService.createUser', () => {
  it('vaults the password, redacts the audit snapshot, and enqueues a typed sentence', async () => {
    const { db, jobs, vault, svc } = setup();
    const router = await makeRouter(db);
    const profile = await db.hotspotUserProfiles.create({ routerId: router.id, name: 'plan-5m' });

    const { user, opId } = await svc.createUser(router.id, {
      name: 'guest42',
      password: 's3cret-pw',
      profileId: profile.id,
      comment: 'lobby kiosk',
    });

    expect(user.name).toBe('guest42');
    // DB keeps only the vault reference…
    const row = await db.hotspotUsers.findUnique({ id: user.id });
    expect(row?.passwordRef).toBeTruthy();
    expect(await vault.retrieve(row!.passwordRef!)).toBe('s3cret-pw');
    // …the queued sentence carries the plaintext (transient, worker-side)…
    const job = jobs.pending('commands')[0];
    expect(job.data).toMatchObject({ kind: 'ros', opId });
    const sentences = (job.data as { sentences: string[][] }).sentences;
    expect(sentences[0][0]).toBe('/ip/hotspot/user/add');
    expect(sentences[0]).toContain('=password=s3cret-pw');
    expect(sentences[0]).toContain('=profile=plan-5m');
    // …but the audit snapshot is redacted.
    const audit = await db.auditLogs.findUnique({ opId });
    expect(JSON.stringify(audit?.after)).not.toContain('s3cret-pw');
    expect(audit?.after).toMatchObject({ passwordSet: true });
  });

  it('rejects duplicate user names per router', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    await svc.createUser(router.id, { name: 'dupe' });
    await expect(svc.createUser(router.id, { name: 'dupe' })).rejects.toThrow(/already exists/);
  });

  it('requires the device id before mutating (no blind set on unreconciled rows)', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const { user } = await svc.createUser(router.id, { name: 'fresh' });
    await expect(svc.setUserDisabled(router.id, user.id, true, undefined)).rejects.toThrow(/no device id yet/);
  });

  it('quota fields on user profiles stay platform-side (not sent to the device)', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db);
    await svc.createUserProfile(router.id, {
      name: 'plan-x',
      rateLimit: '5M/10M',
      quotaBytes: '1073741824',
      quotaSeconds: 3600,
    });
    const row = await db.hotspotUserProfiles.findFirst({ routerId: router.id, name: 'plan-x' });
    expect(row?.quotaBytes).toBe(BigInt('1073741824'));
    const sentences = (jobs.pending('commands')[0].data as { sentences: string[][] }).sentences;
    expect(sentences[0][0]).toBe('/ip/hotspot/user/profile/add');
    // quota is enforced by the quota-enforcer, not a RouterOS user-profile field.
    expect(sentences[0].join(' ')).not.toMatch(/quota/i);
  });
});

describe('HotspotService walled garden', () => {
  it('routes dns entries to walled-garden and ip entries to walled-garden/ip', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db);
    await svc.createWalledGarden(router.id, { kind: 'dns', dstHost: '*.example.com' });
    await svc.createWalledGarden(router.id, { kind: 'ip', dstAddress: '10.9.9.9' });
    const paths = jobs.pending('commands').map((j) => (j.data as { sentences: string[][] }).sentences[0][0]);
    expect(paths).toEqual(['/ip/hotspot/walled-garden/add', '/ip/hotspot/walled-garden/ip/add']);
  });

  it('requires dstHost for kind=dns and dstAddress for kind=ip', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    await expect(svc.createWalledGarden(router.id, { kind: 'dns' })).rejects.toThrow(/dstHost/);
    await expect(svc.createWalledGarden(router.id, { kind: 'ip' })).rejects.toThrow(/dstAddress/);
  });
});

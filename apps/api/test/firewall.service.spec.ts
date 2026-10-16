import { describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { RouterCommandsService } from '../src/commands/commands.service.js';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { EventsService } from '../src/events/events.module.js';
import { FirewallJournalService } from '../src/firewall/firewall-journal.service.js';
import { FirewallService } from '../src/firewall/firewall.service.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { NullRealtime } from '../src/realtime/realtime.port.js';

function setup() {
  const db = new InMemoryDatabase();
  const jobs = new InMemoryJobs();
  const commands = new RouterCommandsService(db, jobs, new NullRealtime(), new EventsService(), new AuditService(db));
  const svc = new FirewallService(db, commands, new FirewallJournalService(db));
  return { db, jobs, svc };
}

async function makeRouter(db: InMemoryDatabase) {
  return db.routers.create({
    uuid: 'uuid-fw',
    tunnelIp: '10.200.0.4',
    sstpUsername: 'sstp-fw',
    sstpPasswordRef: 'ref-1',
    apiPasswordRef: 'ref-2',
  });
}

async function addRule(
  svc: FirewallService,
  routerId: string,
  overrides: Record<string, unknown> = {},
) {
  return svc.createRule(routerId, {
    table: 'filter',
    chain: 'input',
    action: 'accept',
    ...overrides,
  } as Parameters<FirewallService['createRule']>[1]);
}

describe('FirewallService', () => {
  it('assigns platform order on create and marks filter mutations safe-apply', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db);
    const first = await addRule(svc, router.id);
    const second = await addRule(svc, router.id, { action: 'drop' });
    expect(first.rule.order).toBe(0);
    expect(second.rule.order).toBe(1);

    const payload = jobs.pending('commands')[0].data as { safeApply?: { verifyAfterMs: number }; sentences: string[][] };
    expect(payload.safeApply?.verifyAfterMs).toBe(60_000);
    expect(payload.sentences[0][0]).toBe('/ip/firewall/filter/add');
  });

  it('nat mutations do NOT get safe-apply', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db);
    await svc.createRule(router.id, { table: 'nat', chain: 'dstnat', action: 'dst-nat' });
    const payload = jobs.pending('commands')[0].data as { safeApply?: unknown };
    expect(payload.safeApply).toBeUndefined();
  });

  it('move toEnd fans out one move per trailing rule (RouterOS move = "before X")', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db);
    const a = await addRule(svc, router.id, { comment: 'a' });
    const b = await addRule(svc, router.id, { comment: 'b' });
    const c = await addRule(svc, router.id, { comment: 'c' });
    // Pretend the worker reconciled device ids.
    for (const [r, id] of [[a, '*1'], [b, '*2'], [c, '*3']] as const) {
      await db.firewallRules.update({ id: r.rule.id }, { mikrotikId: id });
    }
    jobs.clear();
    const res = await svc.moveRule(router.id, a.rule.id, { toEnd: true });
    expect(res.rule.order).toBe(2);
    const payload = jobs.pending('commands')[0].data as { sentences: string[][] };
    // move B before A, then C before A → A lands last, B/C keep order.
    expect(payload.sentences).toEqual([
      ['/ip/firewall/filter/move', '=.id=*2', '=destination=*1'],
      ['/ip/firewall/filter/move', '=.id=*3', '=destination=*1'],
    ]);
  });

  it('move beforeId emits a single move sentence and renumbers orders', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db);
    const a = await addRule(svc, router.id, { comment: 'a' });
    const b = await addRule(svc, router.id, { comment: 'b' });
    const c = await addRule(svc, router.id, { comment: 'c' });
    for (const [r, id] of [[a, '*1'], [b, '*2'], [c, '*3']] as const) {
      await db.firewallRules.update({ id: r.rule.id }, { mikrotikId: id });
    }
    jobs.clear();
    const res = await svc.moveRule(router.id, c.rule.id, { beforeId: a.rule.id });
    expect(res.rule.order).toBe(0);
    const payload = jobs.pending('commands')[0].data as { sentences: string[][] };
    expect(payload.sentences).toEqual([['/ip/firewall/filter/move', '=.id=*3', '=destination=*1']]);
    const orders = (await db.firewallRules.findMany({ where: { routerId: router.id }, orderBy: { order: 'asc' } })).map((r) => r.comment);
    expect(orders).toEqual(['c', 'a', 'b']);
  });

  it('rejects move for address-list entries (no device-side ordering)', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const created = await svc.createRule(router.id, {
      table: 'address-list', chain: 'blocked', action: 'add', srcAddress: '1.2.3.4',
    });
    await expect(svc.moveRule(router.id, created.rule.id, { toEnd: true })).rejects.toThrow(/no device-side ordering/);
  });

  it('refuses to delete panel-proxy rules directly (downstream owns them)', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const created = await addRule(svc, router.id);
    await db.firewallRules.update({ id: created.rule.id }, { comment: 'panel-proxy:dd-abc', mikrotikId: '*9' });
    await expect(svc.deleteRule(router.id, created.rule.id, undefined)).rejects.toThrow(/downstream proxy/);
  });

  it('create with beforeId uses device place-before and inserts the platform order', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db);
    const a = await addRule(svc, router.id, { comment: 'a' });
    await db.firewallRules.update({ id: a.rule.id }, { mikrotikId: '*1' });
    jobs.clear();
    const res = await svc.createRule(router.id, {
      table: 'filter', chain: 'input', action: 'log', beforeId: a.rule.id,
    });
    expect(res.rule.order).toBe(0);
    const payload = jobs.pending('commands')[0].data as { sentences: string[][] };
    expect(payload.sentences[0]).toContain('=place-before=*1');
  });
});

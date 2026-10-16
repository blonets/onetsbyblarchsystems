import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { AuditService } from '../src/audit/audit.service.js';
import { EventsService } from '../src/events/events.module.js';
import { RouterCommandsService } from '../src/commands/commands.service.js';
import { FirewallJournalService } from '../src/firewall/firewall-journal.service.js';
import { FirewallService } from '../src/firewall/firewall.service.js';

function harness() {
  const db = new InMemoryDatabase();
  const jobs = new InMemoryJobs();
  const audit = new AuditService(db as never);
  const events = new EventsService();
  const realtime = { emitToRouter: () => undefined, emitToSite: () => undefined };
  const commands = new RouterCommandsService(db as never, jobs as never, realtime as never, events, audit);
  const journals = new FirewallJournalService(db as never);
  const firewall = new FirewallService(db as never, commands as never, journals as never);
  return { db, jobs, journals, firewall };
}

async function makeRouter(db: InMemoryDatabase): Promise<string> {
  const row = (await db.routers.create({
    uuid: `fw-${Math.random()}`, tunnelIp: `10.200.8.${Math.floor(Math.random() * 200) + 10}`,
    sstpUsername: `sstp-${Math.random()}`, sstpPasswordRef: 'ref', apiPasswordRef: 'ref',
  } as never)) as { id: string };
  return row.id;
}

const RULE = {
  table: 'filter' as const,
  chain: 'forward',
  action: 'drop',
  protocol: 'tcp',
  dstPort: '25',
  comment: 'block smtp',
};

describe('firewall rollback journaling', () => {
  let h: ReturnType<typeof harness>;
  let routerId: string;
  beforeEach(async () => {
    h = harness();
    routerId = await makeRouter(h.db);
  });

  it('create writes a journal (pending → applied) referencing the new rule', async () => {
    const res = await h.firewall.createRule(routerId, { ...RULE, opId: 'op-fw-create-1' }, undefined);
    expect(res.journalId).toBeTruthy();
    const journals = await h.journals.list(routerId);
    expect(journals).toHaveLength(1);
    expect(journals[0].action).toBe('firewall.rule.create');
    expect(journals[0].status).toBe('applied');
    expect(journals[0].before).toEqual([]);
    expect(journals[0].createdRuleIds).toEqual([res.rule.id]);
    expect(journals[0].sentences).toHaveLength(1);
  });

  it('update journal carries the before-snapshot', async () => {
    const created = await h.firewall.createRule(routerId, { ...RULE, opId: 'op-fw-u0' }, undefined);
    await h.db.firewallRules.update({ id: created.rule.id }, { mikrotikId: '*5' });
    await h.firewall.updateRule(routerId, created.rule.id, { action: 'accept', opId: 'op-fw-u1' }, undefined);
    const journals = await h.journals.list(routerId);
    const upd = journals.find((j) => j.action === 'firewall.rule.update')!;
    expect((upd.before as Array<{ action: string }>)[0].action).toBe('drop');
  });

  it('rollback of a create REVOKES the rule instead of deleting it', async () => {
    const created = await h.firewall.createRule(routerId, { ...RULE, opId: 'op-fw-rc' }, undefined);
    const journals = await h.journals.list(routerId);
    const rb = await h.firewall.rollbackJournal(routerId, journals[0].id, undefined);

    expect(rb.revoked).toBe(1);
    expect(rb.restored).toBe(0);
    // Mirror row still exists — never hard-deleted.
    const row = (await h.db.firewallRules.findUnique({ id: created.rule.id })) as {
      revoked: boolean; disabled: boolean;
    };
    expect(row).not.toBeNull();
    expect(row.revoked).toBe(true);
    expect(row.disabled).toBe(true);
    // Hidden from default listings, visible with includeRevoked.
    expect(await h.firewall.listRules(routerId, {})).toHaveLength(0);
    expect(await h.firewall.listRules(routerId, { includeRevoked: true })).toHaveLength(1);
    // Journal is marked rolled-back; a second rollback is rejected.
    const after = await h.journals.list(routerId);
    expect(after[0].status).toBe('rolled-back');
    await expect(h.firewall.rollbackJournal(routerId, journals[0].id, undefined)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rollback of a delete restores the rule (mirror + device add)', async () => {
    const created = await h.firewall.createRule(routerId, { ...RULE, opId: 'op-fw-d0' }, undefined);
    await h.db.firewallRules.update({ id: created.rule.id }, { mikrotikId: '*7' });
    await h.firewall.deleteRule(routerId, created.rule.id, 'op-fw-d1', undefined);
    expect(await h.db.firewallRules.findUnique({ id: created.rule.id })).toBeNull();

    const journals = await h.journals.list(routerId);
    const del = journals.find((j) => j.action === 'firewall.rule.delete')!;
    const rb = await h.firewall.rollbackJournal(routerId, del.id, undefined);
    expect(rb.restored).toBe(1);

    const row = (await h.db.firewallRules.findUnique({ id: created.rule.id })) as {
      action: string; dstPort: string;
    };
    expect(row.action).toBe('drop');
    expect(row.dstPort).toBe('25');
    // The rollback enqueued a device-side add.
    const job = h.jobs.pending('commands').find((j) => j.data.opId === rb.opId)!;
    const sentences = job.data.sentences as string[][];
    expect(sentences.some((s) => s[0] === '/ip/firewall/filter/add')).toBe(true);
  });

  it('rollback of an update restores the previous fields', async () => {
    const created = await h.firewall.createRule(routerId, { ...RULE, opId: 'op-fw-x0' }, undefined);
    await h.db.firewallRules.update({ id: created.rule.id }, { mikrotikId: '*9' });
    await h.firewall.updateRule(routerId, created.rule.id, { action: 'accept', opId: 'op-fw-x1' }, undefined);
    expect(((await h.db.firewallRules.findUnique({ id: created.rule.id })) as { action: string }).action).toBe('accept');

    const journals = await h.journals.list(routerId);
    const upd = journals.find((j) => j.action === 'firewall.rule.update')!;
    const rb = await h.firewall.rollbackJournal(routerId, upd.id, undefined);
    expect(rb.restored).toBe(1);
    expect(((await h.db.firewallRules.findUnique({ id: created.rule.id })) as { action: string }).action).toBe('drop');
    // Device got a set restoring the snapshot.
    const job = h.jobs.pending('commands').find((j) => j.data.opId === rb.opId)!;
    const sentences = job.data.sentences as string[][];
    expect(sentences.some((s) => s[0] === '/ip/firewall/filter/set')).toBe(true);
  });

  it('rollback of a move restores chain order', async () => {
    const mk = async (comment: string, opId: string) => {
      const r = await h.firewall.createRule(routerId, { ...RULE, comment, opId }, undefined);
      await h.db.firewallRules.update({ id: r.rule.id }, { mikrotikId: `*m-${comment}` });
      return r.rule.id;
    };
    const a = await mk('a', 'op-fw-m0');
    const b = await mk('b', 'op-fw-m1');
    await h.firewall.moveRule(routerId, b, { beforeId: a, opId: 'op-fw-m2' }, undefined);
    const moved = (await h.db.firewallRules.findMany({
      where: { routerId }, orderBy: { order: 'asc' },
    })).map((r) => (r as { id: string }).id);
    expect(moved).toEqual([b, a]);

    const journals = await h.journals.list(routerId);
    const mv = journals.find((j) => j.action === 'firewall.rule.move')!;
    await h.firewall.rollbackJournal(routerId, mv.id, undefined);
    const restored = (await h.db.firewallRules.findMany({
      where: { routerId }, orderBy: { order: 'asc' },
    })).map((r) => (r as { id: string }).id);
    expect(restored).toEqual([a, b]);
  });

  it('rollback of an unknown journal → 404', async () => {
    await expect(h.firewall.rollbackJournal(routerId, 'nope', undefined)).rejects.toBeInstanceOf(NotFoundException);
  });
});

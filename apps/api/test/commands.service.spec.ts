import { describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { RouterCommandsService } from '../src/commands/commands.service.js';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { EventsService } from '../src/events/events.module.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { NullRealtime } from '../src/realtime/realtime.port.js';

function setup() {
  const db = new InMemoryDatabase();
  const jobs = new InMemoryJobs();
  const realtime = new NullRealtime();
  const emitToRouter = vi.spyOn(realtime, 'emitToRouter');
  const events = new EventsService();
  const audit = new AuditService(db);
  const svc = new RouterCommandsService(db, jobs, realtime, events, audit);
  return { db, jobs, realtime, emitToRouter, events, audit, svc };
}

async function makeRouter(db: InMemoryDatabase) {
  return db.routers.create({
    uuid: 'uuid-1',
    tunnelIp: '10.200.0.2',
    sstpUsername: 'sstp-test',
    sstpPasswordRef: 'ref-1',
    apiPasswordRef: 'ref-2',
  });
}

describe('RouterCommandsService idempotency', () => {
  it('replays a repeated opId instead of enqueueing twice', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db);
    const first = await svc.enqueueRos({
      routerId: router.id,
      action: 'hotspot.user.create',
      sentences: [['/ip/hotspot/user/add', '=name=x']],
      opId: 'op-123',
      actorId: 'user-1',
    });
    const second = await svc.enqueueRos({
      routerId: router.id,
      action: 'hotspot.user.create',
      sentences: [['/ip/hotspot/user/add', '=name=x']],
      opId: 'op-123',
      actorId: 'user-1',
    });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.auditId).toBe(first.auditId);
    expect(jobs.pending('commands')).toHaveLength(1);
    // The queue job id is the opId — BullMQ itself dedupes on it.
    expect(jobs.pending('commands')[0].id).toBe('op-123');
    expect(jobs.pending('commands')[0].data).toMatchObject({
      kind: 'ros',
      opId: 'op-123',
      routerId: router.id,
    });
  });

  it('writes a pending audit row for every new command', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const { opId, auditId } = await svc.enqueueRos({
      routerId: router.id,
      action: 'firewall.rule.create',
      sentences: [['/ip/firewall/filter/add']],
    });
    const audit = await db.auditLogs.findUnique({ opId });
    expect(audit?.id).toBe(auditId);
    expect(audit?.result).toBe('pending');
    expect(audit?.action).toBe('firewall.rule.create');
  });
});

describe('RouterCommandsService.reportResult', () => {
  it('settles the audit, reconciles mikrotikId, pushes realtime and emits config.changed', async () => {
    const { db, svc, emitToRouter, events } = setup();
    const router = await makeRouter(db);
    const busEvents: Array<{ name: string; payload: unknown }> = [];
    events.onEvent('config.changed', (p) => busEvents.push({ name: 'config.changed', payload: p }));

    const mirror = await db.hotspotUsers.create({ routerId: router.id, name: 'guest1' });
    const { opId } = await svc.enqueueRos({
      routerId: router.id,
      action: 'hotspot.user.create',
      sentences: [['/ip/hotspot/user/add', '=name=guest1']],
      entity: { table: 'hotspot', id: mirror.id },
    });

    await svc.reportResult({ opId, ok: true, rows: [{ '.id': '*A1', name: 'guest1' }] });

    const audit = await db.auditLogs.findUnique({ opId });
    expect(audit?.result).toBe('done');
    const reconciled = await db.hotspotUsers.findUnique({ id: mirror.id });
    expect(reconciled?.mikrotikId).toBe('*A1');
    expect(emitToRouter).toHaveBeenCalledWith(
      router.id,
      'command.result',
      expect.objectContaining({ opId, ok: true }),
    );
    expect(busEvents).toHaveLength(1);
    expect(busEvents[0].payload).toMatchObject({
      routerId: router.id,
      domain: 'hotspot',
      action: 'hotspot.user.create',
      opId,
    });
  });

  it('marks the audit failed on !trap without emitting config.changed', async () => {
    const { db, svc, events } = setup();
    const router = await makeRouter(db);
    const busEvents: unknown[] = [];
    events.onEvent('config.changed', (p) => busEvents.push(p));
    const { opId } = await svc.enqueueRos({
      routerId: router.id,
      action: 'queue.simple.create',
      sentences: [['/queue/simple/add']],
    });
    await svc.reportResult({ opId, ok: false, error: 'input does not match any value of target' });
    const audit = await db.auditLogs.findUnique({ opId });
    expect(audit?.result).toBe('failed');
    expect(audit?.error).toContain('target');
    expect(busEvents).toHaveLength(0);
  });

  it('dispatches tagged discovery results to the internal ingest event', async () => {
    const { db, svc, events } = setup();
    const router = await makeRouter(db);
    const received: unknown[] = [];
    events.on('internal:downstream.discovered.raw', (p: unknown) => received.push(p));
    const { opId } = await svc.enqueueRos({
      routerId: router.id,
      action: 'downstream.discover',
      sentences: [['/ip/neighbor/print']],
      resultTag: 'downstream-discover',
    });
    await svc.reportResult({
      opId,
      ok: true,
      rows: [{ '.id': '*1', 'mac-address': 'AA:BB:CC:DD:EE:FF', address: '192.168.88.2', identity: 'ap-1' }],
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ routerId: router.id });
  });

  it('ignores results for unknown opIds', async () => {
    const { svc } = setup();
    await expect(svc.reportResult({ opId: 'nope', ok: true })).resolves.toBeUndefined();
  });
});

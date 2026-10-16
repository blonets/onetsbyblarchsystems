import { describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { BackupsService } from '../src/backups/backups.service.js';
import { RouterCommandsService } from '../src/commands/commands.service.js';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { EventsService } from '../src/events/events.module.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { QueuesService } from '../src/queues/queues.service.js';
import { NullRealtime } from '../src/realtime/realtime.port.js';

function commandSetup() {
  const db = new InMemoryDatabase();
  const jobs = new InMemoryJobs();
  const commands = new RouterCommandsService(db, jobs, new NullRealtime(), new EventsService(), new AuditService(db));
  return { db, jobs, commands };
}

async function makeRouter(db: InMemoryDatabase, tunnelIp: string) {
  return db.routers.create({
    uuid: `uuid-${tunnelIp}`,
    tunnelIp,
    sstpUsername: `sstp-${tunnelIp}`,
    sstpPasswordRef: 'ref-1',
    apiPasswordRef: 'ref-2',
  });
}

describe('QueuesService', () => {
  it('creates simple queues with typed sentences and stores rates opaquely', async () => {
    const { db, jobs, commands } = commandSetup();
    const svc = new QueuesService(db, commands);
    const router = await makeRouter(db, '10.200.0.8');
    const { queue } = await svc.createQueue(router.id, {
      kind: 'simple',
      name: 'client-1',
      target: '192.168.88.50',
      maxLimit: '2M/2M',
      priority: 8,
    });
    expect(queue.maxLimit).toBe('2M/2M'); // stored as submitted; device normalizes
    const payload = jobs.pending('commands')[0].data as { sentences: string[][] };
    expect(payload.sentences[0][0]).toBe('/queue/simple/add');
    expect(payload.sentences[0]).toContain('=priority=8');
  });

  it('moves a queue before another (or to top with *0)', async () => {
    const { db, jobs, commands } = commandSetup();
    const svc = new QueuesService(db, commands);
    const router = await makeRouter(db, '10.200.0.9');
    const a = await svc.createQueue(router.id, { kind: 'simple', name: 'a', target: 't1' });
    const b = await svc.createQueue(router.id, { kind: 'simple', name: 'b', target: 't2' });
    await db.queues.update({ id: a.queue.id }, { mikrotikId: '*1' });
    await db.queues.update({ id: b.queue.id }, { mikrotikId: '*2' });
    jobs.clear();
    await svc.moveQueue(router.id, b.queue.id, { beforeId: a.queue.id });
    expect((jobs.pending('commands')[0].data as { sentences: string[][] }).sentences).toEqual([
      ['/queue/simple/move', '=.id=*2', '=destination=*1'],
    ]);
    jobs.clear();
    await svc.moveQueue(router.id, b.queue.id, {});
    expect((jobs.pending('commands')[0].data as { sentences: string[][] }).sentences).toEqual([
      ['/queue/simple/move', '=.id=*2', '=destination=*0'],
    ]);
  });

  it('requires parent for tree queues and target for simple queues', async () => {
    const { db, commands } = commandSetup();
    const svc = new QueuesService(db, commands);
    const router = await makeRouter(db, '10.200.0.10');
    await expect(svc.createQueue(router.id, { kind: 'tree', name: 't' })).rejects.toThrow(/parent/);
    await expect(svc.createQueue(router.id, { kind: 'simple', name: 's' })).rejects.toThrow(/target/);
  });
});

describe('BackupsService', () => {
  function setup() {
    const db = new InMemoryDatabase();
    const jobs = new InMemoryJobs();
    const events = new EventsService();
    const svc = new BackupsService(db, jobs, new NullRealtime(), events, new AuditService(db));
    return { db, jobs, events, svc };
  }

  it('validates schedule cron and retention, then upserts', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db, '10.200.0.11');
    await expect(svc.upsertSchedule(router.id, { type: 'both', cron: 'not-a-cron', enabled: true, retentionDays: 30 })).rejects.toThrow(/cron/);
    await expect(svc.upsertSchedule(router.id, { type: 'both', cron: '0 2 * * *', enabled: true, retentionDays: 0 })).rejects.toThrow(/retentionDays/);
    const sched = await svc.upsertSchedule(router.id, { type: 'both', cron: '0 2 * * *', enabled: true, retentionDays: 30 });
    expect(sched.cron).toBe('0 2 * * *');
    const again = await svc.upsertSchedule(router.id, { type: 'both', cron: '0 3 * * *', enabled: true, retentionDays: 14 });
    expect(again.id).toBe(sched.id); // upsert, not duplicate
  });

  it('restore is audited and enqueued on the backup queue with the backup id', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db, '10.200.0.12');
    const backup = await db.backups.create({
      routerId: router.id,
      type: 'export',
      fileName: 'rsc-1.rsc',
      storageKey: 'k1',
      sizeBytes: BigInt(1234),
      sha256: 'abc',
      kmsKeyId: 'kms-1',
      retentionUntil: new Date(Date.now() + 86_400_000),
    });
    const { opId } = await svc.restore(backup.id);
    const pending = jobs.pending('backup');
    expect(pending).toHaveLength(1);
    expect(pending[0].data).toMatchObject({ kind: 'backup', opId, restoreBackupId: backup.id });
    const audit = await db.auditLogs.findUnique({ opId });
    expect(audit?.action).toBe('backup.restore');
    expect(audit?.result).toBe('pending');
  });

  it('reportCompleted records the backup and emits backup.completed', async () => {
    const { db, events, svc } = setup();
    const router = await makeRouter(db, '10.200.0.13');
    const bus: unknown[] = [];
    events.onEvent('backup.completed', (p) => bus.push(p));
    const record = await svc.reportCompleted({
      opId: 'op-bk-1',
      routerId: router.id,
      type: 'binary',
      fileName: 'bk.backup',
      storageKey: 'k2',
      sizeBytes: '9999',
      sha256: 'def',
      kmsKeyId: 'kms-1',
      retentionUntil: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(record.sizeBytes).toBe('9999');
    expect(bus).toHaveLength(1);
    expect(bus[0]).toMatchObject({ routerId: router.id, backupId: record.id, type: 'binary' });
  });
});

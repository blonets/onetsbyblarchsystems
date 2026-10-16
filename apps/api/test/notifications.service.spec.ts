import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { EventsService } from '../src/events/events.module.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';

function setup() {
  const db = new InMemoryDatabase();
  const jobs = new InMemoryJobs();
  const events = new EventsService();
  const svc = new NotificationsService(db, jobs, events);
  svc.onModuleInit();
  return { db, jobs, events, svc };
}

describe('NotificationsService fan-out', () => {
  it('enqueues one notify job per enabled matching rule', async () => {
    const { events, jobs, svc } = setup();
    await svc.createRule({ name: 'tg-offline', event: 'router.offline', channel: 'telegram', target: '12345' });
    await svc.createRule({ name: 'mail-offline', event: 'router.offline', channel: 'email', target: 'ops@example.com' });
    const disabled = await svc.createRule({ name: 'quiet', event: 'router.offline', channel: 'telegram', target: '999' });
    await svc.updateRule(disabled.id, { enabled: false });
    await svc.createRule({ name: 'tg-online', event: 'router.online', channel: 'telegram', target: '12345' });

    events.emitEvent('router.offline', { routerId: 'r1', uuid: 'u1', at: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 10)); // fan-out is async

    const pending = jobs.pending('notify');
    expect(pending).toHaveLength(2);
    const targets = pending.map((j) => (j.data as { target: string }).target).sort();
    expect(targets).toEqual(['12345', 'ops@example.com']);
    for (const job of pending) {
      expect(job.data).toMatchObject({ kind: 'notify', event: 'router.offline' });
      const payload = (job.data as { payload: Record<string, unknown> }).payload;
      expect(payload).toMatchObject({ routerId: 'r1' });
    }
  });

  it('testRule enqueues a clearly-labeled test payload', async () => {
    const { jobs, svc } = setup();
    const rule = await svc.createRule({ name: 'tg', event: 'alert.raised', channel: 'telegram', target: '12345' });
    const { opId } = await svc.testRule(rule.id);
    const pending = jobs.pending('notify');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(opId);
    const data = pending[0].data as { payload: Record<string, unknown> };
    expect(data.payload.test).toBe(true);
    expect(String(data.payload.message)).toContain('[TEST]');
  });
});

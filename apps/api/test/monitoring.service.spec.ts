import { describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { InMemoryMetricsStore } from '../src/db/metrics-store.js';
import { EventsService } from '../src/events/events.module.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { MonitoringService } from '../src/monitoring/monitoring.service.js';
import { NullRealtime } from '../src/realtime/realtime.port.js';
import { RoutersService } from '../src/routers/routers.service.js';

function setup() {
  const db = new InMemoryDatabase();
  const metrics = new InMemoryMetricsStore();
  const realtime = new NullRealtime();
  const emitToRouter = vi.spyOn(realtime, 'emitToRouter');
  const events = new EventsService();
  const config = { get: () => undefined };
  const routers = new RoutersService(db, new InMemoryJobs(), new AuditService(db));
  const svc = new MonitoringService(db, metrics, realtime, events, config, routers);
  return { db, metrics, realtime, emitToRouter, events, svc };
}

async function makeRouter(db: InMemoryDatabase, status = 'online') {
  return db.routers.create({
    uuid: 'uuid-mon',
    tunnelIp: '10.200.0.5',
    sstpUsername: 'sstp-mon',
    sstpPasswordRef: 'ref-1',
    apiPasswordRef: 'ref-2',
    status: status as 'online',
  });
}

describe('MonitoringService.heartbeat', () => {
  it('opens a downtime row on online→offline and emits router.offline', async () => {
    const { db, svc, emitToRouter, events } = setup();
    const router = await makeRouter(db, 'online');
    const bus: unknown[] = [];
    events.onEvent('router.offline', (p) => bus.push(p));

    const res = await svc.heartbeat(router.id, { status: 'offline', cause: 'heartbeat-missed' });
    expect(res.status).toBe('offline');

    const open = await db.downtimes.findMany({ where: { routerId: router.id } });
    expect(open).toHaveLength(1);
    expect(open[0].endedAt).toBeNull();
    expect(open[0].cause).toBe('heartbeat-missed');
    expect(bus).toHaveLength(1);
    expect(emitToRouter).toHaveBeenCalledWith(
      router.id,
      'router.status',
      expect.objectContaining({ status: 'offline' }),
    );
  });

  it('closes the downtime row on offline→online with a duration and emits router.online', async () => {
    const { db, svc, events } = setup();
    const router = await makeRouter(db, 'offline');
    const started = new Date(Date.now() - 125_000);
    const d = await db.downtimes.create({ routerId: router.id, cause: 'heartbeat-missed' });
    await db.downtimes.update({ id: d.id }, { startedAt: started });
    const bus: unknown[] = [];
    events.onEvent('router.online', (p) => bus.push(p));

    await svc.heartbeat(router.id, { status: 'online' });
    const closed = await db.downtimes.findUnique({ id: d.id });
    expect(closed?.endedAt).not.toBeNull();
    // ~125 s episode, allow a few seconds of test slop.
    expect(closed?.durationS).toBeGreaterThanOrEqual(120);
    expect(closed?.durationS).toBeLessThanOrEqual(135);
    expect(bus).toHaveLength(1);
  });

  it('same-status heartbeats only refresh lastSeen (no duplicate ledger rows)', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db, 'online');
    await svc.heartbeat(router.id, { status: 'online' });
    await svc.heartbeat(router.id, { status: 'online' });
    expect(await db.downtimes.count({ routerId: router.id })).toBe(0);
    const r = await db.routers.findUnique({ id: router.id });
    expect(r?.lastSeen).not.toBeNull();
  });
});

describe('MonitoringService.ingest', () => {
  it('stores the batch and refreshes lastSeen for reporting routers', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const ts = new Date().toISOString();
    const res = await svc.ingest({
      cpu: [{ ts, routerId: router.id, cpuPct: 12 }],
      traffic: [{ ts, routerId: router.id, iface: 'ether1', rxBps: 1000, txBps: 2000 }],
    });
    expect(res.stored).toBe(2);
    const r = await db.routers.findUnique({ id: router.id });
    expect(r?.lastSeen).not.toBeNull();
  });

  it('reads metrics back through the store', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const ts = new Date().toISOString();
    await svc.ingest({ hotspotActive: [{ ts, routerId: router.id, activeN: 7 }] });
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);
    const points = await svc.getMetrics(router.id, 'hotspot_active', from, to);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ activeN: 7 });
  });
});

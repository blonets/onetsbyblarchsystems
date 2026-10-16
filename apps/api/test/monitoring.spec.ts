import { beforeEach, describe, expect, it } from 'vitest';
import { fleetResult } from '@mtk/types';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { AuditService } from '../src/audit/audit.service.js';
import { EventsService } from '../src/events/events.module.js';
import { MonitoringService } from '../src/monitoring/monitoring.service.js';
import { RoutersService } from '../src/routers/routers.service.js';

function harness() {
  const db = new InMemoryDatabase();
  const jobs = new InMemoryJobs();
  const audit = new AuditService(db as never);
  const routers = new RoutersService(db as never, jobs as never, audit as never);
  const metrics = { insertBatch: async () => undefined, query: async () => [] };
  const realtime = { emitToRouter: () => undefined, emitToSite: () => undefined };
  const events = new EventsService();
  const config = { get: (key: string) => (key === 'REVENUE_CURRENCY' ? 'EGP' : undefined) };
  const monitoring = new MonitoringService(
    db as never, metrics as never, realtime as never, events, config as never, routers as never,
  );
  return { db, monitoring, routers };
}

async function makeRouter(db: InMemoryDatabase, tags: string[] = [], status = 'online'): Promise<string> {
  const row = (await db.routers.create({
    uuid: `mon-${Math.random()}`, tunnelIp: `10.200.6.${Math.floor(Math.random() * 200) + 10}`,
    sstpUsername: `sstp-${Math.random()}`, sstpPasswordRef: 'ref', apiPasswordRef: 'ref',
    tags, status,
  } as never)) as { id: string };
  return row.id;
}

describe('fleetResult', () => {
  it('records per-router success/fail — one failure never stops the rest', async () => {
    const res = await fleetResult([
      { routerId: 'r1', run: () => 'ok-1' },
      { routerId: 'r2', run: () => { throw new Error('boom'); } },
      { routerId: 'r3', run: async () => 'ok-3' },
    ]);
    expect(res.results).toHaveLength(3);
    expect(res.results[0]).toMatchObject({ routerId: 'r1', ok: true, data: 'ok-1' });
    expect(res.results[1]).toMatchObject({ routerId: 'r2', ok: false });
    expect(res.results[1].error).toContain('boom');
    expect(res.results[2]).toMatchObject({ routerId: 'r3', ok: true, data: 'ok-3' });
  });
});

describe('monitoring refinements', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('session ingest replaces wholesale; search finds by username and ip', async () => {
    const r1 = await makeRouter(h.db);
    const r2 = await makeRouter(h.db);
    await h.monitoring.ingestSessions(r1, [
      { username: 'Alice', address: '192.168.10.50', macAddress: 'AA:BB:CC:DD:EE:01', uptime: '1h' },
    ]);
    await h.monitoring.ingestSessions(r2, [
      { username: 'bob', address: '192.168.20.51' },
    ]);
    // Second ingest for r1 replaces the first.
    await h.monitoring.ingestSessions(r1, [{ username: 'carol', address: '192.168.10.52' }]);

    const byName = await h.monitoring.searchSessions({ username: 'alice' }); // case-insensitive
    expect(byName).toHaveLength(0); // alice was replaced by carol
    const carol = await h.monitoring.searchSessions({ username: 'carol' });
    expect(carol).toHaveLength(1);
    expect(carol[0].routerId).toBe(r1);
    const byIp = await h.monitoring.searchSessions({ ip: '192.168.20.51' });
    expect(byIp).toHaveLength(1);
    expect(byIp[0].username).toBe('bob');
    expect(byIp[0].routerId).toBe(r2);
    // No filter → empty (never a full-table dump).
    expect(await h.monitoring.searchSessions({})).toEqual([]);
  });

  it('revenue/today counts vc first-logins today × profile price (unset = 0)', async () => {
    const routerId = await makeRouter(h.db);
    const paid = (await h.db.hotspotUserProfiles.create({ routerId, name: 'paid', price: 50 } as never)) as { id: string };
    const free = (await h.db.hotspotUserProfiles.create({ routerId, name: 'free' } as never)) as { id: string };
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const mkUser = (name: string, firstLoginAt: Date | null, profileId: string | null, mode: string | null) =>
      h.db.hotspotUsers.create({ routerId, name, mode, profileId, firstLoginAt } as never);
    await mkUser('v1', new Date(todayStart.getTime() + 3600_000), paid.id, 'vc'); // redeemed today, 50
    await mkUser('v2', new Date(todayStart.getTime() + 7200_000), free.id, 'vc'); // redeemed today, price unset → 0
    await mkUser('v3', new Date(todayStart.getTime() - 86_400_000), paid.id, 'vc'); // yesterday → not counted
    await mkUser('v4', null, paid.id, 'vc'); // never logged in → not counted
    await mkUser('u1', new Date(todayStart.getTime() + 3600_000), paid.id, 'up'); // not a voucher → not counted

    const rev = await h.monitoring.revenueToday(now);
    expect(rev.vouchersRedeemed).toBe(2);
    expect(rev.amount).toBe(50);
    expect(rev.currency).toBe('EGP');
  });

  it('bulk status over a tag selector returns per-router FleetResult', async () => {
    const a = await makeRouter(h.db, ['cairo', 'vip']);
    const b = await makeRouter(h.db, ['cairo']);
    await makeRouter(h.db, ['giza']);
    const res = await h.monitoring.bulkStatus({ tag: 'cairo' });
    expect(res.results).toHaveLength(2);
    const ids = res.results.map((r) => r.routerId).sort();
    expect(ids).toEqual([a, b].sort());
    for (const r of res.results) {
      expect(r.ok).toBe(true);
      expect(r.data!.status).toBe('online');
    }
  });

  it('router tag filter on GET /routers', async () => {
    await makeRouter(h.db, ['cairo']);
    await makeRouter(h.db, ['giza']);
    const page = await h.routers.findAll({ tag: 'cairo' });
    expect(page.total).toBe(1);
    expect(page.items[0].tags).toContain('cairo');
    const all = await h.routers.findAll({});
    expect(all.total).toBe(2);
  });
});

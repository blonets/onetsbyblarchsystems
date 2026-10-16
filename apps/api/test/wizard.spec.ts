import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { AuditService } from '../src/audit/audit.service.js';
import { EventsService } from '../src/events/events.module.js';
import { RouterCommandsService } from '../src/commands/commands.service.js';
import {
  HotspotSetupWizardService,
  buildHotspotSetupSteps,
  deriveNetwork,
  resolveWizardParams,
} from '../src/provisioning/wizard.service.js';
import type { HotspotSetupWizardDto } from '../src/provisioning/dto/wizard.dto.js';

function harness() {
  const db = new InMemoryDatabase();
  const jobs = new InMemoryJobs();
  const audit = new AuditService(db as never);
  const events = new EventsService();
  const realtime = { emitToRouter: () => undefined, emitToSite: () => undefined };
  const commands = new RouterCommandsService(db as never, jobs as never, realtime as never, events, audit);
  const wizard = new HotspotSetupWizardService(db as never, commands as never);
  return { db, jobs, wizard };
}

async function makeRouter(db: InMemoryDatabase): Promise<string> {
  const row = (await db.routers.create({
    uuid: `wiz-${Math.random()}`, tunnelIp: `10.200.7.${Math.floor(Math.random() * 200) + 10}`,
    sstpUsername: `sstp-${Math.random()}`, sstpPasswordRef: 'ref', apiPasswordRef: 'ref',
  } as never)) as { id: string };
  return row.id;
}

const DTO: HotspotSetupWizardDto = {
  interface: 'bridge-lan',
  hotspotAddress: '192.168.10.1/24',
  walledGardenHosts: ['pay.example.com'],
};

describe('deriveNetwork', () => {
  it('computes network + gateway from CIDR', () => {
    expect(deriveNetwork('192.168.10.1/24')).toEqual({ network: '192.168.10.0/24', gateway: '192.168.10.1' });
    expect(deriveNetwork('10.0.5.1/16')).toEqual({ network: '10.0.0.0/16', gateway: '10.0.5.1' });
  });

  it('rejects malformed input', () => {
    expect(() => deriveNetwork('not-an-ip')).toThrow();
    expect(() => deriveNetwork('192.168.10.1')).toThrow();
    expect(() => deriveNetwork('192.168.10.300/24')).toThrow();
  });
});

describe('hotspot setup wizard', () => {
  let h: ReturnType<typeof harness>;
  let routerId: string;
  beforeEach(async () => {
    h = harness();
    routerId = await makeRouter(h.db);
  });

  it('preview returns steps grouped with sentences, nothing enqueued', async () => {
    const preview = await h.wizard.preview(routerId, { ...DTO, opId: 'op-wiz-prev' });
    expect(preview.opId).toBe('op-wiz-prev');
    const keys = preview.steps.map((s) => s.key);
    expect(keys).toEqual([
      'address', 'pool', 'dhcp', 'dns', 'nat', 'walled-garden',
      'server-profile', 'server', 'login-page',
    ]);
    expect(preview.totalSentences).toBe(preview.steps.reduce((n, s) => n + s.sentences.length, 0));
    expect(preview.totalSentences).toBeGreaterThan(5);
    // Every mutating step carries real sentences; the login page is notes-only.
    for (const s of preview.steps) {
      if (s.key === 'login-page') {
        expect(s.sentences).toHaveLength(0);
        expect(s.notes.length).toBeGreaterThan(0);
      } else {
        expect(s.sentences.length).toBeGreaterThan(0);
      }
    }
    // Key sentences land on the right API paths.
    const firstWords = preview.steps.flatMap((s) => s.sentences.map((w) => w[0]));
    expect(firstWords).toContain('/ip/address/add');
    expect(firstWords).toContain('/ip/pool/add');
    expect(firstWords).toContain('/ip/dhcp-server/network/add');
    expect(firstWords).toContain('/ip/dhcp-server/add');
    expect(firstWords).toContain('/ip/dns/set');
    expect(firstWords).toContain('/ip/firewall/nat/add');
    expect(firstWords).toContain('/ip/hotspot/walled-garden/add');
    expect(firstWords).toContain('/ip/hotspot/profile/add');
    expect(firstWords).toContain('/ip/hotspot/add');
    // The masquerade rule targets the WAN interface.
    const nat = preview.steps.find((s) => s.key === 'nat')!.sentences[0].join(' ');
    expect(nat).toContain('=out-interface=ether1');
    expect(nat).toContain('=action=masquerade');
    // Nothing was enqueued by a preview.
    expect(h.jobs.pending('commands')).toHaveLength(0);
  });

  it('preview without walled-garden hosts omits that step', async () => {
    const { interface: iface, hotspotAddress } = DTO;
    const preview = await h.wizard.preview(routerId, { interface: iface, hotspotAddress });
    expect(preview.steps.map((s) => s.key)).not.toContain('walled-garden');
  });

  it('confirm=true enqueues ONE job with the full flattened batch + mirror rows', async () => {
    const res = await h.wizard.run(routerId, { ...DTO, confirm: true, opId: 'op-wiz-run' }, undefined);
    expect(res.replayed).toBeFalsy();
    const pending = h.jobs.pending('commands');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('op-wiz-run');
    expect(pending[0].name).toBe('provisioning.wizard.hotspot-setup');
    const preview = await h.wizard.preview(routerId, DTO);
    expect((pending[0].data.sentences as string[][]).length).toBe(preview.totalSentences);
    // Mirror rows for the new server + server-profile.
    expect(await h.db.hotspotServers.count({ routerId })).toBe(1);
    expect(await h.db.hotspotProfiles.count({ routerId })).toBe(1);
  });

  it('confirm is idempotent by opId', async () => {
    await h.wizard.run(routerId, { ...DTO, confirm: true, opId: 'op-wiz-idem' }, undefined);
    const second = await h.wizard.run(routerId, { ...DTO, confirm: true, opId: 'op-wiz-idem' }, undefined);
    expect(second.replayed).toBe(true);
    expect(h.jobs.pending('commands')).toHaveLength(1);
    expect(await h.db.hotspotServers.count({ routerId })).toBe(1);
  });

  it('buildHotspotSetupSteps is pure (no DB)', () => {
    const steps = buildHotspotSetupSteps(resolveWizardParams(DTO));
    expect(steps.length).toBeGreaterThan(5);
  });
});

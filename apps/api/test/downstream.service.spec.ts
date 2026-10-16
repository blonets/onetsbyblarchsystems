import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { RouterCommandsService } from '../src/commands/commands.service.js';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { GenericWebSshDriver, getDriver } from '../src/downstream/device-driver.js';
import { DownstreamService, guessVendor } from '../src/downstream/downstream.service.js';
import { EventsService } from '../src/events/events.module.js';
import { InMemoryJobs } from '../src/jobs/jobs.module.js';
import { NullRealtime } from '../src/realtime/realtime.port.js';
import { InMemoryVault } from '../src/vault/vault.port.js';

function setup() {
  const db = new InMemoryDatabase();
  const jobs = new InMemoryJobs();
  const commands = new RouterCommandsService(db, jobs, new NullRealtime(), new EventsService(), new AuditService(db));
  const svc = new DownstreamService(
    db,
    new InMemoryVault(),
    commands,
    new NullRealtime(),
    new EventsService(),
    new AuditService(db),
    new ConfigService({}),
  );
  return { db, jobs, svc };
}

async function makeRouter(db: InMemoryDatabase) {
  return db.routers.create({
    uuid: 'uuid-ds',
    tunnelIp: '10.200.0.6',
    sstpUsername: 'sstp-ds',
    sstpPasswordRef: 'ref-1',
    apiPasswordRef: 'ref-2',
  });
}

describe('DownstreamService proxy ports', () => {
  it('allocates the lowest free port in the pool and builds the tagged nat rule', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db);
    const cam = await svc.register(router.id, { name: 'cam-1', kind: 'camera', lanIp: '192.168.88.10', mgmtPort: 80 });
    const res = await svc.enableProxy(router.id, cam.deviceId, undefined);
    expect(res.proxyPort).toBe(40000);

    const payload = jobs.pending('commands')[0].data as { sentences: string[][] };
    const words = payload.sentences[0];
    expect(words[0]).toBe('/ip/firewall/nat/add');
    expect(words).toContain('=chain=dstnat');
    expect(words).toContain('=dst-port=40000');
    expect(words).toContain('=to-addresses=192.168.88.10');
    expect(words).toContain(`=comment=panel-proxy:${cam.deviceId}`);

    // Second device gets the next port.
    const ap = await svc.register(router.id, { name: 'ap-1', kind: 'ap', lanIp: '192.168.88.11', mgmtPort: 80 });
    const res2 = await svc.enableProxy(router.id, ap.deviceId, undefined);
    expect(res2.proxyPort).toBe(40001);
  });

  it('disableProxy removes the tagged rule and frees the port', async () => {
    const { db, jobs, svc } = setup();
    const router = await makeRouter(db);
    const cam = await svc.register(router.id, { name: 'cam-1', kind: 'camera', lanIp: '192.168.88.10', mgmtPort: 80 });
    await svc.enableProxy(router.id, cam.deviceId, undefined);
    const mirror = await db.firewallRules.findFirst({ routerId: router.id, comment: `panel-proxy:${cam.deviceId}` });
    await db.firewallRules.update({ id: mirror!.id }, { mikrotikId: '*7' });
    jobs.clear();

    await svc.disableProxy(router.id, cam.deviceId, undefined);
    const payload = jobs.pending('commands')[0].data as { sentences: string[][] };
    expect(payload.sentences).toEqual([['/ip/firewall/nat/remove', '=.id=*7']]);
    expect(await db.firewallRules.findFirst({ routerId: router.id, comment: `panel-proxy:${cam.deviceId}` })).toBeNull();
    const dev = await db.downstreamDevices.findFirst({ routerId: router.id, deviceId: cam.deviceId });
    expect(dev?.proxyPort).toBeNull();
  });
});

describe('DownstreamService.ingestDiscovery', () => {
  it('normalizes raw reply rows (kebab-case) into device entities', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const res = await svc.ingestDiscovery(router.id, [
      { '.id': '*1', 'mac-address': 'AA:BB:CC:DD:EE:01', address: '192.168.88.21', identity: 'ap-lobby', platform: 'MikroTik', interface: 'bridge-lan' },
      { '.id': '*2', 'mac-address': 'AA:BB:CC:DD:EE:02', address: '192.168.88.22', identity: 'cam-door', platform: 'Hikvision', interface: 'bridge-lan' },
    ]);
    expect(res).toEqual({ discovered: 2, updated: 0 });
    const devices = await db.downstreamDevices.findMany({ where: { routerId: router.id } });
    expect(devices).toHaveLength(2);
    const mikrotik = devices.find((d) => d.macAddress === 'AA:BB:CC:DD:EE:01');
    expect(mikrotik?.kind).toBe('mikrotik');
    expect(mikrotik?.mgmtPort).toBe(8728);
    expect(mikrotik?.lastSeen).not.toBeNull();

    // Second pass with the same neighbors → updates, not duplicates.
    const res2 = await svc.ingestDiscovery(router.id, [
      { '.id': '*1', 'mac-address': 'AA:BB:CC:DD:EE:01', address: '192.168.88.21', identity: 'ap-lobby-renamed', platform: 'MikroTik' },
    ]);
    expect(res2).toEqual({ discovered: 0, updated: 1 });
    expect(await db.downstreamDevices.count({ routerId: router.id })).toBe(2);
  });

  it('also accepts parsed (camelCase) rows from ros-api parsers', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    await svc.ingestDiscovery(router.id, [
      { id: '*3', macAddress: 'AA:BB:CC:DD:EE:03', address: '192.168.88.23', identity: 'sw-1', platform: 'MikroTik' } as unknown as Record<string, string>,
    ]);
    const devices = await db.downstreamDevices.findMany({ where: { routerId: router.id } });
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('sw-1');
  });
});

describe('DownstreamService vendor-neutral records', () => {
  it('stores vendor/model/mgmtMethods on register, defaulting vendor to unknown', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const d1 = await svc.register(router.id, { name: 'ap', kind: 'ap', lanIp: '192.168.88.50', mgmtPort: 80 });
    expect(d1.vendor).toBe('unknown');
    expect(d1.mgmtMethods).toBeNull();
    const d2 = await svc.register(router.id, {
      name: 'owrt', kind: 'ap', lanIp: '192.168.88.51', mgmtPort: 80,
      vendor: 'openwrt', model: 'Archer C7', mgmtMethods: { web: 80, ssh: 22 },
    });
    expect(d2.vendor).toBe('openwrt');
    expect(d2.model).toBe('Archer C7');
    expect(d2.mgmtMethods).toEqual({ web: 80, ssh: 22 });
  });

  it('discovery guesses the vendor from the neighbor platform string', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    await svc.ingestDiscovery(router.id, [
      { '.id': '*1', 'mac-address': 'AA:BB:CC:DD:EE:11', address: '192.168.88.61', identity: 'owrt-1', platform: 'OpenWrt', board: 'Archer C7' },
      { '.id': '*2', 'mac-address': 'AA:BB:CC:DD:EE:12', address: '192.168.88.62', identity: 'uap-1', platform: 'UniFi' },
      { '.id': '*3', 'mac-address': 'AA:BB:CC:DD:EE:13', address: '192.168.88.63', identity: 'mystery' },
    ]);
    const byMac = new Map((await db.downstreamDevices.findMany({ where: { routerId: router.id } })).map((d) => [d.macAddress, d]));
    expect(byMac.get('AA:BB:CC:DD:EE:11')?.vendor).toBe('openwrt');
    expect(byMac.get('AA:BB:CC:DD:EE:11')?.model).toBe('Archer C7');
    expect(byMac.get('AA:BB:CC:DD:EE:12')?.vendor).toBe('ubiquiti');
    expect(byMac.get('AA:BB:CC:DD:EE:13')?.vendor).toBe('unknown');
  });

  it('getStatus reports unreachable (no probe) when the proxy is not enabled', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const dev = await svc.register(router.id, { name: 'ap', kind: 'ap', lanIp: '192.168.88.50', mgmtPort: 80 });
    const status = await svc.getStatus(router.id, dev.deviceId);
    expect(status.reachable).toBe(false);
    expect(status.detail).toMatch(/proxy port not allocated/);
  });
});

describe('guessVendor', () => {
  it('classifies platform strings without vendor-specific behavior', () => {
    expect(guessVendor('MikroTik')).toBe('mikrotik');
    expect(guessVendor('RouterOS')).toBe('mikrotik');
    expect(guessVendor('OpenWrt')).toBe('openwrt');
    expect(guessVendor('DD-WRT')).toBe('ddwrt');
    expect(guessVendor('Ubiquiti')).toBe('ubiquiti');
    expect(guessVendor('UniFi')).toBe('ubiquiti');
    expect(guessVendor('airOS')).toBe('ubiquiti');
    expect(guessVendor('Cisco')).toBe('cisco');
    expect(guessVendor('Hikvision')).toBe('unknown');
    expect(guessVendor(undefined)).toBe('unknown');
  });
});

describe('DeviceDriver contract (Phase 1)', () => {
  it('getDriver returns the generic passthrough for every vendor', () => {
    for (const v of ['openwrt', 'ddwrt', 'ubiquiti', 'cisco', 'mikrotik', 'unknown'] as const) {
      const d = getDriver(v);
      expect(d).toBeInstanceOf(GenericWebSshDriver);
      expect(d.vendor).toBe('unknown');
    }
  });

  it('reboot/backupConfig throw NOT_IMPLEMENTED instead of faking vendor behavior', async () => {
    const d = new GenericWebSshDriver();
    const ctx = {
      routerTunnelIp: '10.200.0.6',
      proxyPort: 40000,
      mgmtMethods: {},
      device: { deviceId: 'dd-x', name: 'x', vendor: 'openwrt' as const, model: null, lanIp: '192.168.88.1', mgmtPort: 80 },
    };
    await expect(d.reboot(ctx)).rejects.toThrow(/NOT_IMPLEMENTED/);
    await expect(d.backupConfig(ctx)).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});

describe('DownstreamService.registerCascade', () => {
  it('registers a downstream MikroTik as a managed router with an allocated tunnel IP', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const dev = await svc.register(router.id, { name: 'branch-mtik', kind: 'mikrotik', lanIp: '192.168.88.30', mgmtPort: 8728 });
    const res = await svc.registerCascade(router.id, dev.deviceId);
    expect(res.tunnelIp).toBe('10.200.0.2'); // allocation starts at .2 (.0 net, .1 hub); parent is .6
    expect(res.alreadyRegistered).toBe(false);
    const created = await db.routers.findUnique({ id: res.routerId });
    expect(created?.status).toBe('pending');
    expect(created?.siteId).toBe(router.siteId);
  });

  it('refuses non-MikroTik devices', async () => {
    const { db, svc } = setup();
    const router = await makeRouter(db);
    const cam = await svc.register(router.id, { name: 'cam', kind: 'camera', lanIp: '192.168.88.40', mgmtPort: 80 });
    await expect(svc.registerCascade(router.id, cam.deviceId)).rejects.toThrow(/only kind=mikrotik/);
  });
});

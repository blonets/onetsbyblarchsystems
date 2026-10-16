/**
 * Conformance suite: exercises the FULL @mtk/ros-api builder surface through
 * {@link RosConnection} + {@link TcpTransport} against the local mock
 * RouterOS API server (./mock/server.mjs), spawned here via child_process on
 * 127.0.0.1 (ephemeral ports). Nothing here touches real hardware — a green
 * suite proves the client speaks the protocol correctly and every builder's
 * sentence shape is accepted; live CHR devices get their own verification
 * pass (mission item 4).
 *
 * Run: pnpm --filter @mtk/ros-api test
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { RosConnection, TcpTransport, replyRows, RosTrapError } from '../src/index.js';
import type { ReplySentence } from '../src/index.js';
import {
  hotspotUserAdd, hotspotUserList, hotspotUserSet, hotspotUserRemove,
  hotspotProfileAdd, hotspotProfileList, hotspotProfileSet, hotspotProfileRemove,
  hotspotProfileEnable, hotspotProfileDisable,
  hotspotServerAdd, hotspotServerList, hotspotServerSet, hotspotServerRemove,
  hotspotServerProfileAdd, hotspotServerProfileList, hotspotServerProfileRemove,
  walledGardenAdd, walledGardenList, walledGardenSet, walledGardenRemove,
  walledGardenDisable,
  walledGardenIpAdd, walledGardenIpList, walledGardenIpRemove,
  parseHotspotUsers, parseHotspotProfiles, parseHotspotServers,
} from '../src/commands/hotspot.js';
import {
  filterRuleAdd, filterRuleList, filterRuleSet, filterRuleRemove,
  filterRuleEnable, filterRuleDisable, filterRuleMove,
  natRuleAdd, natRuleList, natRuleRemove, natRuleMove,
  mangleRuleAdd, mangleRuleList, mangleRuleRemove,
  addressListAdd, addressListList, addressListRemove,
  downstreamProxyRuleAdd,
  parseFirewallRules, parseMangleRules, parseAddressList,
} from '../src/commands/firewall.js';
import {
  simpleQueueAdd, simpleQueueList, simpleQueueSet, simpleQueueRemove,
  simpleQueueDisable, simpleQueueEnable, simpleQueueMove,
  queueTreeAdd, queueTreeList, queueTreeRemove,
  parseSimpleQueues, parseQueueTree,
} from '../src/commands/queue.js';
import {
  pppSecretAdd, pppSecretList, pppSecretSet, pppSecretRemove,
  pppProfileAdd, pppProfileList, pppProfileRemove,
  pppActiveList,
  parsePppSecrets, parsePppProfiles, parsePppActive,
} from '../src/commands/ppp.js';import {
  resourcePrint, identityPrint, identitySet,
  systemNotePrint, systemNoteSet,
  schedulerAdd, schedulerList, schedulerSet, schedulerRemove, schedulerDisable, schedulerEnable,
  scriptAdd, scriptList, scriptRemove, scriptRun,
  backupSave, configExport, routerboardPrint, packageList,
  parseResource, parseIdentity, parseSystemNote, parseSchedulers, parseScripts,
  exportText,
} from '../src/commands/system.js';
import {
  neighborList, ipAddressAdd, ipAddressList, ipAddressRemove,
  dhcpServerAdd, dhcpServerList, dhcpServerRemove,
  dhcpNetworkAdd, dhcpNetworkList, dhcpNetworkRemove,
  ipPoolAdd, ipPoolList, ipPoolRemove,
  parseNeighbors, parseIpAddresses, parseDhcpServers, parseDhcpNetworks, parseIpPools,
} from '../src/commands/ip.js';
import {
  interfaceList,
  sstpClientAdd, sstpClientList, sstpClientSet, sstpClientRemove, sstpClientDisable,
  parseInterfaces, parseSstpClients,
} from '../src/commands/interface.js';

const TEST_USER = 'conf-admin';
const TEST_PASS = 'c0nf-pw';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_MJS = path.resolve(HERE, './mock/server.mjs');

/* ---------------- mock lifecycle ---------------- */

let servers: ChildProcess[] = [];
let bothPort = 0;
let modernPort = 0;

function spawnMock(login: 'both' | 'modern'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = spawn(
      process.execPath,
      [SERVER_MJS, '--port', '0', '--login', login, '--user', TEST_USER, '--password', TEST_PASS],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    servers.push(server);
    const t = setTimeout(() => reject(new Error('mock server did not print READY')), 10000);
    let acc = '';
    server.stdout!.on('data', (c: Buffer) => {
      acc += c.toString();
      const m = acc.match(/READY port=(\d+)/);
      if (m) { clearTimeout(t); resolve(Number(m[1])); }
    });
    server.on('error', reject);
  });
}

beforeAll(async () => {
  expect(existsSync(SERVER_MJS), `mock server missing: ${SERVER_MJS}`).toBe(true);
  [bothPort, modernPort] = await Promise.all([spawnMock('both'), spawnMock('modern')]);
}, 30000);

afterAll(async () => {
  for (const s of servers) s.kill();
});

/* ---------------- helpers ---------------- */

async function loggedIn(port: number, loginMode: 'auto' | 'legacy' | 'modern' = 'auto'): Promise<RosConnection> {
  const conn = new RosConnection(new TcpTransport({ host: '127.0.0.1', port }), { loginMode });
  await conn.connect();
  await conn.login(TEST_USER, TEST_PASS);
  return conn;
}

async function close(conn: RosConnection): Promise<void> {
  await conn.close().catch(() => undefined);
}

/** Talk and return the terminal !done attrs (e.g. `ret` from an add). */
async function doneAttrs(conn: RosConnection, words: string[]): Promise<Record<string, string>> {
  const replies = await conn.talk(words);
  const last = replies[replies.length - 1]!;
  expect(last.type).toBe('done');
  return last.attrs;
}

const retOf = (attrs: Record<string, string>): string => {
  const ret = attrs['ret'];
  expect(ret).toMatch(/^\*[0-9A-F]+$/);
  return ret!;
};

let n = 0;
/** unique, RouterOS-safe test name */
const tag = (prefix: string): string => `${prefix}-${++n}`;

async function rowsOf(conn: RosConnection, words: string[]): Promise<Record<string, string>[]> {
  return replyRows(await conn.talk(words));
}

/* ---------------- suite ---------------- */

describe('login flows (live socket)', () => {
  it('modern flow: auto login against a modern-only device (no bare /login)', async () => {
    // The modern-only mock traps a bare /login, and loginMode 'modern' never
    // falls back — success proves the client never sent a bare /login first.
    const conn = await loggedIn(modernPort, 'modern');
    const rows = await rowsOf(conn, resourcePrint());
    expect(rows[0]!['board-name']).toBe('CHR');
    await close(conn);
  });

  it('auto login against a both-mode device', async () => {
    const conn = await loggedIn(bothPort, 'auto');
    const rows = await rowsOf(conn, resourcePrint());
    expect(rows[0]!['version']).toBeTruthy();
    await close(conn);
  });

  it('legacy flow: MD5 challenge-response', async () => {
    const conn = await loggedIn(bothPort, 'legacy');
    const rows = await rowsOf(conn, identityPrint());
    expect(rows[0]!['name']).toBe('mock-router');
    await close(conn);
  });

  it('wrong password is rejected', async () => {
    const conn = new RosConnection(new TcpTransport({ host: '127.0.0.1', port: bothPort }));
    await conn.connect();
    await expect(conn.login(TEST_USER, 'wrong-pw')).rejects.toThrow();
    await close(conn);
  });
});

describe('hotspot', () => {
  it('user lifecycle: add -> print -> set -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const name = tag('hsu');
    const id = retOf(await doneAttrs(conn, hotspotUserAdd({ server: 'all', name, password: 'pw', profile: 'default' })));

    let users = parseHotspotUsers(await conn.talk(hotspotUserList({ name })));
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id, name, profile: 'default', disabled: false });

    await conn.talk(hotspotUserSet(id, { limitUptime: '2h' }));
    const raw = await rowsOf(conn, hotspotUserList({ name }));
    expect(raw[0]!['limit-uptime']).toBe('2h');

    await conn.talk(hotspotUserRemove(id));
    users = parseHotspotUsers(await conn.talk(hotspotUserList({ name })));
    expect(users).toHaveLength(0);
    await close(conn);
  });

  it('user profile lifecycle', async () => {
    const conn = await loggedIn(bothPort);
    const name = tag('hsp');
    const id = retOf(await doneAttrs(conn, hotspotProfileAdd({ name, rateLimit: '10M/10M' })));
    let profiles = parseHotspotProfiles(await conn.talk(hotspotProfileList()));
    expect(profiles.some((p) => p.id === id)).toBe(true);

    await conn.talk(hotspotProfileDisable(id));
    await conn.talk(hotspotProfileEnable(id));
    await conn.talk(hotspotProfileSet(id, { sessionTimeout: '1h' }));
    await conn.talk(hotspotProfileRemove(id));
    profiles = parseHotspotProfiles(await conn.talk(hotspotProfileList()));
    expect(profiles.some((p) => p.id === id)).toBe(false);
    await close(conn);
  });

  it('server lifecycle', async () => {
    const conn = await loggedIn(bothPort);
    const name = tag('hss');
    const id = retOf(await doneAttrs(conn, hotspotServerAdd({ name, interface: 'ether1' })));
    let servers = parseHotspotServers(await conn.talk(hotspotServerList()));
    expect(servers.some((s) => s.id === id)).toBe(true);
    await conn.talk(hotspotServerSet(id, { comment: 'conf' }));
    await conn.talk(hotspotServerRemove(id));
    servers = parseHotspotServers(await conn.talk(hotspotServerList()));
    expect(servers.some((s) => s.id === id)).toBe(false);
    await close(conn);
  });

  it('server-profile add -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const name = tag('hsprof');
    const id = retOf(await doneAttrs(conn, hotspotServerProfileAdd({ name })));
    await conn.talk(hotspotServerProfileRemove(id));
    const rows = await rowsOf(conn, hotspotServerProfileList());
    expect(rows.some((r) => r['.id'] === id)).toBe(false);
    await close(conn);
  });

  it('walled-garden add -> set -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const host = `${tag('wg')}.example.com`;
    const id = retOf(await doneAttrs(conn, walledGardenAdd({ dstHost: host })));
    await conn.talk(walledGardenSet(id, { action: 'deny' }));
    await conn.talk(walledGardenDisable(id));
    await conn.talk(walledGardenRemove(id));
    const rows = await rowsOf(conn, walledGardenList());
    expect(rows.some((r) => r['.id'] === id)).toBe(false);
    await close(conn);
  });

  it('walled-garden-ip add -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const id = retOf(await doneAttrs(conn, walledGardenIpAdd({ dstAddress: '203.0.113.7' })));
    await conn.talk(walledGardenIpRemove(id));
    const rows = await rowsOf(conn, walledGardenIpList());
    expect(rows.some((r) => r['.id'] === id)).toBe(false);
    await close(conn);
  });
});

describe('firewall', () => {
  it('filter lifecycle: add -> print -> move -> disable/enable -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const comment = tag('fw');
    const idA = retOf(await doneAttrs(conn, filterRuleAdd({ chain: 'forward', action: 'accept', comment })));
    const idB = retOf(await doneAttrs(conn, filterRuleAdd({ chain: 'forward', action: 'drop', comment })));

    await conn.talk(filterRuleMove(idB, idA));
    let rules = parseFirewallRules(await conn.talk(filterRuleList({ comment })));
    expect(rules.map((r) => r.id)).toEqual([idB, idA]);

    await conn.talk(filterRuleDisable(idA));
    rules = parseFirewallRules(await conn.talk(filterRuleList({ comment })));
    expect(rules.find((r) => r.id === idA)!.disabled).toBe(true);
    await conn.talk(filterRuleEnable(idA));
    await conn.talk(filterRuleSet(idA, { log: true }));

    await conn.talk(filterRuleRemove(idA));
    await conn.talk(filterRuleRemove(idB));
    rules = parseFirewallRules(await conn.talk(filterRuleList({ comment })));
    expect(rules).toHaveLength(0);
    await close(conn);
  });

  it('nat add -> print -> move -> remove (incl. panel-proxy rule)', async () => {
    const conn = await loggedIn(bothPort);
    const id = retOf(await doneAttrs(conn, downstreamProxyRuleAdd('cam-99', 8199, '192.168.88.10', 80)));
    let rules = parseFirewallRules(await conn.talk(natRuleList({ comment: 'panel-proxy:cam-99' })));
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe('platform');

    const id2 = retOf(await doneAttrs(conn, natRuleAdd({ chain: 'srcnat', action: 'masquerade' })));
    await conn.talk(natRuleMove(id2, id));
    rules = parseFirewallRules(await conn.talk(natRuleList({})));
    expect(rules.findIndex((r) => r.id === id2)).toBeLessThan(rules.findIndex((r) => r.id === id));

    await conn.talk(natRuleRemove(id));
    await conn.talk(natRuleRemove(id2));
    await close(conn);
  });

  it('mangle add -> print -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const id = retOf(await doneAttrs(conn, mangleRuleAdd({ chain: 'prerouting', action: 'mark-packet', newPacketMark: 'conf' })));
    const rules = parseMangleRules(await conn.talk(mangleRuleList({})));
    expect(rules.some((r) => r.id === id && r.newPacketMark === 'conf')).toBe(true);
    await conn.talk(mangleRuleRemove(id));
    await close(conn);
  });

  it('address-list add -> print -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const list = tag('blocked');
    const id = retOf(await doneAttrs(conn, addressListAdd({ list, address: '198.51.100.9' })));
    const entries = parseAddressList(await conn.talk(addressListList({ list })));
    expect(entries).toHaveLength(1);
    await conn.talk(addressListRemove(id));
    await close(conn);
  });
});

describe('queues', () => {
  it('simple queue lifecycle: add -> set -> disable/enable -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const name = tag('q');
    const id = retOf(await doneAttrs(conn, simpleQueueAdd({ name, target: '192.0.2.9/32', maxLimit: '1M/1M', disabled: true })));
    let queues = parseSimpleQueues(await conn.talk(simpleQueueList()));
    expect(queues.find((q) => q.id === id)).toMatchObject({ name, disabled: true });

    await conn.talk(simpleQueueSet(id, { maxLimit: '2M/2M' }));
    await conn.talk(simpleQueueEnable(id));
    queues = parseSimpleQueues(await conn.talk(simpleQueueList()));
    expect(queues.find((q) => q.id === id)).toMatchObject({ maxLimit: '2M/2M', disabled: false });

    await conn.talk(simpleQueueDisable(id));
    await conn.talk(simpleQueueRemove(id));
    queues = parseSimpleQueues(await conn.talk(simpleQueueList()));
    expect(queues.some((q) => q.id === id)).toBe(false);
    await close(conn);
  });

  it('simple queue move reorders', async () => {
    const conn = await loggedIn(bothPort);
    const idA = retOf(await doneAttrs(conn, simpleQueueAdd({ name: tag('qa'), target: '192.0.2.1/32' })));
    const idB = retOf(await doneAttrs(conn, simpleQueueAdd({ name: tag('qb'), target: '192.0.2.2/32' })));
    await conn.talk(simpleQueueMove(idB, idA));
    const queues = parseSimpleQueues(await conn.talk(simpleQueueList()));
    const ids = queues.map((q) => q.id);
    expect(ids.indexOf(idB)).toBeLessThan(ids.indexOf(idA));
    await conn.talk(simpleQueueRemove(idA));
    await conn.talk(simpleQueueRemove(idB));
    await close(conn);
  });

  it('queue tree add -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const name = tag('qt');
    const id = retOf(await doneAttrs(conn, queueTreeAdd({ name, parent: 'global', maxLimit: '5M/5M' })));
    const tree = parseQueueTree(await conn.talk(queueTreeList()));
    expect(tree.some((t) => t.id === id && t.parent === 'global')).toBe(true);
    await conn.talk(queueTreeRemove(id));
    await close(conn);
  });
});

describe('ppp', () => {
  it('secret lifecycle: add -> print -> set -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const name = tag('sstp');
    const id = retOf(await doneAttrs(conn, pppSecretAdd({
      name, password: 'pw', service: 'sstp', remoteAddress: '10.200.0.77', comment: 'panel-router:uuid-x',
    })));
    let secrets = parsePppSecrets(await conn.talk(pppSecretList({ name })));
    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatchObject({ id, remoteAddress: '10.200.0.77' });

    await conn.talk(pppSecretSet(id, { remoteAddress: '10.200.0.78' }));
    secrets = parsePppSecrets(await conn.talk(pppSecretList({ name })));
    expect(secrets[0]!.remoteAddress).toBe('10.200.0.78');

    await conn.talk(pppSecretRemove(id));
    secrets = parsePppSecrets(await conn.talk(pppSecretList({ name })));
    expect(secrets).toHaveLength(0);
    await close(conn);
  });

  it('profile add -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const id = retOf(await doneAttrs(conn, pppProfileAdd({ name: tag('pp'), localAddress: '10.200.0.1' })));
    const profiles = parsePppProfiles(await conn.talk(pppProfileList()));
    expect(profiles.some((p) => p.id === id)).toBe(true);
    await conn.talk(pppProfileRemove(id));
    await close(conn);
  });

  it('active print returns rows', async () => {
    const conn = await loggedIn(bothPort);
    const active = parsePppActive(await conn.talk(pppActiveList()));
    expect(Array.isArray(active)).toBe(true);
    await close(conn);
  });
});

describe('system', () => {
  it('resource print parses', async () => {
    const conn = await loggedIn(bothPort);
    const res = parseResource(await conn.talk(resourcePrint()));
    expect(res['board-name']).toBe('CHR');
    expect(res['version']).toBeTruthy();
    await close(conn);
  });

  it('identity set/print round-trip (and =comment= is rejected)', async () => {
    const conn = await loggedIn(bothPort);
    const name = tag('router');
    await conn.talk(identitySet(name));
    expect(parseIdentity(await conn.talk(identityPrint())).name).toBe(name);
    await conn.talk(identitySet('mock-router')); // restore
    // identity exposes only `name` — a comment word must be rejected
    await expect(conn.talk(['/system/identity/set', '=name=x', '=comment=y'])).rejects.toBeInstanceOf(RosTrapError);
    await close(conn);
  });

  it('note set/print round-trip (panel-uuid stamp)', async () => {
    const conn = await loggedIn(bothPort);
    await conn.talk(systemNoteSet('panel-uuid:uuid-conf-1'));
    expect(parseSystemNote(await conn.talk(systemNotePrint())).note).toBe('panel-uuid:uuid-conf-1');
    await conn.talk(systemNoteSet('')); // restore
    await close(conn);
  });

  it('scheduler lifecycle', async () => {
    const conn = await loggedIn(bothPort);
    const name = tag('sched');
    const id = retOf(await doneAttrs(conn, schedulerAdd({ name, onEvent: ':log info hi', interval: '5m' })));
    await conn.talk(schedulerDisable(id));
    let sched = parseSchedulers(await conn.talk(schedulerList()));
    expect(sched.find((s) => s.id === id)!.disabled).toBe(true);
    await conn.talk(schedulerEnable(id));
    await conn.talk(schedulerSet(id, { interval: '10m' }));
    sched = parseSchedulers(await conn.talk(schedulerList()));
    expect(sched.find((s) => s.id === id)!.interval).toBe('10m');
    await conn.talk(schedulerRemove(id));
    await close(conn);
  });

  it('script add -> run -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const id = retOf(await doneAttrs(conn, scriptAdd({ name: tag('scr'), source: ':put "hi"' })));
    await conn.talk(scriptRun(id));
    const scripts = parseScripts(await conn.talk(scriptList()));
    expect(scripts.some((s) => s.id === id)).toBe(true);
    await conn.talk(scriptRemove(id));
    await close(conn);
  });

  it('backup save, routerboard/package print, export fetch', async () => {
    const conn = await loggedIn(bothPort);
    await conn.talk(backupSave('conf-backup'));
    const rb = await rowsOf(conn, routerboardPrint());
    expect(rb[0]!['board-name']).toBe('CHR');
    const pkgs = await rowsOf(conn, packageList());
    expect(pkgs.length).toBeGreaterThan(0);
    const text = exportText(await conn.talk(configExport()));
    expect(text).toContain('mock export');
    await close(conn);
  });
});

describe('ip', () => {
  it('neighbor print returns seeded rows', async () => {
    const conn = await loggedIn(bothPort);
    const neighbors = parseNeighbors(await conn.talk(neighborList()));
    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors[0]!.macAddress).toBeTruthy();
    await close(conn);
  });

  it('address add -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const id = retOf(await doneAttrs(conn, ipAddressAdd({ address: '192.0.2.1/24', interface: 'ether1' })));
    const addrs = parseIpAddresses(await conn.talk(ipAddressList({})));
    expect(addrs.some((a) => a.id === id)).toBe(true);
    await conn.talk(ipAddressRemove(id));
    await close(conn);
  });

  it('dhcp-server add -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const id = retOf(await doneAttrs(conn, dhcpServerAdd({ name: tag('dhcp'), interface: 'ether1', addressPool: 'static-only' })));
    const srvs = parseDhcpServers(await conn.talk(dhcpServerList()));
    expect(srvs.some((s) => s.id === id)).toBe(true);
    await conn.talk(dhcpServerRemove(id));
    await close(conn);
  });

  it('dhcp-network add -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const id = retOf(await doneAttrs(conn, dhcpNetworkAdd({ address: '192.0.2.0/24', gateway: '192.0.2.1' })));
    const nets = parseDhcpNetworks(await conn.talk(dhcpNetworkList()));
    expect(nets.some((x) => x.id === id)).toBe(true);
    await conn.talk(dhcpNetworkRemove(id));
    await close(conn);
  });

  it('pool add -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const id = retOf(await doneAttrs(conn, ipPoolAdd({ name: tag('pool'), ranges: '192.0.2.10-192.0.2.20' })));
    const pools = parseIpPools(await conn.talk(ipPoolList()));
    expect(pools.some((p) => p.id === id)).toBe(true);
    await conn.talk(ipPoolRemove(id));
    await close(conn);
  });
});

describe('interface', () => {
  it('interface print returns rows', async () => {
    const conn = await loggedIn(bothPort);
    const ifs = parseInterfaces(await conn.talk(interfaceList()));
    expect(ifs.length).toBeGreaterThan(0);
    expect(ifs[0]!.name).toBe('ether1');
    await close(conn);
  });

  it('sstp-client: add (3 params only) -> set -> disable -> remove', async () => {
    const conn = await loggedIn(bothPort);
    const user = tag('sstp');
    const id = retOf(await doneAttrs(conn, sstpClientAdd('hub.example.com', user, 'pw')));
    await conn.talk(sstpClientSet(id, { name: user, verifyServerCertificate: false }));
    let clients = parseSstpClients(await conn.talk(sstpClientList()));
    expect(clients.find((c) => c.id === id)).toMatchObject({ name: user, connectTo: 'hub.example.com' });
    await conn.talk(sstpClientDisable(id));
    clients = parseSstpClients(await conn.talk(sstpClientList()));
    expect(clients.find((c) => c.id === id)!.disabled).toBe(true);
    await conn.talk(sstpClientRemove(id));
    clients = parseSstpClients(await conn.talk(sstpClientList()));
    expect(clients.some((c) => c.id === id)).toBe(false);
    await close(conn);
  });

  it('sstp-client add with extra params is rejected (creation quirk)', async () => {
    const conn = await loggedIn(bothPort);
    await expect(
      conn.talk(['/interface/sstp-client/add', '=connect-to=h', '=user=u', '=password=p', '=disabled=no']),
    ).rejects.toBeInstanceOf(RosTrapError);
    await close(conn);
  });

  it('sstp-client =port= is rejected on set (port lives in connect-to)', async () => {
    const conn = await loggedIn(bothPort);
    const id = retOf(await doneAttrs(conn, sstpClientAdd('hub.example.com', tag('sstp'), 'pw')));
    await expect(
      conn.talk(['/interface/sstp-client/set', `=.id=${id}`, '=port=444']),
    ).rejects.toBeInstanceOf(RosTrapError);
    // ...but connect-to=host:port is accepted
    await conn.talk(sstpClientSet(id, { connectTo: 'hub.example.com:444' }));
    await conn.talk(sstpClientRemove(id));
    await close(conn);
  });
});

describe('!trap maps to typed errors', () => {
  it('unknown command -> RosTrapError with the device message', async () => {
    const conn = await loggedIn(bothPort);
    const err = await conn.talk(['/no/such/command']).catch((e) => e);
    expect(err).toBeInstanceOf(RosTrapError);
    expect((err as RosTrapError).message).toBe('unknown command');
    expect((err as RosTrapError).attrs['message']).toBe('unknown command');
    await close(conn);
  });

  it('set on a missing id -> RosTrapError', async () => {
    const conn = await loggedIn(bothPort);
    await expect(conn.talk(hotspotUserSet('*ZZZ', { profile: 'x' }))).rejects.toBeInstanceOf(RosTrapError);
    await close(conn);
  });

  it('remove without an id is a silent no-op (live-verified on 6.49.17)', async () => {
    const conn = await loggedIn(bothPort);
    const replies = await conn.talk(['/ip/hotspot/user/remove']);
    expect(replies[replies.length - 1]!.type).toBe('done');
    await close(conn);
  });
});

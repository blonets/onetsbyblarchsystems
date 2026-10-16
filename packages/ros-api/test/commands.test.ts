import { describe, expect, it } from 'vitest';
import {
  addressListAdd,
  addressListRemove,
  downstreamProxyRuleAdd,
  filterRuleAdd,
  filterRuleList,
  filterRuleMove,
  filterRuleRemove,
  mangleRuleAdd,
  mangleRuleMove,
  natRuleAdd,
  natRuleList,
  natRuleMove,
  parseAddressList,
  parseFirewallRules,
  parseMangleRules,
} from '../src/commands/firewall.js';
import {
  hotspotProfileAdd,
  hotspotProfileDisable,
  hotspotProfileEnable,
  hotspotServerAdd,
  hotspotServerDisable,
  hotspotServerList,
  hotspotServerProfileAdd,
  hotspotServerProfileRemove,
  hotspotUserAdd,
  hotspotUserDisable,
  hotspotUserList,
  hotspotUserRemove,
  hotspotUserSet,
  parseHotspotProfiles,
  parseHotspotServerProfiles,
  parseHotspotServers,
  parseHotspotUsers,
  parseWalledGarden,
  parseWalledGardenIp,
  walledGardenAdd,
  walledGardenDisable,
  walledGardenIpAdd,
  walledGardenIpRemove,
  walledGardenSet,
} from '../src/commands/hotspot.js';
import {
  pppActiveList,
  pppActiveRemove,
  pppProfileAdd,
  pppSecretAdd,
  parsePppActive,
  parsePppProfiles,
  parsePppSecrets,
} from '../src/commands/ppp.js';
import {
  parseQueueTree,
  parseSimpleQueues,
  queueTreeAdd,
  queueTreeMove,
  simpleQueueAdd,
  simpleQueueMove,
} from '../src/commands/queue.js';
import {
  backupSave,
  configExport,
  exportText,
  identityPrint,
  identitySet,
  parseIdentity,
  parseResource,
  parseSchedulers,
  parseScripts,
  parseSystemNote,
  resourcePrint,
  routerboardPrint,
  packageList,
  schedulerAdd,
  schedulerDisable,
  scriptAdd,
  scriptRun,
  systemNotePrint,
  systemNoteSet,
} from '../src/commands/system.js';
import {
  dhcpNetworkAdd,
  dhcpServerAdd,
  dhcpServerDisable,
  ipAddressAdd,
  ipPoolAdd,
  ipPoolRemove,
  neighborList,
  parseDhcpNetworks,
  parseDhcpServers,
  parseIpAddresses,
  parseIpPools,
  parseNeighbors,
} from '../src/commands/ip.js';
import {
  interfaceDisable,
  interfaceList,
  parseInterfaces,
  parseSstpClients,
  sstpClientAdd,
  sstpClientDisable,
  sstpClientList,
  sstpClientRemove,
  sstpClientSet,
} from '../src/commands/interface.js';
import { withTag } from '../src/commands/util.js';

describe('hotspot builders', () => {
  it('builds user add with only defined fields', () => {
    expect(
      hotspotUserAdd({ server: 'hs1', name: 'alice', password: 'pw', profile: 'default' }),
    ).toEqual([
      '/ip/hotspot/user/add',
      '=server=hs1',
      '=name=alice',
      '=password=pw',
      '=profile=default',
    ]);
  });

  it('encodes disabled=false explicitly', () => {
    expect(hotspotUserAdd({ server: 'hs1', name: 'a', disabled: false })).toContain('=disabled=no');
  });

  it('builds list with ?filters, set, remove, disable', () => {
    expect(hotspotUserList({ server: 'hs1' })).toEqual(['/ip/hotspot/user/print', '?server=hs1']);
    expect(hotspotUserSet('*1', { profile: 'vip' })).toEqual([
      '/ip/hotspot/user/set',
      '=.id=*1',
      '=profile=vip',
    ]);
    expect(hotspotUserRemove('*1')).toEqual(['/ip/hotspot/user/remove', '=.id=*1']);
    expect(hotspotUserDisable('*1')).toEqual(['/ip/hotspot/user/disable', '=.id=*1']);
  });

  it('builds server add / disable / list', () => {
    expect(
      hotspotServerAdd({ name: 'hs1', interface: 'bridge-lan', profile: 'hsprof1' }),
    ).toEqual([
      '/ip/hotspot/add',
      '=name=hs1',
      '=interface=bridge-lan',
      '=profile=hsprof1',
    ]);
    expect(hotspotServerDisable('*1')).toEqual(['/ip/hotspot/disable', '=.id=*1']);
    expect(hotspotServerList()).toEqual(['/ip/hotspot/print']);
  });

  it('builds server-profile add / remove', () => {
    expect(
      hotspotServerProfileAdd({ name: 'hsprof1', dnsName: 'login.cafe.example' }),
    ).toEqual([
      '/ip/hotspot/profile/add',
      '=name=hsprof1',
      '=dns-name=login.cafe.example',
    ]);
    expect(hotspotServerProfileRemove('*2')).toEqual(['/ip/hotspot/profile/remove', '=.id=*2']);
  });

  it('builds profile add and enable/disable', () => {
    expect(hotspotProfileAdd({ name: 'vip', rateLimit: '20M/20M', sharedUsers: 2 })).toEqual([
      '/ip/hotspot/user/profile/add',
      '=name=vip',
      '=rate-limit=20M/20M',
      '=shared-users=2',
    ]);
    expect(hotspotProfileEnable('*3')).toEqual(['/ip/hotspot/user/profile/enable', '=.id=*3']);
    expect(hotspotProfileDisable('*3')).toEqual(['/ip/hotspot/user/profile/disable', '=.id=*3']);
  });

  it('builds walled-garden add / set / disable and walled-garden-ip add / remove', () => {
    expect(walledGardenAdd({ dstHost: 'example.com' })).toEqual([
      '/ip/hotspot/walled-garden/add',
      '=dst-host=example.com',
    ]);
    expect(walledGardenSet('*4', { action: 'deny' })).toEqual([
      '/ip/hotspot/walled-garden/set',
      '=.id=*4',
      '=action=deny',
    ]);
    expect(walledGardenDisable('*4')).toEqual(['/ip/hotspot/walled-garden/disable', '=.id=*4']);
    expect(walledGardenIpAdd({ dstAddress: '203.0.113.7' })).toEqual([
      '/ip/hotspot/walled-garden/ip/add',
      '=dst-address=203.0.113.7',
    ]);
    expect(walledGardenIpRemove('*5')).toEqual([
      '/ip/hotspot/walled-garden/ip/remove',
      '=.id=*5',
    ]);
  });

  it('parses user rows', () => {
    const rows = parseHotspotUsers([
      { type: 're', attrs: { '.id': '*1', server: 'hs1', name: 'a', profile: 'default', 'bytes-in': '100', disabled: 'false' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(rows[0]).toMatchObject({ id: '*1', name: 'a', bytesIn: 100, disabled: false, dynamic: false });
  });

  it('parses profile / server / server-profile / walled-garden rows', () => {
    const profiles = parseHotspotProfiles([
      { type: 're', attrs: { '.id': '*9', name: 'vip', 'rate-limit': '20M/20M', 'shared-users': '2' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(profiles[0]).toMatchObject({ id: '*9', name: 'vip', rateLimit: '20M/20M', sharedUsers: 2 });

    const servers = parseHotspotServers([
      { type: 're', attrs: { '.id': '*A', name: 'hs1', interface: 'bridge-lan', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(servers[0]).toMatchObject({ id: '*A', name: 'hs1', interface: 'bridge-lan', disabled: false });

    const sps = parseHotspotServerProfiles([
      { type: 're', attrs: { '.id': '*B', name: 'hsprof1', 'dns-name': 'login.x' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(sps[0]).toMatchObject({ id: '*B', dnsName: 'login.x' });

    const wg = parseWalledGarden([
      { type: 're', attrs: { '.id': '*C', 'dst-host': 'example.com', action: 'allow', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(wg[0]).toMatchObject({ id: '*C', dstHost: 'example.com', action: 'allow' });

    const wgip = parseWalledGardenIp([
      { type: 're', attrs: { '.id': '*D', 'dst-address': '203.0.113.7', disabled: 'yes' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(wgip[0]).toMatchObject({ id: '*D', dstAddress: '203.0.113.7', disabled: true });
  });
});

describe('firewall builders', () => {
  it('builds filter add with place-before', () => {
    expect(
      filterRuleAdd({ chain: 'forward', action: 'drop', srcAddress: '1.2.3.4', placeBefore: '*0' }),
    ).toEqual([
      '/ip/firewall/filter/add',
      '=chain=forward',
      '=action=drop',
      '=src-address=1.2.3.4',
      '=place-before=*0',
    ]);
  });

  it('builds filter / nat move sentences', () => {
    expect(filterRuleMove('*2', '*0')).toEqual([
      '/ip/firewall/filter/move',
      '=.id=*2',
      '=destination=*0',
    ]);
    expect(natRuleMove('*3', '*0')).toEqual(['/ip/firewall/nat/move', '=.id=*3', '=destination=*0']);
    expect(mangleRuleMove('*4', '*0')).toEqual([
      '/ip/firewall/mangle/move',
      '=.id=*4',
      '=destination=*0',
    ]);
  });

  it('builds nat add / list / remove', () => {
    expect(natRuleAdd({ chain: 'srcnat', action: 'masquerade', outInterface: 'ether1' })).toEqual([
      '/ip/firewall/nat/add',
      '=chain=srcnat',
      '=action=masquerade',
      '=out-interface=ether1',
    ]);
    expect(natRuleList({ chain: 'dstnat' })).toEqual(['/ip/firewall/nat/print', '?chain=dstnat']);
    expect(filterRuleList()).toEqual(['/ip/firewall/filter/print']);
    expect(filterRuleRemove('*3')).toEqual(['/ip/firewall/filter/remove', '=.id=*3']);
  });

  it('builds mangle add with marks', () => {
    expect(
      mangleRuleAdd({ chain: 'prerouting', action: 'mark-packet', newPacketMark: 'vip', passthrough: false }),
    ).toEqual([
      '/ip/firewall/mangle/add',
      '=chain=prerouting',
      '=action=mark-packet',
      '=new-packet-mark=vip',
      '=passthrough=no',
    ]);
  });

  it('builds address-list add / remove', () => {
    expect(addressListAdd({ list: 'blocked', address: '198.51.100.9', timeout: '1d' })).toEqual([
      '/ip/firewall/address-list/add',
      '=list=blocked',
      '=address=198.51.100.9',
      '=timeout=1d',
    ]);
    expect(addressListRemove('*7')).toEqual(['/ip/firewall/address-list/remove', '=.id=*7']);
  });

  it('builds the platform proxy rule with the panel-proxy comment', () => {
    const sentence = downstreamProxyRuleAdd('cam-01', 8101, '192.168.88.10', 80);
    expect(sentence[0]).toBe('/ip/firewall/nat/add');
    expect(sentence).toContain('=chain=dstnat');
    expect(sentence).toContain('=action=dst-nat');
    expect(sentence).toContain('=dst-port=8101');
    expect(sentence).toContain('=to-addresses=192.168.88.10');
    expect(sentence).toContain('=to-ports=80');
    expect(sentence).toContain('=comment=panel-proxy:cam-01');
  });

  it('marks panel-proxy rules as platform source', () => {
    const rows = parseFirewallRules([
      { type: 're', attrs: { '.id': '*A', chain: 'dstnat', action: 'dst-nat', comment: 'panel-proxy:cam-01', disabled: 'no' }, raw: [], tag: undefined },
      { type: 're', attrs: { '.id': '*B', chain: 'forward', action: 'accept', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(rows[0]!.source).toBe('platform');
    expect(rows[1]!.source).toBe('device');
  });

  it('parses mangle and address-list rows', () => {
    const m = parseMangleRules([
      { type: 're', attrs: { '.id': '*M', chain: 'prerouting', action: 'mark-packet', 'new-packet-mark': 'vip', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(m[0]).toMatchObject({ id: '*M', newPacketMark: 'vip', disabled: false });

    const a = parseAddressList([
      { type: 're', attrs: { '.id': '*L', list: 'blocked', address: '198.51.100.9', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(a[0]).toMatchObject({ id: '*L', list: 'blocked', address: '198.51.100.9' });
  });
});

describe('queue builders', () => {
  it('builds simple queue add and parses rows', () => {
    expect(simpleQueueAdd({ name: 'cafe-1', target: '192.168.88.0/24', maxLimit: '50M/50M' })).toEqual([
      '/queue/simple/add',
      '=name=cafe-1',
      '=target=192.168.88.0/24',
      '=max-limit=50M/50M',
    ]);
    const rows = parseSimpleQueues([
      { type: 're', attrs: { '.id': '*2', name: 'cafe-1', target: '192.168.88.0/24', 'max-limit': '50M/50M', disabled: 'false' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(rows[0]).toMatchObject({ name: 'cafe-1', maxLimit: '50M/50M', disabled: false });
  });

  it('builds queue tree add / move and parses rows', () => {
    expect(queueTreeAdd({ name: 'vip-down', parent: 'global', packetMark: 'vip', maxLimit: '20M/20M' })).toEqual([
      '/queue/tree/add',
      '=name=vip-down',
      '=parent=global',
      '=packet-mark=vip',
      '=max-limit=20M/20M',
    ]);
    expect(simpleQueueMove('*2', '*0')).toEqual(['/queue/simple/move', '=.id=*2', '=destination=*0']);
    expect(queueTreeMove('*T1', '*T0')).toEqual(['/queue/tree/move', '=.id=*T1', '=destination=*T0']);
    const rows = parseQueueTree([
      { type: 're', attrs: { '.id': '*T1', name: 'vip-down', parent: 'global', 'packet-mark': 'vip', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(rows[0]).toMatchObject({ name: 'vip-down', parent: 'global', packetMark: 'vip' });
  });
});

describe('system builders', () => {
  it('builds resource/identity/note/backup/export sentences', () => {
    expect(resourcePrint()).toEqual(['/system/resource/print']);
    expect(identityPrint()).toEqual(['/system/identity/print']);
    // identity has NO comment property — UUID stamp goes to /system note
    expect(identitySet('cafe-cairo-01')).toEqual(['/system/identity/set', '=name=cafe-cairo-01']);
    expect(systemNotePrint()).toEqual(['/system/note/print']);
    expect(systemNoteSet('panel-uuid:uuid-123')).toEqual(['/system/note/set', '=note=panel-uuid:uuid-123']);
    expect(backupSave('auto-2026-10-16', 'pw')).toEqual([
      '/system/backup/save',
      '=name=auto-2026-10-16',
      '=password=pw',
    ]);
    expect(configExport()).toEqual(['/export']);
    expect(configExport('cfg')).toEqual(['/export', '=file=cfg']);
    expect(routerboardPrint()).toEqual(['/system/routerboard/print']);
    expect(packageList()).toEqual(['/system/package/print']);
  });

  it('builds scheduler add / disable and script add / run', () => {
    expect(schedulerAdd({ name: 'watchdog', onEvent: ':log info ok', interval: '2m' })).toEqual([
      '/system/scheduler/add',
      '=name=watchdog',
      '=on-event=:log info ok',
      '=interval=2m',
    ]);
    expect(schedulerDisable('*S1')).toEqual(['/system/scheduler/disable', '=.id=*S1']);
    expect(scriptAdd({ name: 's1', source: ':put hi' })).toEqual([
      '/system/script/add',
      '=name=s1',
      '=source=:put hi',
    ]);
    expect(scriptRun('*S2')).toEqual(['/system/script/run', '=.id=*S2']);
  });

  it('parses resource, identity, note, scheduler, script rows', () => {
    const res = parseResource([
      { type: 're', attrs: { 'board-name': 'CHR', version: '7.14.2', uptime: '2d3h' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(res).toMatchObject({ 'board-name': 'CHR', version: '7.14.2' });
    const id = parseIdentity([
      { type: 're', attrs: { name: 'hub' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(id).toEqual({ name: 'hub' });
    const note = parseSystemNote([
      { type: 're', attrs: { note: 'panel-uuid:abc' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(note).toEqual({ note: 'panel-uuid:abc' });
    const sched = parseSchedulers([
      { type: 're', attrs: { '.id': '*S1', name: 'watchdog', interval: '2m', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(sched[0]).toMatchObject({ name: 'watchdog', interval: '2m', disabled: false });
    const scripts = parseScripts([
      { type: 're', attrs: { '.id': '*S2', name: 's1', source: ':put hi' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(scripts[0]).toMatchObject({ name: 's1', source: ':put hi' });
  });

  it('collects /export text from raw !re words', () => {
    const text = exportText([
      { type: 're', attrs: {}, raw: ['!re', '/system identity'], tag: undefined },
      { type: 're', attrs: {}, raw: ['!re', 'set name=mock-router'], tag: undefined },
      { type: 'done', attrs: {}, raw: ['!done'], tag: undefined },
    ]);
    expect(text).toBe('/system identity\nset name=mock-router');
  });
});

describe('ppp builders', () => {
  it('builds the hub-side SSTP secret for a site router', () => {
    expect(
      pppSecretAdd({
        name: 'sstp-a1b2c3',
        password: 'pw',
        service: 'sstp',
        remoteAddress: '10.200.0.7',
        comment: 'panel-router:uuid-123',
      }),
    ).toEqual([
      '/ppp/secret/add',
      '=name=sstp-a1b2c3',
      '=password=pw',
      '=service=sstp',
      '=profile=default',
      '=remote-address=10.200.0.7',
      '=comment=panel-router:uuid-123',
    ]);
  });

  it('builds active list / disconnect and profile add', () => {
    expect(pppActiveList({ service: 'sstp' })).toEqual(['/ppp/active/print', '?service=sstp']);
    expect(pppActiveRemove('*P9')).toEqual(['/ppp/active/remove', '=.id=*P9']);
    expect(pppProfileAdd({ name: 'panel', localAddress: '10.200.0.1' })).toEqual([
      '/ppp/profile/add',
      '=name=panel',
      '=local-address=10.200.0.1',
    ]);
  });

  it('parses secret / active / profile rows', () => {
    const rows = parsePppSecrets([
      { type: 're', attrs: { '.id': '*5', name: 'sstp-a1b2c3', service: 'sstp', 'remote-address': '10.200.0.7' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(rows[0]).toMatchObject({ name: 'sstp-a1b2c3', remoteAddress: '10.200.0.7', disabled: false });

    const active = parsePppActive([
      { type: 're', attrs: { '.id': '*A1', name: 'sstp-a1b2c3', service: 'sstp', address: '10.200.0.7' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(active[0]).toMatchObject({ name: 'sstp-a1b2c3', address: '10.200.0.7' });

    const profiles = parsePppProfiles([
      { type: 're', attrs: { '.id': '*P1', name: 'panel', 'local-address': '10.200.0.1' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(profiles[0]).toMatchObject({ name: 'panel', localAddress: '10.200.0.1' });
  });
});

describe('ip builders', () => {
  it('builds neighbor print and parses rows', () => {
    expect(neighborList()).toEqual(['/ip/neighbor/print']);
    const rows = parseNeighbors([
      { type: 're', attrs: { '.id': '*N1', interface: 'ether1', 'mac-address': 'AA:BB:CC:DD:EE:01', identity: 'ap-1' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(rows[0]).toMatchObject({ interface: 'ether1', macAddress: 'AA:BB:CC:DD:EE:01', identity: 'ap-1' });
  });

  it('builds address add / disable and parses rows', () => {
    expect(ipAddressAdd({ address: '192.168.88.1/24', interface: 'bridge-lan' })).toEqual([
      '/ip/address/add',
      '=address=192.168.88.1/24',
      '=interface=bridge-lan',
    ]);
    const rows = parseIpAddresses([
      { type: 're', attrs: { '.id': '*A1', address: '192.168.88.1/24', interface: 'bridge-lan', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(rows[0]).toMatchObject({ address: '192.168.88.1/24', disabled: false });
  });

  it('builds dhcp-server add / disable, network add, pool add / remove', () => {
    expect(dhcpServerAdd({ name: 'lan', interface: 'bridge-lan', addressPool: 'lan-pool' })).toEqual([
      '/ip/dhcp-server/add',
      '=name=lan',
      '=interface=bridge-lan',
      '=address-pool=lan-pool',
    ]);
    expect(dhcpServerDisable('*D1')).toContain('=.id=*D1');
    expect(dhcpNetworkAdd({ address: '192.168.88.0/24', gateway: '192.168.88.1' })).toEqual([
      '/ip/dhcp-server/network/add',
      '=address=192.168.88.0/24',
      '=gateway=192.168.88.1',
    ]);
    expect(ipPoolAdd({ name: 'lan-pool', ranges: '192.168.88.10-192.168.88.254' })).toEqual([
      '/ip/pool/add',
      '=name=lan-pool',
      '=ranges=192.168.88.10-192.168.88.254',
    ]);
    expect(ipPoolRemove('*P1')).toEqual(['/ip/pool/remove', '=.id=*P1']);
    const srvs = parseDhcpServers([
      { type: 're', attrs: { '.id': '*D1', name: 'lan', interface: 'bridge-lan', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(srvs[0]).toMatchObject({ name: 'lan', disabled: false });
    const nets = parseDhcpNetworks([
      { type: 're', attrs: { '.id': '*N1', address: '192.168.88.0/24', gateway: '192.168.88.1' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(nets[0]).toMatchObject({ address: '192.168.88.0/24', gateway: '192.168.88.1' });
    const pools = parseIpPools([
      { type: 're', attrs: { '.id': '*P1', name: 'lan-pool', ranges: '192.168.88.10-192.168.88.254' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(pools[0]).toMatchObject({ name: 'lan-pool' });
  });
});

describe('interface builders', () => {
  it('builds sstp-client add with ONLY connect-to/user/password (creation quirk)', () => {
    // The live-verified quirk: anything else at creation is rejected by the
    // device, so the builder does not even accept the extra fields.
    expect(sstpClientAdd('hub.example.com', 'sstp-a1b2c3', 'pw')).toEqual([
      '/interface/sstp-client/add',
      '=connect-to=hub.example.com',
      '=user=sstp-a1b2c3',
      '=password=pw',
    ]);
  });

  it('builds sstp-client set / list / remove / disable', () => {
    expect(
      sstpClientSet('*S1', { name: 'sstp-hub', verifyServerCertificate: false, disabled: false }),
    ).toEqual([
      '/interface/sstp-client/set',
      '=.id=*S1',
      '=name=sstp-hub',
      '=verify-server-certificate=no',
      '=disabled=no',
    ]);
    // connect-to carries host:port — there is no separate port parameter
    expect(sstpClientSet('*S1', { connectTo: 'hub.example.com:444' })).toEqual([
      '/interface/sstp-client/set',
      '=.id=*S1',
      '=connect-to=hub.example.com:444',
    ]);
    expect(sstpClientList()).toEqual(['/interface/sstp-client/print']);
    expect(sstpClientRemove('*S1')).toEqual(['/interface/sstp-client/remove', '=.id=*S1']);
    expect(sstpClientDisable('*S1')).toEqual(['/interface/sstp-client/disable', '=.id=*S1']);
  });

  it('builds interface list / disable and parses rows', () => {
    expect(interfaceList()).toEqual(['/interface/print']);
    expect(interfaceDisable('*I1')).toEqual(['/interface/disable', '=.id=*I1']);
    const ifs = parseInterfaces([
      { type: 're', attrs: { '.id': '*I1', name: 'ether1', type: 'ether', running: 'true', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(ifs[0]).toMatchObject({ name: 'ether1', running: true, disabled: false });
    const clients = parseSstpClients([
      { type: 're', attrs: { '.id': '*S1', name: 'sstp-hub', 'connect-to': 'hub.example.com', disabled: 'no' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(clients[0]).toMatchObject({ name: 'sstp-hub', connectTo: 'hub.example.com' });
  });
});

describe('withTag', () => {
  it('appends a =.tag= correlation word', () => {
    expect(withTag(['/ip/hotspot/user/print'], 'op-123')).toEqual([
      '/ip/hotspot/user/print',
      '=.tag=op-123',
    ]);
  });
});

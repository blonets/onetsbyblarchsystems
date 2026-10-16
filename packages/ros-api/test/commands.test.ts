import { describe, expect, it } from 'vitest';
import {
  downstreamProxyRuleAdd,
  filterRuleAdd,
  filterRuleList,
  filterRuleRemove,
  natRuleAdd,
  natRuleList,
  parseFirewallRules,
} from '../src/commands/firewall.js';
import {
  hotspotProfileAdd,
  hotspotServerList,
  hotspotUserAdd,
  hotspotUserDisable,
  hotspotUserList,
  hotspotUserRemove,
  hotspotUserSet,
  parseHotspotProfiles,
  parseHotspotUsers,
  walledGardenAdd,
} from '../src/commands/hotspot.js';
import { pppSecretAdd, parsePppSecrets } from '../src/commands/ppp.js';
import { simpleQueueAdd, parseSimpleQueues } from '../src/commands/queue.js';
import {
  backupSave,
  configExport,
  identityPrint,
  identitySet,
  parseIdentity,
  parseResource,
  resourcePrint,
} from '../src/commands/system.js';

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

  it('builds profile add and walled-garden add', () => {
    expect(hotspotProfileAdd({ name: 'vip', rateLimit: '20M/20M', sharedUsers: 2 })).toEqual([
      '/ip/hotspot/user/profile/add',
      '=name=vip',
      '=rate-limit=20M/20M',
      '=shared-users=2',
    ]);
    expect(walledGardenAdd({ dstHost: 'example.com' })).toEqual([
      '/ip/hotspot/walled-garden/add',
      '=dst-host=example.com',
    ]);
    expect(hotspotServerList()).toEqual(['/ip/hotspot/print']);
  });

  it('parses user rows', () => {
    const rows = parseHotspotUsers([
      { type: 're', attrs: { '.id': '*1', server: 'hs1', name: 'a', profile: 'default', 'bytes-in': '100', disabled: 'false' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(rows[0]).toMatchObject({ id: '*1', name: 'a', bytesIn: 100, disabled: false, dynamic: false });
  });

  it('parses profile rows', () => {
    const rows = parseHotspotProfiles([
      { type: 're', attrs: { '.id': '*9', name: 'vip', 'rate-limit': '20M/20M', 'shared-users': '2' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(rows[0]).toMatchObject({ id: '*9', name: 'vip', rateLimit: '20M/20M', sharedUsers: 2 });
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
});

describe('system builders', () => {
  it('builds resource/identity/backup/export sentences', () => {
    expect(resourcePrint()).toEqual(['/system/resource/print']);
    expect(identityPrint()).toEqual(['/system/identity/print']);
    expect(identitySet('cafe-cairo-01', 'uuid-123')).toEqual([
      '/system/identity/set',
      '=name=cafe-cairo-01',
      '=comment=panel-uuid:uuid-123',
    ]);
    expect(identitySet('x')).toEqual(['/system/identity/set', '=name=x']);
    expect(backupSave('auto-2026-10-16', 'pw')).toEqual([
      '/system/backup/save',
      '=name=auto-2026-10-16',
      '=password=pw',
    ]);
    expect(configExport()).toEqual(['/export']);
    expect(configExport('cfg')).toEqual(['/export', '=file=cfg']);
  });

  it('parses resource and identity rows', () => {
    const res = parseResource([
      { type: 're', attrs: { 'board-name': 'CHR', version: '7.14.2', uptime: '2d3h' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(res).toMatchObject({ 'board-name': 'CHR', version: '7.14.2' });
    const id = parseIdentity([
      { type: 're', attrs: { name: 'hub', comment: 'panel-uuid:abc' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(id).toEqual({ name: 'hub', comment: 'panel-uuid:abc' });
  });
});

describe('ppp secret builders', () => {
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

  it('parses secret rows', () => {
    const rows = parsePppSecrets([
      { type: 're', attrs: { '.id': '*5', name: 'sstp-a1b2c3', service: 'sstp', 'remote-address': '10.200.0.7' }, raw: [], tag: undefined },
      { type: 'done', attrs: {}, raw: [], tag: undefined },
    ]);
    expect(rows[0]).toMatchObject({ name: 'sstp-a1b2c3', remoteAddress: '10.200.0.7', disabled: false });
  });
});

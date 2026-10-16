/**
 * LIVE tests against real RouterOS 6.49.17 CHR hardware.
 *
 * Run:  LIVE_TESTS=1 TEST_CHR_PASS=... HUB_CHR_PASS=... BACKUP_KMS_KEY=... \
 *         pnpm vitest run test/live/live.spec.ts
 *
 * Every test cleans up after itself (test users/rules/files/secrets removed).
 * Credentials come ONLY from env vars — never files, never logs.
 *
 * Covered:
 *  1. login (modern-first) + /system/resource/print on the test CHR
 *  2. full pollRouter cycle (resource + monitor-traffic + hotspot)
 *  3. downtime ledger: client-side drop → open row; re-establish → close row
 *  4. /export fetch
 *  5. quota enforcer: tiny-timeout user evaluated, NOT disabled (no false
 *     positive), then removed
 *  6. commands processor: hotspot user add → remove (typed sentences)
 *  7. safe-apply watchdog: disabled dummy rule applied, reachability verified,
 *     rule reverted — NON-destructive simulation
 *  8. provision: verify-tunnel read path against the hub (test CHR's
 *     sstp-test-01 session) + refusal guard for non-disposable hub names
 */

import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  RosConnection,
  TcpTransport,
  hotspotUserAdd,
  hotspotUserRemove,
  hotspotUserList,
  replyRows,
  parseHotspotUsers,
} from '@mtk/ros-api';
import { ConnectionManager } from '../../src/connection-manager.js';
import { pollRouter } from '../../src/jobs/poller.job.js';
import { RateTracker } from '../../src/metrics.js';
import { createQuotaProcessor } from '../../src/jobs/quota.job.js';
import { createCommandsProcessor } from '../../src/jobs/commands.job.js';
import { safeApplyFirewallChange } from '../../src/jobs/safe-apply.js';
import { createProvisionProcessor } from '../../src/jobs/provision.job.js';
import { filterRuleAdd, filterRuleList, filterRuleRemove } from '@mtk/ros-api';
import { InMemoryAuditSink } from '../../src/audit.js';
import { InMemoryEventBus } from '../../src/queues.js';
import { exportTextFromReplies, exportFileToDevice, removeDeviceFile, InMemoryBackupIndex } from '../../src/jobs/backup.job.js';
import { configExport } from '@mtk/ros-api';
import { InMemoryObjectStore } from '../../src/object-store.js';

const LIVE = process.env.LIVE_TESTS === '1';
const describeLive = LIVE ? describe : describe.skip;

const TEST_HOST = process.env.TEST_CHR_HOST ?? '34.12.242.142';
const TEST_USER = process.env.TEST_CHR_USER ?? 'admin';
const TEST_PASS = process.env.TEST_CHR_PASS ?? '';
const HUB_HOST = process.env.HUB_CHR_HOST ?? '34.91.70.17';
const HUB_USER = process.env.HUB_CHR_USER ?? 'admin';
const HUB_PASS = process.env.HUB_CHR_PASS ?? '';

const rand = (n: number) => randomBytes(n).toString('hex');

function factoryFor(host: string, port: number, user: string, pass: string) {
  return async (routerId: string): Promise<RosConnection> => {
    if (!pass) throw new Error(`no password for ${routerId} — set the *_PASS env var`);
    const conn = new RosConnection(new TcpTransport({ host, port, connectTimeoutMs: 10_000 }));
    await conn.connect();
    await conn.login(user, pass); // auto: modern first, legacy fallback
    return conn;
  };
}

const testFactory = () => factoryFor(TEST_HOST, 8728, TEST_USER, TEST_PASS);
const hubFactory = () => factoryFor(HUB_HOST, 8728, HUB_USER, HUB_PASS);

describeLive('live: test CHR', () => {
  it('logs in (modern-first) and reads /system/resource/print', async () => {
    const manager = new ConnectionManager(testFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const conn = await manager.ensure('test-chr');
    const rows = replyRows(await conn.talk(['/system/resource/print']));
    expect(rows[0]!['version']).toMatch(/6\.49/);
    expect(rows[0]!['board-name']).toBeDefined();
    await manager.dropAll();
  });

  it('runs a full pollRouter cycle', async () => {
    const manager = new ConnectionManager(testFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const batch = await pollRouter(manager, 'test-chr', new RateTracker());
    expect((batch.cpu?.[0]?.cpuPct ?? 0)).toBeGreaterThanOrEqual(0);
    expect((batch.traffic?.length ?? 0)).toBeGreaterThan(0);
    expect((batch.hotspotActive?.[0]?.activeN ?? 0)).toBeGreaterThanOrEqual(0);
    await manager.dropAll();
  });

  it('opens and closes a downtime ledger row on drop/re-establish', async () => {
    let now = Date.parse('2026-10-16T00:00:00.000Z');
    const manager = new ConnectionManager(testFactory(), {
      now: () => now,
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const conn = await manager.ensure('test-chr');
    // drop the session client-side (router untouched)
    await manager.drop('test-chr');
    manager.reportFailure('test-chr', 'live test: client-side drop');
    now += 30_000;
    let entries = manager.getDowntime('test-chr');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.endedAt).toBeUndefined();
    // re-establish → row closes with duration
    await manager.ensure('test-chr');
    entries = manager.getDowntime('test-chr');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.endedAt).toBe(new Date(now).toISOString());
    expect(entries[0]!.durationS).toBe(30);
    await manager.dropAll();
  });

  it('documents the live /export quirk: bare /export returns no text (file route required)', async () => {
    const manager = new ConnectionManager(testFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const replies = await manager.execute('test-chr', (conn) => conn.talk(configExport()));
    // RouterOS 6.49.17 answers a bare /export with a single !done — the config
    // text is NOT streamed. The backup job therefore uses /export file= + FTP.
    expect(replies).toHaveLength(1);
    expect(replies[0]!.type).toBe('done');
    expect(exportTextFromReplies(replies)).toBe('');
    await manager.dropAll();
  });

  it('backup device-side flow: /export file created, polled, removed (live)', async () => {
    const manager = new ConnectionManager(testFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const stamp = `livetest-${rand(4)}`;
    const name = await exportFileToDevice(manager, 'test-chr', stamp, async () => {});
    try {
      const rows = await manager.execute('test-chr', async (conn) =>
        replyRows(await conn.talk(['/file/print', `?name=${name}`])),
      );
      expect(rows.some((r) => r['name'] === name)).toBe(true);
    } finally {
      await removeDeviceFile(manager, 'test-chr', name);
      const left = await manager.execute('test-chr', async (conn) =>
        replyRows(await conn.talk(['/file/print', `?name=${name}`])),
      );
      expect(left).toHaveLength(0); // device left clean
      await manager.dropAll();
    }
  });

  it('backup encrypt→store→index pipeline (hermetic, realistic export bytes)', async () => {
    if (!process.env.BACKUP_KMS_KEY) {
      console.log('  (skipped: BACKUP_KMS_KEY not set)');
      return;
    }
    // NOTE: the FTP data hop cannot be validated from this sandbox — the CHR
    // is reached via its NAT'd public IP and its FTP daemon answers 425 to
    // passive data connections on that path (PASV advertises 10.164.0.5).
    // Production reaches routers over the SSTP tunnel (no NAT), where the
    // same client code applies. The transfer itself is covered by the
    // fake-server unit tests in test/ftp.spec.ts.
    const { encryptBackup, resolveBackupKey, serializeEnvelope } = await import(
      '../../src/crypto.js'
    );
    const plaintext = Buffer.from(
      '# live-shaped export fixture\n/system identity set name=test-chr\n/ip address add address=10.200.0.9/16\n',
      'utf8',
    );
    const envelope = encryptBackup(plaintext, resolveBackupKey());
    const store = new InMemoryObjectStore();
    const index = new InMemoryBackupIndex();
    const key = 'backups/test-chr/live-fixture.enc';
    await store.put(key, Buffer.from(serializeEnvelope(envelope), 'utf8'));
    const { createHash } = await import('node:crypto');
    await index.put({
      id: 'live-fixture', routerId: 'test-chr', type: 'export', fileName: 'live.rsc',
      storageKey: key, sizeBytes: String(plaintext.length),
      sha256: createHash('sha256').update(plaintext).digest('hex'),
      kmsKeyId: 'test-key',
      createdAt: new Date().toISOString(),
      retentionUntil: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const record = await index.get('live-fixture');
    expect(record?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const stored = (await store.get(key)).toString('utf8');
    expect(stored).toContain('aes-256-gcm');
    expect(stored).not.toContain('/system identity');
  });

  it('quota enforcer evaluates a tiny-timeout user without false positives', async () => {
    const manager = new ConnectionManager(testFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const conn = await manager.ensure('test-chr');
    // need a hotspot server to attach the user to; skip if none exists
    const servers = replyRows(await conn.talk(['/ip/hotspot/print']));
    if (servers.length === 0) {
      console.log('  (skipped: no hotspot server on test CHR)');
      await manager.dropAll();
      return;
    }
    const server = servers[0]!['name']!;
    const username = `test-del-quota-${rand(4)}`;
    let userId = '';
    try {
      const addReplies = await conn.talk(
        hotspotUserAdd({ server, name: username, profile: 'default', limitUptime: '10s' }),
      );
      userId = addReplies.find((r) => r.type === 'done')?.attrs['ret'] ?? '';
      const audit = new InMemoryAuditSink();
      const events = new InMemoryEventBus();
      const process = createQuotaProcessor({ manager, audit, events });
      const result = await process({
        data: { kind: 'quota', opId: `live-q-${rand(4)}`, routerId: 'test-chr' },
      } as never);
      // user has no ACTIVE session → no violation, no disable (correct: no false positive)
      expect(result.violations.filter((v) => v.user === username)).toHaveLength(0);
      const users = parseHotspotUsers(await conn.talk(hotspotUserList({ name: username })));
      expect(users[0]!.disabled).toBe(false);
    } finally {
      if (userId) await conn.talk(hotspotUserRemove(userId)).catch(() => undefined);
      else {
        const rows = replyRows(await conn.talk(hotspotUserList({ name: username })));
        const id = rows[0]?.['.id'];
        if (id) await conn.talk(hotspotUserRemove(id)).catch(() => undefined);
      }
      // confirm cleanup
      const left = replyRows(await conn.talk(hotspotUserList({ name: username })));
      expect(left).toHaveLength(0);
      await manager.dropAll();
    }
  });

  it('commands processor adds and removes a hotspot user', async () => {
    const manager = new ConnectionManager(testFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const conn = await manager.ensure('test-chr');
    const servers = replyRows(await conn.talk(['/ip/hotspot/print']));
    if (servers.length === 0) {
      console.log('  (skipped: no hotspot server on test CHR)');
      await manager.dropAll();
      return;
    }
    const server = servers[0]!['name']!;
    const username = `test-del-cmd-${rand(4)}`;
    const process = createCommandsProcessor({ manager, sleep: async () => {} });
    try {
      const added = await process({
        data: {
          kind: 'ros', routerId: 'test-chr', opId: `live-add-${username}`,
          sentences: [hotspotUserAdd({ server, name: username, profile: 'default' })],
        },
      } as never);
      expect(added.rows).toBe(0); // add returns no !re rows
      const rows = replyRows(await conn.talk(hotspotUserList({ name: username })));
      expect(rows).toHaveLength(1);
      const id = rows[0]!['.id']!;
      await process({
        data: {
          kind: 'ros', routerId: 'test-chr', opId: `live-rm-${username}`,
          sentences: [hotspotUserRemove(id)],
        },
      } as never);
      expect(replyRows(await conn.talk(hotspotUserList({ name: username })))).toHaveLength(0);
    } finally {
      const rows = replyRows(await conn.talk(hotspotUserList({ name: username })));
      const id = rows[0]?.['.id'];
      if (id) await conn.talk(hotspotUserRemove(id)).catch(() => undefined);
      await manager.dropAll();
    }
  });

  it('safe-apply watchdog: non-destructive simulation (disabled dummy rule)', async () => {
    const manager = new ConnectionManager(testFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const conn = await manager.ensure('test-chr');
    const comment = `panel-live-test-${rand(4)}`;
    // find the rule's id after adding (add returns =ret=<id> on !done)
    const added = await conn.talk(
      filterRuleAdd({ chain: 'input', action: 'drop', disabled: true, comment }),
    );
    const ruleId = added.find((r) => r.type === 'done')?.attrs['ret'] ?? '';
    expect(ruleId).toBeTruthy();
    const events = new InMemoryEventBus();
    try {
      const result = await safeApplyFirewallChange(
        { manager, events, sleep: async () => {} }, // sleep skips the 60 s wait; reachability is checked for real
        {
          routerId: 'test-chr',
          opId: `live-safe-${rand(4)}`,
          // the change is a no-op set on the already-disabled dummy rule: the
          // check path is exercised without ever touching real traffic
          apply: async (talk) => {
            await talk(['/ip/firewall/filter/set', `=.id=${ruleId}`, '=disabled=yes']);
            return [];
          },
          verifyAfterMs: 0,
        },
      );
      expect(result).toMatchObject({ reverted: false });
      expect(events.ofType('config.changed')).toHaveLength(1);
      expect(events.ofType('alert.raised')).toHaveLength(0);
    } finally {
      // safe-apply's reachability check drops the cached session, so
      // re-establish a fresh one for cleanup
      const fresh = await manager.ensure('test-chr');
      await fresh.talk(filterRuleRemove(ruleId)).catch(() => undefined);
      const left = replyRows(await fresh.talk(filterRuleList())).filter(
        (r) => r['comment'] === comment,
      );
      expect(left).toHaveLength(0); // test CHR left clean
      await manager.dropAll();
    }
  });
});

describeLive('live: hub CHR (read-only + refusal guards)', () => {
  it('verify-tunnel exercises the hub read path for the test CHR', async () => {
    const manager = new ConnectionManager(testFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const hub = new ConnectionManager(hubFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const audit = new InMemoryAuditSink();
    const events = new InMemoryEventBus();
    // the test CHR dials the hub as sstp-test-01
    const process = createProvisionProcessor({
      manager,
      hub,
      hubRouterId: 'hub',
      routerInfo: async () => ({ sstpUsername: 'sstp-test-01', uuid: 'test-chr' }),
      audit,
      events,
    });
    try {
      const result = await process({
        data: {
          kind: 'provision', type: 'verify-tunnel',
          opId: `live-verify-${rand(4)}`, routerId: 'test-chr',
        },
      } as never);
      expect(result.type).toBe('verify-tunnel');
      expect(typeof result.ok).toBe('boolean');
    } finally {
      await manager.dropAll();
      await hub.dropAll();
    }
  });

  it('refuses hub mutations for the live sstp-test-01 secret (no hub touch)', async () => {
    const manager = new ConnectionManager(testFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const hub = new ConnectionManager(hubFactory(), {
      backoff: { maxAttempts: 2, baseMs: 500, jitter: false },
      sleep: async () => {},
    });
    const process = createProvisionProcessor({
      manager,
      hub,
      hubRouterId: 'hub',
      routerInfo: async () => ({ sstpUsername: 'sstp-test-01', uuid: 'test-chr' }),
      secrets: { freshSecrets: async () => ({ sstpPassword: 'x', apiPassword: 'y' }) },
      // allowHubMutations NOT set → the disposable-name guard is active
    });
    try {
      await expect(
        process({
          data: {
            kind: 'provision', type: 'rotate-secrets',
            opId: `live-rot-${rand(4)}`, routerId: 'test-chr',
          },
        } as never),
      ).rejects.toThrow(/non-disposable/);
      // the guard fires before any mutation: the hub secret is untouched
      const hubConn = await hub.ensure('hub');
      const rows = replyRows(
        await hubConn.talk(['/ppp/secret/print', '?name=sstp-test-01']),
      );
      expect(rows).toHaveLength(1);
    } finally {
      await manager.dropAll();
      await hub.dropAll();
    }
  });
});

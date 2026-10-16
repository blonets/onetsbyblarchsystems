import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  encryptBackup,
  decryptBackup,
  parseEnvelope,
  serializeEnvelope,
  resolveBackupKey,
} from '../src/crypto.js';
import { backupCronForRouter, exportTextFromReplies, createBackupJanitorProcessor, InMemoryBackupIndex } from '../src/jobs/backup.job.js';
import { InMemoryObjectStore } from '../src/object-store.js';
import type { ReplySentence } from '@mtk/ros-api';

const KEY = randomBytes(32);

describe('backup crypto (AES-256-GCM)', () => {
  it('round-trips', () => {
    const plaintext = Buffer.from('# panel backup\n/interface print\n', 'utf8');
    const env = encryptBackup(plaintext, KEY);
    expect(env.alg).toBe('aes-256-gcm');
    expect(decryptBackup(parseEnvelope(serializeEnvelope(env)), KEY)).toEqual(plaintext);
  });

  it('rejects tampered ciphertext', () => {
    const env = encryptBackup(Buffer.from('secret'), KEY);
    const raw = Buffer.from(env.ct, 'base64');
    raw[0] ^= 0xff;
    env.ct = raw.toString('base64');
    expect(() => decryptBackup(env, KEY)).toThrow();
  });

  it('rejects the wrong key', () => {
    const env = encryptBackup(Buffer.from('secret'), KEY);
    expect(() => decryptBackup(env, randomBytes(32))).toThrow();
  });

  it('rejects bad envelopes', () => {
    expect(() => parseEnvelope('{}')).toThrow();
    expect(() => parseEnvelope('not json')).toThrow();
  });

  it('refuses to resolve a missing/short key', () => {
    expect(() => resolveBackupKey({} as NodeJS.ProcessEnv)).toThrow(/BACKUP_KMS_KEY/);
    expect(() => resolveBackupKey({ BACKUP_KMS_KEY: 'abcd' })).toThrow();
    expect(resolveBackupKey({ BACKUP_KMS_KEY: 'ab'.repeat(32) }).length).toBe(32);
  });
});

describe('exportTextFromReplies', () => {
  it('reassembles bare-word export lines', () => {
    const replies = [
      { type: 're', attrs: {}, raw: ['!re', '/interface', 'ethernet', 'set', '[find', 'default-name=ether1]'] },
      { type: 're', attrs: {}, raw: ['!re', '/ip', 'address', 'add', 'address=10.0.0.1/24'] },
      { type: 'done', attrs: {}, raw: ['!done'] },
    ] as ReplySentence[];
    const text = exportTextFromReplies(replies);
    expect(text).toContain('/interface ethernet set [find default-name=ether1]');
    expect(text).toContain('/ip address add address=10.0.0.1/24');
  });

  it('falls back to =value= attrs', () => {
    const replies = [
      { type: 're', attrs: { value: '/system identity set name=x' }, raw: ['!re', '=value=/system identity set name=x'] },
      { type: 'done', attrs: {}, raw: ['!done'] },
    ] as ReplySentence[];
    expect(exportTextFromReplies(replies)).toBe('/system identity set name=x');
  });

  it('returns empty for no !re rows', () => {
    expect(exportTextFromReplies([{ type: 'done', attrs: {}, raw: ['!done'] }] as ReplySentence[])).toBe('');
  });
});

describe('backupCronForRouter', () => {
  it('lands inside 02:00–05:00 and is deterministic', () => {
    const cron = backupCronForRouter('some-router-uuid');
    expect(cron).toBe(backupCronForRouter('some-router-uuid'));
    const [minute, hour] = cron.split(' ').map(Number);
    expect(hour).toBeGreaterThanOrEqual(2);
    expect(hour).toBeLessThanOrEqual(4);
    expect(minute).toBeGreaterThanOrEqual(0);
    expect(minute).toBeLessThan(60);
  });
});

describe('backup janitor', () => {
  it('deletes expired backups and their objects', async () => {
    const store = new InMemoryObjectStore();
    const index = new InMemoryBackupIndex();
    await store.put('backups/r1/old.enc', Buffer.from('x'));
    await store.put('backups/r1/fresh.enc', Buffer.from('y'));
    await index.put({
      id: 'old', routerId: 'r1', type: 'export', fileName: 'old.rsc',
      storageKey: 'backups/r1/old.enc', sizeBytes: '1', sha256: 'a',
      kmsKeyId: 'test-key',
      createdAt: '2026-01-01T00:00:00.000Z', retentionUntil: '2026-02-01T00:00:00.000Z',
    });
    await index.put({
      id: 'fresh', routerId: 'r1', type: 'export', fileName: 'fresh.rsc',
      storageKey: 'backups/r1/fresh.enc', sizeBytes: '1', sha256: 'b',
      kmsKeyId: 'test-key',
      createdAt: '2026-10-01T00:00:00.000Z', retentionUntil: '2027-01-01T00:00:00.000Z',
    });
    const janitor = createBackupJanitorProcessor({
      store, index, now: () => Date.parse('2026-10-16T00:00:00.000Z'),
    });
    expect(await janitor({} as never)).toEqual({ deleted: 1 });
    expect(await index.get('old')).toBeUndefined();
    expect(await index.get('fresh')).toBeDefined();
    expect(await store.list('backups/r1/')).toEqual(['backups/r1/fresh.enc']);
  });
});

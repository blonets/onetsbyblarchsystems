import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StaticRouterRegistry, UnknownRouterError, HttpRouterRegistry } from '../src/registry.js';
import { InMemoryObjectStore, FilesystemObjectStore } from '../src/object-store.js';
import { InMemoryDowntimeRepository } from '../src/downtime.js';

describe('StaticRouterRegistry', () => {
  it('resolves endpoints from env-provided passwords', async () => {
    process.env.TEST_REG_PASS = 's3cret';
    const reg = new StaticRouterRegistry([
      { routerId: 'r1', host: '10.200.0.7', apiPort: 8728, username: 'panel-api', passwordEnv: 'TEST_REG_PASS' },
    ]);
    expect(await reg.listRouterIds()).toEqual(['r1']);
    const ep = await reg.getEndpoint('r1');
    expect(ep).toMatchObject({ host: '10.200.0.7', apiPort: 8728, username: 'panel-api', password: 's3cret' });
    delete process.env.TEST_REG_PASS;
  });

  it('refuses to connect without a password and for unknown routers', async () => {
    const reg = new StaticRouterRegistry([
      { routerId: 'r1', host: '10.200.0.7', apiPort: 8728, username: 'u', passwordEnv: 'MISSING_VAR_XYZ' },
    ]);
    await expect(reg.getEndpoint('r1')).rejects.toThrow(/not set/);
    await expect(reg.getEndpoint('nope')).rejects.toBeInstanceOf(UnknownRouterError);
  });
});

describe('HttpRouterRegistry', () => {
  it('fetches router ids and endpoints', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith('/internal/worker/routers')) {
        return { ok: true, status: 200, json: async () => ({ routerIds: ['r1'] }) };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ host: '10.200.0.7', apiPort: 8728, username: 'panel-api', password: 'pw' }),
      };
    }) as unknown as typeof fetch;
    const reg = new HttpRouterRegistry('http://api', 'tok', fetchImpl);
    expect(await reg.listRouterIds()).toEqual(['r1']);
    expect(await reg.getEndpoint('r1')).toMatchObject({ routerId: 'r1', host: '10.200.0.7' });
  });
});

describe('InMemoryObjectStore', () => {
  it('puts, gets, lists, deletes', async () => {
    const store = new InMemoryObjectStore();
    await store.put('a/1', Buffer.from('x'));
    await store.put('a/2', Buffer.from('y'));
    await store.put('b/1', Buffer.from('z'));
    expect((await store.get('a/1')).toString()).toBe('x');
    expect(await store.list('a/')).toEqual(['a/1', 'a/2']);
    await store.delete('a/1');
    expect(await store.list('a/')).toEqual(['a/2']);
    await expect(store.get('a/1')).rejects.toThrow(/not found/);
  });
});

describe('FilesystemObjectStore', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mtk-obj-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips objects on disk', async () => {
    const store = new FilesystemObjectStore(dir);
    await store.put('backups/r1/a.enc', Buffer.from('encrypted'));
    expect((await store.get('backups/r1/a.enc')).toString()).toBe('encrypted');
    expect(await store.list('backups/')).toEqual(['backups/r1/a.enc']);
    await store.delete('backups/r1/a.enc');
    expect(await store.list('backups/')).toEqual([]);
  });

  it('rejects path traversal', async () => {
    const store = new FilesystemObjectStore(dir);
    await expect(store.put('../evil', Buffer.from('x'))).rejects.toThrow(/unsafe/);
  });
});

describe('InMemoryDowntimeRepository', () => {
  it('opens once and closes with duration', async () => {
    const repo = new InMemoryDowntimeRepository();
    await repo.open('r1', '2026-10-16T00:00:00.000Z', 'missed 3 heartbeats');
    await repo.open('r1', '2026-10-16T00:01:00.000Z'); // duplicate open is a no-op
    expect((await repo.list('r1'))).toHaveLength(1);
    const closed = await repo.close('r1', '2026-10-16T00:05:00.000Z');
    expect(closed?.durationS).toBe(300);
    expect(closed?.cause).toBe('missed 3 heartbeats');
    expect(await repo.close('r1', '2026-10-16T00:06:00.000Z')).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { RosConnection } from '../src/connection.js';
import { RosFatalError, RosTrapError } from '../src/errors.js';
import { replyRows } from '../src/protocol.js';
import { FakeTransport, scriptedTransport } from './fake-transport.js';

describe('talk', () => {
  it('collects !re rows until !done', async () => {
    const t = scriptedTransport({
      '/ip/hotspot/user/print': [
        ['!re', '=.id=*1', '=name=alice'],
        ['!re', '=.id=*2', '=name=bob'],
        ['!done'],
      ],
    });
    const conn = new RosConnection(t);
    await conn.connect();
    const rows = replyRows(await conn.talk(['/ip/hotspot/user/print']));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'alice' });
    expect(t.sent).toEqual([['/ip/hotspot/user/print']]);
  });

  it('throws RosTrapError on !trap with the device message', async () => {
    const t = scriptedTransport({ '/bad': [['!trap', '=message=no such command']] });
    const conn = new RosConnection(t);
    await conn.connect();
    const err = await conn.talk(['/bad']).catch((e) => e);
    expect(err).toBeInstanceOf(RosTrapError);
    expect((err as RosTrapError).message).toBe('no such command');
  });

  it('throws RosFatalError on !fatal', async () => {
    const t = scriptedTransport({ '/x': [['!fatal', '=message=session dead']] });
    const conn = new RosConnection(t);
    await conn.connect();
    await expect(conn.talk(['/x'])).rejects.toBeInstanceOf(RosFatalError);
  });
});

describe('withReconnect', () => {
  it('reconnects with backoff and re-runs onReconnect (re-login)', async () => {
    const t = new FakeTransport();
    t.failNextConnects = 2; // first two transport connects fail
    t.respondWith(() => [['!done']]);
    const onReconnect = vi.fn(async () => undefined);

    const conn = new RosConnection(t);
    const result = await conn.withReconnect(
      async (c) => {
        expect(c.connected).toBe(true);
        return 'ok';
      },
      { maxAttempts: 4, baseMs: 1, maxMs: 5, jitter: false, onReconnect },
    );

    expect(result).toBe('ok');
    expect(t.connectAttempts).toBe(3); // 2 failures + 1 success
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    const t = new FakeTransport();
    t.failNextConnects = 99;
    const conn = new RosConnection(t);
    await expect(
      conn.withReconnect(async () => 'never', { maxAttempts: 3, baseMs: 1, jitter: false }),
    ).rejects.toThrow('fake connect failure');
    expect(t.connectAttempts).toBe(3);
  });

  it('does not reconnect when the op succeeds first try', async () => {
    const t = new FakeTransport();
    t.respondWith(() => [['!done']]);
    const conn = new RosConnection(t);
    const out = await conn.withReconnect(async () => 42, { baseMs: 1, jitter: false });
    expect(out).toBe(42);
    expect(t.connectAttempts).toBe(1);
  });
});

describe('onTransportClose', () => {
  it('forwards transport close notifications', async () => {
    const t = new FakeTransport();
    const conn = new RosConnection(t);
    await conn.connect();
    const cb = vi.fn();
    conn.onTransportClose(cb);
    t.simulateClose();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(conn.connected).toBe(false);
  });
});

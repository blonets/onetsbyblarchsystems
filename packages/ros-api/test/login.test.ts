import { describe, expect, it } from 'vitest';
import { RosConnection } from '../src/connection.js';
import { RosLoginError, RosTrapError } from '../src/errors.js';
import { legacyResponse, modernLoginSentence } from '../src/login.js';
import { FakeTransport } from './fake-transport.js';

// Known vector (independent computation):
// password "s3cret-pass", challenge hex 9f8b7a6c5d4e3f2a1b0d
const KNOWN_CHALLENGE = '9f8b7a6c5d4e3f2a1b0d';
const KNOWN_RESPONSE = '003c77bd74de1061b73617ea1eff148c00';

describe('legacyResponse', () => {
  it('matches the known MD5 challenge-response vector', () => {
    expect(legacyResponse('s3cret-pass', KNOWN_CHALLENGE)).toBe(KNOWN_RESPONSE);
  });

  it('is sensitive to password and challenge', () => {
    expect(legacyResponse('other', KNOWN_CHALLENGE)).not.toBe(KNOWN_RESPONSE);
    expect(legacyResponse('s3cret-pass', '00000000000000000000')).not.toBe(KNOWN_RESPONSE);
  });

  it('always starts with the literal "00" prefix', () => {
    expect(legacyResponse('x', 'aabbcc')).toMatch(/^00[0-9a-f]{32}$/);
  });
});

describe('modern login (6.43+/v7)', () => {
  it('sends /login with =name/=password and accepts !done', async () => {
    const t = new FakeTransport().respondWith((sent) => {
      expect(sent).toEqual(modernLoginSentence('admin', 'pw'));
      return [['!done']];
    });
    const conn = new RosConnection(t, { loginMode: 'modern' });
    await conn.connect();
    await conn.login('admin', 'pw');
    expect(t.sent).toHaveLength(1);
  });

  it('surfaces wrong-password traps', async () => {
    const t = new FakeTransport().respondWith(() => [['!trap', '=message=cannot log in'], ['!done']]);
    const conn = new RosConnection(t, { loginMode: 'modern' });
    await conn.connect();
    await expect(conn.login('admin', 'bad')).rejects.toBeInstanceOf(RosTrapError);
  });
});

describe('legacy login (pre-6.43)', () => {
  it('answers the challenge with the correct response sentence', async () => {
    const t = new FakeTransport();
    t.respondWith((sent) => {
      if (sent.length === 1 && sent[0] === '/login') {
        return [['!done', `=ret=${KNOWN_CHALLENGE}`]];
      }
      expect(sent).toEqual(['/login', '=name=admin', `=response=${KNOWN_RESPONSE}`]);
      return [['!done']];
    });
    const conn = new RosConnection(t, { loginMode: 'legacy' });
    await conn.connect();
    await conn.login('admin', 's3cret-pass');
    expect(t.sent).toHaveLength(2);
  });

  it('throws RosLoginError when the device returns no challenge', async () => {
    const t = new FakeTransport().respondWith(() => [['!done']]);
    const conn = new RosConnection(t, { loginMode: 'legacy' });
    await conn.connect();
    await expect(conn.login('admin', 'pw')).rejects.toBeInstanceOf(RosLoginError);
  });
});

describe('auto login fallback', () => {
  it('falls back to legacy when modern login traps', async () => {
    const t = new FakeTransport();
    t.respondWith((sent) => {
      const hasPassword = sent.some((w) => w.startsWith('=password='));
      if (hasPassword) return [['!trap', '=message=old style login not supported'], ['!done']];
      if (sent.length === 1) return [['!done', `=ret=${KNOWN_CHALLENGE}`]];
      expect(sent).toEqual(['/login', '=name=admin', `=response=${KNOWN_RESPONSE}`]);
      return [['!done']];
    });
    const conn = new RosConnection(t); // auto
    await conn.connect();
    await conn.login('admin', 's3cret-pass');
    expect(t.sent).toHaveLength(3);
    expect(t.sent[0]![0]).toBe('/login');
  });

  it('does NOT fall back on non-trap errors', async () => {
    const t = new FakeTransport();
    t.respondWith(() => {
      throw new Error('boom');
    });
    const conn = new RosConnection(t);
    await conn.connect();
    await expect(conn.login('admin', 'pw')).rejects.toThrow('boom');
    expect(t.sent).toHaveLength(1); // no legacy retry
  });

  it('throws a combined RosLoginError when both flows fail', async () => {
    const t = new FakeTransport();
    t.respondWith((sent) => {
      const hasPassword = sent.some((w) => w.startsWith('=password='));
      if (hasPassword) return [['!trap', '=message=invalid user name or password'], ['!done']];
      // legacy challenge also traps (e.g. device refuses the challenge flow)
      return [['!trap', '=message=login not allowed'], ['!done']];
    });
    const conn = new RosConnection(t); // auto
    await conn.connect();
    const err = await conn.login('admin', 'wrong').catch((e) => e);
    expect(err).toBeInstanceOf(RosLoginError);
    expect(err.message).toContain('modern flow');
    expect(err.message).toContain('legacy flow');
  });
});

/**
 * REGRESSION (live-verified 2026-10-16 on RouterOS 6.49.17 CHR):
 * a bare `/login` sentence as the FIRST sentence FAILS on RouterOS 6.43+.
 * The client must always lead with `/login =name= =password=` and only use
 * the bare form when falling back to the pre-6.43 challenge flow.
 */
describe('regression: bare /login is never sent first', () => {
  it('auto mode: first sentence is the modern login sentence', async () => {
    const t = new FakeTransport().respondWith(() => [['!done']]);
    const conn = new RosConnection(t); // auto
    await conn.connect();
    await conn.login('admin', 'pw');
    expect(t.sent[0]).toEqual(modernLoginSentence('admin', 'pw'));
    expect(t.sent[0]).not.toEqual(['/login']);
  });

  it('modern mode: first sentence is the modern login sentence', async () => {
    const t = new FakeTransport().respondWith(() => [['!done']]);
    const conn = new RosConnection(t, { loginMode: 'modern' });
    await conn.connect();
    await conn.login('admin', 'pw');
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toEqual(modernLoginSentence('admin', 'pw'));
  });

  it('bare /login appears only as the legacy-fallback challenge request', async () => {
    const t = new FakeTransport();
    t.respondWith((sent) => {
      const hasPassword = sent.some((w) => w.startsWith('=password='));
      if (hasPassword) return [['!trap', '=message=old style login not supported'], ['!done']];
      if (sent.length === 1) return [['!done', `=ret=${KNOWN_CHALLENGE}`]];
      return [['!done']];
    });
    const conn = new RosConnection(t); // auto
    await conn.connect();
    await conn.login('admin', 's3cret-pass');
    const bareLogins = t.sent.filter((s) => s.length === 1 && s[0] === '/login');
    expect(bareLogins).toHaveLength(1);
    expect(t.sent.indexOf(bareLogins[0]!)).toBe(1); // second sentence, never first
  });
});

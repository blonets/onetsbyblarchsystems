/**
 * ros-api.conformance.test.mts
 *
 * Conformance suite: runs the SAME protocol round-trips as the mock's
 * self-test, but through this package's own TypeScript client.
 *
 * The mock RouterOS API server (./mock/server.mjs) is started from this test
 * via child_process on 127.0.0.1 (ephemeral port). Nothing here touches real
 * hardware. A green suite proves the client speaks the RouterOS API binary
 * protocol correctly against the mock; live CHR devices still need their own
 * verification pass (docs/LIVE-VERIFICATION.md).
 *
 * Path resolution: $ROS_API_SRC env var, else ../src/index.ts (this package).
 *
 * Run:  pnpm --filter @mtk/ros-api test
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const TEST_USER = 'conf-admin';
const TEST_PASS = 'c0nf-pw';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_MJS = path.resolve(HERE, './mock/server.mjs');

/* ---------------- module resolution ---------------- */

function resolveRosApiSrc(): string {
  const cands: string[] = [];
  if (process.env.ROS_API_SRC) cands.push(process.env.ROS_API_SRC);
  // This package's own entry (test/ -> src/).
  cands.push(fileURLToPath(new URL('../src/index.ts', import.meta.url)));
  for (const c of cands) if (existsSync(c)) return c;
  throw new Error(
    `[conformance] ros-api entry not found. Tried:\n  - ${cands.join('\n  - ')}\n` +
    `Set ROS_API_SRC to the package entry (src/index.ts or built dist/index.js).`
  );
}

/* ---------------- client-shape adapter ---------------- */

type Row = Record<string, string>;
interface TalkResult { type: string; words: string[]; rows: Row[]; trap?: string }

const wordsToObj = (words: string[]): Row =>
  Object.fromEntries(
    words.filter(w => w.startsWith('=')).map(w => {
      const i = w.indexOf('=', 1);
      return [w.slice(1, i), w.slice(i + 1)];
    })
  );

function normalizeReply(reply: any, words: string[]): Row {
  if (reply && typeof reply === 'object' && !Array.isArray(reply)) return reply as Row;
  if (Array.isArray(reply)) return wordsToObj(reply as string[]);
  return {};
}

async function sendWords(client: any, words: string[]): Promise<TalkResult> {
  const fn: any =
    client.talk ?? client.send ?? client.exec ?? client.command ?? client.talkSentence;
  if (typeof fn !== 'function')
    throw new Error('client exposes no sentence method (looked for talk/send/exec/command)');
  try {
    const r = await fn.call(client, words);
    if (Array.isArray(r)) {
      // Supports both ReplySentence[] ({type, attrs, raw}) and string[][] shapes.
      const rows: Row[] = [];
      let type = '!done';
      let doneWords: string[] = [];
      for (const s of r as any[]) {
        if (Array.isArray(s)) { rows.push(wordsToObj(s)); continue; }
        if (s && typeof s === 'object') {
          if (s.type === 're') { rows.push(normalizeReply(s.attrs ?? s, [])); continue; }
          if (typeof s.type === 'string') {
            type = '!' + s.type;
            if (Array.isArray(s.raw)) doneWords = s.raw;
            continue;
          }
          rows.push(normalizeReply(s, []));
        }
      }
      return { type, words: doneWords, rows };
    }
    const replies = r?.replies ?? r?.rows ?? [];
    const rows: Row[] = (Array.isArray(replies) ? replies : []).map((x: any) =>
      normalizeReply(x, Array.isArray(x) ? x : []));
    const doneWords: string[] = Array.isArray(r?.words) ? r.words : [];
    const type: string = r?.type ?? '!done';
    const trap = type === '!trap' ? (wordsToObj(doneWords).message || 'trap') : undefined;
    return { type, words: doneWords, rows, trap };
  } catch (e: any) {
    return { type: '!trap', words: [], rows: [], trap: String(e?.message ?? e) };
  }
}

async function doLogin(client: any, user: string, pass: string, legacy: boolean) {
  const name = legacy
    ? ['loginLegacy', 'legacyLogin', 'loginOld', 'loginPre643'].find(m => typeof client[m] === 'function')
    : ['login', 'loginModern', 'login643'].find(m => typeof client[m] === 'function');
  if (!name) throw new Error(`client has no ${legacy ? 'legacy ' : ''}login method`);
  try { await client[name](user, pass); }
  catch { await client[name]({ username: user, password: pass }); }
}

function constructClient(mod: any, host: string, port: number, legacy = false): any {
  const Ctor = mod.RosApiClient ?? mod.RouterOSClient ?? mod.Client ?? mod.ApiClient ?? mod.default;
  if (typeof Ctor === 'function') {
    try { return new Ctor({ host, port }); } catch { return new Ctor(host, port); }
  }
  // packages/ros-api: RosConnection over an injectable TcpTransport.
  if (typeof mod.RosConnection === 'function' && typeof mod.TcpTransport === 'function') {
    return new mod.RosConnection(new mod.TcpTransport({ host, port }),
      { loginMode: legacy ? 'legacy' : 'auto' });
  }
  const fac = mod.createClient ?? mod.createRosApiClient ?? mod.createRouterOSClient;
  if (typeof fac === 'function') return fac({ host, port });
  throw new Error(
    'ros-api module exposes no client (looked for RosApiClient/RouterOSClient/Client/ApiClient/RosConnection exports, ' +
    'a default export, or a createClient factory). Exports found: ' + Object.keys(mod).join(', ')
  );
}

async function closeClient(c: any) {
  for (const m of ['close', 'disconnect', 'destroy', 'end'])
    if (typeof c?.[m] === 'function') { await c[m](); return; }
}

/* ---------------- suite ---------------- */

let server: ChildProcess;
let port = 0;
let rosApi: any;

function spawnMock(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [SERVER_MJS, '--port', '0', '--login', 'both',
      '--user', TEST_USER, '--password', TEST_PASS], { stdio: ['ignore', 'pipe', 'inherit'] });
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

async function newLoggedInClient(legacy: boolean): Promise<any> {
  const c = await constructClient(rosApi, '127.0.0.1', port, legacy);
  if (typeof c?.connect === 'function') await c.connect();
  await doLogin(c, TEST_USER, TEST_PASS, legacy);
  return c;
}

beforeAll(async () => {
  expect(existsSync(SERVER_MJS), `mock server missing: ${SERVER_MJS}`).toBe(true);
  port = await spawnMock();
  const src = resolveRosApiSrc();
  rosApi = await import(pathToFileURL(src).href);
}, 30000);

afterAll(async () => {
  server?.kill();
});

describe('ros-api module', () => {
  it('resolves and exposes a client', () => {
    expect(rosApi).toBeTruthy();
    expect(() => constructClient(rosApi, '127.0.0.1', port)).not.toThrow();
  });
});

describe('modern login (6.43+/v7)', () => {
  it('logs in with =name=/=password=', async () => {
    const c = await newLoggedInClient(false);
    const r = await sendWords(c, ['/system/resource/print']);
    expect(r.type).toBe('!done');
    const row = r.rows[0] ?? {};
    expect(row['board-name']).toBe('CHR');
    expect(row['version']).toBeTruthy();
    expect(row['cpu-load']).toBeTruthy();
    expect(row['free-memory']).toBeTruthy();
    expect(row['uptime']).toBeTruthy();
    await closeClient(c);
  });

  it('rejects a bad password', async () => {
    const c = await constructClient(rosApi, '127.0.0.1', port);
    if (typeof c?.connect === 'function') await c.connect();
    await expect(doLogin(c, TEST_USER, 'wrong-pw', false)).rejects.toThrow();
    await closeClient(c);
  });
});

describe('legacy login (pre-6.43 challenge-response)', () => {
  it('completes the MD5 challenge handshake', async () => {
    const c = await newLoggedInClient(true);
    const r = await sendWords(c, ['/system/identity/print']);
    expect(r.type).toBe('!done');
    expect(r.rows[0]?.name).toBeTruthy();
    await closeClient(c);
  });
});

describe('hotspot user lifecycle', () => {
  it('add -> print -> set -> print -> remove -> print', async () => {
    const c = await newLoggedInClient(false);
    const add = await sendWords(c, ['/ip/hotspot/user/add', '=name=conf-user', '=password=pw', '=profile=default', '=limit-uptime=1h']);
    expect(add.type).toBe('!done');
    const id = wordsToObj(add.words).ret;
    expect(id).toMatch(/^\*[0-9A-F]+$/);

    const p1 = await sendWords(c, ['/ip/hotspot/user/print', '?name=conf-user']);
    expect(p1.rows).toHaveLength(1);
    expect(p1.rows[0]['limit-uptime']).toBe('1h');

    const set = await sendWords(c, ['/ip/hotspot/user/set', `=numbers=${id}`, '=limit-uptime=2h']);
    expect(set.type).toBe('!done');
    const p2 = await sendWords(c, ['/ip/hotspot/user/print', '?name=conf-user']);
    expect(p2.rows[0]['limit-uptime']).toBe('2h');

    const rm = await sendWords(c, ['/ip/hotspot/user/remove', `=numbers=${id}`]);
    expect(rm.type).toBe('!done');
    const p3 = await sendWords(c, ['/ip/hotspot/user/print', '?name=conf-user']);
    expect(p3.rows).toHaveLength(0);
    await closeClient(c);
  });
});

describe('firewall filter lifecycle', () => {
  it('add -> print -> remove', async () => {
    const c = await newLoggedInClient(false);
    const add = await sendWords(c, ['/ip/firewall/filter/add', '=chain=input', '=protocol=tcp', '=dst-port=443', '=action=accept', '=comment=conf-fw']);
    expect(add.type).toBe('!done');
    const id = wordsToObj(add.words).ret;
    expect(id).toBeTruthy();

    const p1 = await sendWords(c, ['/ip/firewall/filter/print', '?comment=conf-fw']);
    expect(p1.rows).toHaveLength(1);
    expect(p1.rows[0]['dst-port']).toBe('443');

    const rm = await sendWords(c, ['/ip/firewall/filter/remove', `=numbers=${id}`]);
    expect(rm.type).toBe('!done');
    const p2 = await sendWords(c, ['/ip/firewall/filter/print', '?comment=conf-fw']);
    expect(p2.rows).toHaveLength(0);
    await closeClient(c);
  });
});

describe('protocol edge cases', () => {
  it('unknown command surfaces a trap', async () => {
    const c = await newLoggedInClient(false);
    const r = await sendWords(c, ['/no/such/command']);
    expect(r.type).toBe('!trap');
    await closeClient(c);
  });

  it('queue/simple/print returns rows', async () => {
    const c = await newLoggedInClient(false);
    const r = await sendWords(c, ['/queue/simple/print']);
    expect(r.type).toBe('!done');
    expect(r.rows.length).toBeGreaterThan(0);
    await closeClient(c);
  });
});

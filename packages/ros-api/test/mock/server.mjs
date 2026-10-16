#!/usr/bin/env node
/**
 * mock-routeros/server.mjs
 *
 * A faithful LOCAL mock of the RouterOS API binary word protocol (TCP 8728 style).
 * Listens on 127.0.0.1 only. Implements:
 *   - Word length encoding (1-4 byte encode; 1-5 byte decode per Manual:API)
 *   - Sentences = words terminated by a zero-length word
 *   - Reply sentences: !done / !trap / !re / !fatal, with =.tag= echo
 *   - BOTH login handshakes:
 *       (i)  pre-6.43 : /login -> !done =ret=<32-hex challenge>
 *                        /login =name= =response=00<md5hex(0x00 + password + challengeBytes)>
 *       (ii) 6.43+/v7 : /login =name= =password= -> !done
 *   - Emulated commands (in-memory):
 *       /system/resource/print, /system/identity/print,
 *       /ip/hotspot/user/print|add|remove|set,
 *       /ip/firewall/filter/print|add|remove,
 *       /queue/simple/print
 *   - Unknown commands -> !trap =message=unknown command
 *
 * Usage:
 *   node server.mjs [--host 127.0.0.1] [--port 8728] [--login legacy|modern|both]
 *                   [--user admin] [--password secret] [--ros-version "7.15.3 (stable)"]
 *                   [--board "CHR"]
 *
 * Prints "READY port=<n> login=<style> user=<u>" on stdout once listening.
 * NEVER point real credentials at this; it exists so the protocol can be
 * validated on localhost (raw TCP to real devices is blocked in this sandbox).
 */

import net from 'node:net';
import crypto from 'node:crypto';

function parseArgs(argv) {
  const o = {
    host: '127.0.0.1',
    port: 8728,
    login: 'both',          // legacy | modern | both
    user: 'admin',
    password: 'secret',
    rosVersion: '7.15.3 (stable)',
    board: 'CHR',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') o.host = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--login') o.login = argv[++i];
    else if (a === '--user') o.user = argv[++i];
    else if (a === '--password') o.password = argv[++i];
    else if (a === '--ros-version') o.rosVersion = argv[++i];
    else if (a === '--board') o.board = argv[++i];
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  if (!['legacy', 'modern', 'both'].includes(o.login)) {
    console.error('--login must be legacy|modern|both'); process.exit(2);
  }
  return o;
}
const USAGE = 'node server.mjs [--host 127.0.0.1] [--port 8728] [--login legacy|modern|both] [--user admin] [--password secret] [--ros-version "7.15.3 (stable)"] [--board CHR]';
const OPTS = parseArgs(process.argv.slice(2));

/* ---------------- word codec ---------------- */

function encodeWord(str) {
  const data = Buffer.from(str, 'utf8');
  const len = data.length;
  let head;
  if (len < 0x80) head = Buffer.from([len]);
  else if (len < 0x4000) head = Buffer.from([0x80 | (len >> 8), len & 0xff]);
  else if (len < 0x200000) head = Buffer.from([0xc0 | (len >> 16), (len >> 8) & 0xff, len & 0xff]);
  else if (len < 0x10000000) head = Buffer.from([0xe0 | (len >>> 24), (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff]);
  else throw new Error('word too long to encode');
  return Buffer.concat([head, data]);
}

function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0x00])]);
}

/** Incremental decoder: feed TCP chunks, get complete sentences (arrays of words). */
class SentenceDecoder {
  constructor() { this.buf = Buffer.alloc(0); this.words = []; }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const sentences = [];
    for (;;) {
      const w = this.#tryReadWord();
      if (w === null) break;              // need more data; partial word stays in buf
      if (w === 'PROTOCOL_ERROR') throw new Error('protocol error: bad length prefix');
      if (w.length === 0) { sentences.push(this.words); this.words = []; }
      else this.words.push(w);            // complete words of an in-progress sentence persist across pushes
    }
    return sentences;
  }
  #tryReadWord() {
    const buf = this.buf;
    if (buf.length < 1) return null;
    const b = buf[0];
    let hlen, len;
    if (b < 0x80) { hlen = 1; len = b; }
    else if (b < 0xc0) { hlen = 2; len = ((b & 0x3f) << 8); }
    else if (b < 0xe0) { hlen = 3; len = ((b & 0x1f) << 16); }
    else if (b < 0xf0) { hlen = 4; len = ((b & 0x0f) * 0x1000000); }
    else if (b < 0xf8) { hlen = 5; len = 0; }
    else return 'PROTOCOL_ERROR';
    if (buf.length < hlen) return null;
    for (let i = 1; i < hlen; i++) len += buf[i] * Math.pow(256, hlen - 1 - i);
    if (buf.length < hlen + len) return null;
    const word = buf.slice(hlen, hlen + len).toString('utf8');
    this.buf = buf.slice(hlen + len);
    return word;
  }
}
/* ---------------- in-memory device state ---------------- */

function nextIdFactory() {
  let n = 0;
  return () => '*' + (++n).toString(16).toUpperCase();
}
const nextId = nextIdFactory();

const state = {
  hotspotUsers: [],   // {'.id', server, name, password, profile, limit-uptime, limit-bytes-total, disabled, comment}
  firewallFilter: [], // {'.id', chain, action, protocol, dst-port, src-address, dst-address, comment, disabled}
  queues: [
    { '.id': '*Q1', name: 'default', target: '10.0.0.0/24', 'max-limit': '10M/10M', disabled: 'no' },
  ],
};

/* ---------------- sentence helpers ---------------- */

function splitArgs(words) {
  const args = {}, query = {};
  let tag = null;
  for (const w of words.slice(1)) {
    if (w.startsWith('=.tag=')) tag = w.slice(6);
    else if (w.startsWith('=')) {
      const i = w.indexOf('=', 1);
      args[w.slice(1, i)] = w.slice(i + 1);
    } else if (w.startsWith('?')) {
      const i = w.indexOf('=', 1);
      query[w.slice(1, i)] = w.slice(i + 1);
    }
  }
  return { args, query, tag };
}

function applyQuery(rows, query) {
  const keys = Object.keys(query);
  if (!keys.length) return rows;
  return rows.filter(r => keys.every(k => String(r[k] ?? '') === query[k]));
}

function rowToWords(row) {
  return Object.entries(row).map(([k, v]) => `=${k}=${v}`);
}

/* ---------------- connection handling ---------------- */

function handleConnection(sock) {
  const decoder = new SentenceDecoder();
  let loggedIn = false;
  let challenge = null; // Buffer(16) for legacy login, per connection

  const send = (words) => sock.write(encodeSentence(words));
  const tagW = (tag) => (tag != null ? [`=.tag=${tag}`] : []);
  const done = (tag, extra = []) => send(['!done', ...tagW(tag), ...extra]);
  const trap = (tag, message) => send(['!trap', ...tagW(tag), `=message=${message}`]);
  const fatal = (message) => send(['!fatal', `=message=${message}`]);

  function doLogin(words, tag) {
    const { args } = splitArgs(words);
    const hasCreds = args.name !== undefined && args.password !== undefined;
    const hasResponse = args.name !== undefined && args.response !== undefined;

    if (hasCreds) {
      if (OPTS.login === 'legacy') return trap(tag, 'challenge-response login required');
      if (args.name === OPTS.user && args.password === OPTS.password) {
        loggedIn = true; return done(tag);
      }
      return trap(tag, 'invalid user name or password');
    }
    if (hasResponse) {
      if (OPTS.login === 'modern') return trap(tag, 'plain password login required');
      if (!challenge) return trap(tag, 'no challenge issued');
      if (args.name !== OPTS.user) return trap(tag, 'invalid user name or password');
      const chalBytes = challenge;
      const expect = '00' + crypto.createHash('md5')
        .update(Buffer.concat([Buffer.from([0x00]), Buffer.from(OPTS.password, 'utf8'), chalBytes]))
        .digest('hex');
      challenge = null;
      if (String(args.response).toLowerCase() === expect) {
        loggedIn = true; return done(tag);
      }
      return trap(tag, 'invalid user name or password');
    }
    // bare /login -> issue challenge (legacy) or reject (modern-only)
    if (OPTS.login === 'modern') return trap(tag, 'send =name= and =password= with /login');
    challenge = crypto.randomBytes(16);
    return done(tag, [`=ret=${challenge.toString('hex')}`]);
  }

  function findRows(table, idWord) {
    const ids = String(idWord).split(',').map(s => s.trim()).filter(Boolean);
    return table.filter(r => ids.includes(r['.id']));
  }

  function doCommand(words, tag) {
    const [cmd, ...rest] = words;
    const { args, query } = splitArgs(words);

    switch (cmd) {
      case '/system/resource/print': {
        const row = {
          '.id': '*1',
          'board-name': OPTS.board,
          'version': OPTS.rosVersion,
          'cpu-load': '4',
          'free-memory': '812032',
          'total-memory': '1048576',
          'cpu': 'QEMU Virtual CPU version 2.5+',
          'cpu-count': '2',
          'cpu-frequency': '2300',
          'architecture-name': 'x86_64',
          'platform': 'MikroTik',
          'uptime': '2d4h11m22s',
          'free-hdd-space': '601088',
          'total-hdd-space': '6291456',
        };
        send(['!re', ...tagW(tag), ...rowToWords(row)]);
        return done(tag);
      }
      case '/system/identity/print': {
        send(['!re', ...tagW(tag), '=name=mock-router']);
        return done(tag);
      }
      case '/queue/simple/print': {
        for (const q of applyQuery(state.queues, query))
          send(['!re', ...tagW(tag), ...rowToWords(q)]);
        return done(tag);
      }
      case '/ip/hotspot/user/print': {
        for (const u of applyQuery(state.hotspotUsers, query))
          send(['!re', ...tagW(tag), ...rowToWords(u)]);
        return done(tag);
      }
      case '/ip/hotspot/user/add': {
        const row = {
          '.id': nextId(),
          'server': args.server ?? 'all',
          'name': args.name ?? '',
          'password': args.password ?? '',
          'profile': args.profile ?? 'default',
          'limit-uptime': args['limit-uptime'] ?? '0',
          'limit-bytes-total': args['limit-bytes-total'] ?? '0',
          'disabled': args.disabled ?? 'no',
          'comment': args.comment ?? '',
        };
        state.hotspotUsers.push(row);
        return done(tag, [`=ret=${row['.id']}`]);
      }
      case '/ip/hotspot/user/set': {
        const idw = args.numbers ?? args['.id'];
        if (!idw) return trap(tag, 'no numbers specified');
        const rows = findRows(state.hotspotUsers, idw);
        if (!rows.length) return trap(tag, 'no such item');
        for (const r of rows)
          for (const [k, v] of Object.entries(args))
            if (k !== 'numbers' && k !== '.id') r[k] = v;
        return done(tag);
      }
      case '/ip/hotspot/user/remove': {
        const idw = args.numbers ?? args['.id'];
        if (!idw) return trap(tag, 'no numbers specified');
        const ids = String(idw).split(',').map(s => s.trim());
        const before = state.hotspotUsers.length;
        state.hotspotUsers = state.hotspotUsers.filter(r => !ids.includes(r['.id']));
        if (state.hotspotUsers.length === before) return trap(tag, 'no such item');
        return done(tag);
      }
      case '/ip/firewall/filter/print': {
        for (const r of applyQuery(state.firewallFilter, query))
          send(['!re', ...tagW(tag), ...rowToWords(r)]);
        return done(tag);
      }
      case '/ip/firewall/filter/add': {
        const row = {
          '.id': nextId(),
          'chain': args.chain ?? 'forward',
          'action': args.action ?? 'accept',
          'protocol': args.protocol ?? '',
          'dst-port': args['dst-port'] ?? '',
          'src-address': args['src-address'] ?? '',
          'dst-address': args['dst-address'] ?? '',
          'comment': args.comment ?? '',
          'disabled': args.disabled ?? 'no',
        };
        state.firewallFilter.push(row);
        return done(tag, [`=ret=${row['.id']}`]);
      }
      case '/ip/firewall/filter/remove': {
        const idw = args.numbers ?? args['.id'];
        if (!idw) return trap(tag, 'no numbers specified');
        const ids = String(idw).split(',').map(s => s.trim());
        const before = state.firewallFilter.length;
        state.firewallFilter = state.firewallFilter.filter(r => !ids.includes(r['.id']));
        if (state.firewallFilter.length === before) return trap(tag, 'no such item');
        return done(tag);
      }
      default:
        return trap(tag, 'unknown command');
    }
  }

  sock.on('data', (chunk) => {
    let sentences;
    try {
      sentences = decoder.push(chunk);
    } catch (e) {
      fatal('protocol error'); sock.end(); return;
    }
    for (const words of sentences) {
      if (!words.length) continue;
      const [first] = words;
      const { tag } = splitArgs(words);
      try {
        if (first === '/login') doLogin(words, tag);
        else if (!loggedIn) trap(tag, 'not logged in');
        else doCommand(words, tag);
      } catch (e) {
        trap(tag, 'internal error');
      }
    }
  });
  sock.on('error', () => {});
}

/* ---------------- main ---------------- */

const server = net.createServer(handleConnection);
server.on('error', (e) => { console.error('listen error: ' + e.message); process.exit(1); });
server.listen(OPTS.port, OPTS.host, () => {
  const a = server.address();
  console.log(`READY port=${a.port} login=${OPTS.login} user=${OPTS.user}`);
});

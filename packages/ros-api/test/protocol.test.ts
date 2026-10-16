import { describe, expect, it } from 'vitest';
import {
  ByteReader,
  decodeLength,
  encodeLength,
  encodeSentence,
  parseReply,
  readSentence,
  replyRows,
} from '../src/protocol.js';

function readerOver(bytes: Uint8Array): ByteReader {
  let i = 0;
  return {
    readByte: async () => (i < bytes.length ? bytes[i++]! : -1),
  };
}

describe('encodeLength / decodeLength', () => {
  const cases: Array<[number, number[]]> = [
    [0, [0x00]],
    [1, [0x01]],
    [0x7f, [0x7f]], // 1-byte max
    [0x80, [0x80, 0x80]], // 2-byte min
    [0x3fff, [0xbf, 0xff]], // 2-byte max
    [0x4000, [0xc0, 0x40, 0x00]], // 3-byte min
    [0x1fffff, [0xdf, 0xff, 0xff]], // 3-byte max
    [0x200000, [0xe0, 0x20, 0x00, 0x00]], // 4-byte min
    [0xfffffff, [0xef, 0xff, 0xff, 0xff]], // 4-byte max
  ];
  for (const [length, expected] of cases) {
    it(`encodes ${length} as [${expected.map((b) => '0x' + b.toString(16)).join(', ')}]`, () => {
      expect(Array.from(encodeLength(length))).toEqual(expected);
      const decoded = decodeLength(Uint8Array.from(expected), 0);
      expect(decoded).toEqual({ length, size: expected.length });
    });
  }

  it('round-trips through decode at a non-zero offset', () => {
    const buf = Uint8Array.from([0xaa, 0xbb, 0x82, 0x34, 0xcc]);
    expect(decodeLength(buf, 2)).toEqual({ length: 0x234, size: 2 });
  });

  it('decodes the 5-byte 0xF0 form', () => {
    const buf = Uint8Array.from([0xf0, 0x10, 0x00, 0x00, 0x00]);
    expect(decodeLength(buf, 0)).toEqual({ length: 0x10000000, size: 5 });
  });

  it('rejects words that need 5 bytes on encode', () => {
    expect(() => encodeLength(0x10000000)).toThrow(RangeError);
  });

  it('rejects invalid prefix bytes', () => {
    expect(() => decodeLength(Uint8Array.from([0xf1]), 0)).toThrow();
  });
});

describe('encodeSentence / readSentence', () => {
  it('frames words and terminates with a zero word', () => {
    const bytes = encodeSentence(['/login', '=name=admin']);
    // /login (6 chars) -> 0x06 prefix; =name=admin (11) -> 0x0b prefix; then 0x00
    expect(Array.from(bytes.slice(0, 1))).toEqual([6]);
    expect(bytes[bytes.length - 1]).toBe(0);
  });

  it('round-trips sentences including multibyte words', async () => {
    const words = ['/ip/hotspot/user/print', '?name=مستخدم-1', '=comment=a=b'];
    const bytes = encodeSentence(words);
    expect(await readSentence(readerOver(bytes))).toEqual(words);
  });

  it('reads consecutive sentences from one stream', async () => {
    const a = encodeSentence(['/a']);
    const b = encodeSentence(['/b', '=x=1']);
    const both = new Uint8Array(a.length + b.length);
    both.set(a, 0);
    both.set(b, a.length);
    const reader = readerOver(both);
    expect(await readSentence(reader)).toEqual(['/a']);
    expect(await readSentence(reader)).toEqual(['/b', '=x=1']);
  });

  it('handles a word that needs a 2-byte length prefix', async () => {
    const long = 'x'.repeat(200);
    expect(await readSentence(readerOver(encodeSentence([long])))).toEqual([long]);
  });

  it('throws on EOF mid-sentence', async () => {
    const bytes = encodeSentence(['/login']).slice(0, 3); // truncated
    await expect(readSentence(readerOver(bytes))).rejects.toThrow(/closed/i);
  });
});

describe('parseReply', () => {
  it('parses !done', () => {
    expect(parseReply(['!done'])).toMatchObject({ type: 'done', attrs: {} });
  });

  it('parses !re attribute rows', () => {
    const r = parseReply(['!re', '=.id=*1', '=name=admin', '=disabled=false']);
    expect(r.type).toBe('re');
    expect(r.attrs).toEqual({ '.id': '*1', name: 'admin', disabled: 'false' });
  });

  it('parses !trap with message', () => {
    const r = parseReply(['!trap', '=message=no such command prefix']);
    expect(r.type).toBe('trap');
    expect(r.attrs['message']).toBe('no such command prefix');
  });

  it('parses !fatal', () => {
    expect(parseReply(['!fatal', '=message=session timeout']).type).toBe('fatal');
  });

  it('extracts .tag', () => {
    const r = parseReply(['!re', '.tag=42', '=name=x']);
    expect(r.tag).toBe('42');
  });

  it('rejects unknown heads', () => {
    expect(() => parseReply(['!weird'])).toThrow(/unexpected reply head/);
  });

  it('replyRows collects only !re sentences', () => {
    const rows = replyRows([
      { type: 're', attrs: { a: '1' }, raw: [] },
      { type: 'done', attrs: {}, raw: [] },
    ]);
    expect(rows).toEqual([{ a: '1' }]);
  });
});

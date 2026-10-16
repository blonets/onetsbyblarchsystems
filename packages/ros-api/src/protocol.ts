/**
 * RouterOS API binary word protocol.
 *
 * Wire format (https://help.mikrotik.com/docs/display/ROS/API):
 * - every word is prefixed with its length, encoded in 1-4 bytes
 *   (a 5-byte 0xF0 form exists for huge words and is decoded but never emitted)
 * - a sentence is a sequence of words terminated by a zero-length word
 * - a reply sentence starts with one of: `!done`, `!trap`, `!re`, `!fatal`
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Encode a word length using the 1-4 byte variable-length scheme. */
export function encodeLength(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`invalid word length: ${length}`);
  }
  if (length < 0x80) {
    return Uint8Array.of(length);
  }
  if (length < 0x4000) {
    return Uint8Array.of(((length >> 8) & 0x3f) | 0x80, length & 0xff);
  }
  if (length < 0x200000) {
    return Uint8Array.of(((length >> 16) & 0x1f) | 0xc0, (length >> 8) & 0xff, length & 0xff);
  }
  if (length < 0x10000000) {
    return Uint8Array.of(
      ((length >>> 24) & 0x0f) | 0xe0,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
    );
  }
  throw new RangeError(`word too long for 4-byte encoding: ${length}`);
}

export interface DecodedLength {
  length: number;
  /** bytes consumed by the length prefix */
  size: number;
}

/** Decode a word length prefix at `offset` (supports the 5-byte 0xF0 form). */
export function decodeLength(buf: Uint8Array, offset: number): DecodedLength {
  const b0 = buf[offset];
  if (b0 === undefined) throw new Error('truncated buffer while decoding word length');
  if (b0 < 0x80) return { length: b0, size: 1 };
  if (b0 < 0xc0) {
    return { length: ((b0 & 0x3f) << 8) | mustByte(buf, offset + 1), size: 2 };
  }
  if (b0 < 0xe0) {
    return {
      length: ((b0 & 0x1f) << 16) | (mustByte(buf, offset + 1) << 8) | mustByte(buf, offset + 2),
      size: 3,
    };
  }
  if (b0 < 0xf0) {
    return {
      length:
        ((b0 & 0x0f) * 0x1000000) |
        (mustByte(buf, offset + 1) << 16) |
        (mustByte(buf, offset + 2) << 8) |
        mustByte(buf, offset + 3),
      size: 4,
    };
  }
  if (b0 === 0xf0) {
    const length =
      mustByte(buf, offset + 1) * 0x1000000 +
      (mustByte(buf, offset + 2) << 16) +
      (mustByte(buf, offset + 3) << 8) +
      mustByte(buf, offset + 4);
    return { length, size: 5 };
  }
  throw new Error(`invalid length prefix byte: 0x${b0.toString(16)}`);
}

function mustByte(buf: Uint8Array, offset: number): number {
  const b = buf[offset];
  if (b === undefined) throw new Error('truncated buffer while decoding word length');
  return b;
}

/** Encode one sentence (list of words) including the terminating zero word. */
export function encodeSentence(words: string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  const push = (p: Uint8Array) => {
    parts.push(p);
    total += p.length;
  };
  for (const word of words) {
    const bytes = textEncoder.encode(word);
    push(encodeLength(bytes.length));
    push(bytes);
  }
  push(Uint8Array.of(0)); // zero-length word terminates the sentence
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Minimal async byte source. `-1` signals EOF / closed connection. */
export interface ByteReader {
  readByte(): Promise<number>;
}

async function readByteOrThrow(reader: ByteReader): Promise<number> {
  const b = await reader.readByte();
  if (b < 0) throw new Error('connection closed while reading sentence');
  return b;
}

async function readLength(reader: ByteReader): Promise<number> {
  const b0 = await readByteOrThrow(reader);
  if (b0 < 0x80) return b0;
  let mask: number;
  let extra: number;
  if (b0 < 0xc0) {
    mask = 0x3f;
    extra = 1;
  } else if (b0 < 0xe0) {
    mask = 0x1f;
    extra = 2;
  } else if (b0 < 0xf0) {
    mask = 0x0f;
    extra = 3;
  } else if (b0 === 0xf0) {
    mask = 0;
    extra = 4;
  } else {
    throw new Error(`invalid length prefix byte: 0x${b0.toString(16)}`);
  }
  let length = b0 & mask;
  for (let i = 0; i < extra; i++) {
    length = length * 256 + (await readByteOrThrow(reader));
  }
  return length;
}

/** Read words until the terminating zero-length word. */
export async function readSentence(reader: ByteReader): Promise<string[]> {
  const words: string[] = [];
  for (;;) {
    const length = await readLength(reader);
    if (length === 0) return words;
    const buf = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      buf[i] = await readByteOrThrow(reader);
    }
    words.push(textDecoder.decode(buf));
  }
}

export type ReplyType = 'done' | 'trap' | 're' | 'fatal';

export interface ReplySentence {
  type: ReplyType;
  /** `.tag` value when the sentence carries one */
  tag?: string;
  /** `=key=value` attributes */
  attrs: Record<string, string>;
  raw: string[];
}

/** Parse a raw reply sentence into its type + attributes. */
export function parseReply(sentence: string[]): ReplySentence {
  const head = sentence[0] ?? '';
  let type: ReplyType;
  switch (head) {
    case '!done':
      type = 'done';
      break;
    case '!trap':
      type = 'trap';
      break;
    case '!re':
      type = 're';
      break;
    case '!fatal':
      type = 'fatal';
      break;
    default:
      throw new Error(`unexpected reply head: ${JSON.stringify(head)}`);
  }
  const attrs: Record<string, string> = {};
  let tag: string | undefined;
  for (const word of sentence.slice(1)) {
    if (word.startsWith('.tag=')) {
      tag = word.slice(5);
    } else if (word.startsWith('=')) {
      const eq = word.indexOf('=', 1);
      if (eq > 0) attrs[word.slice(1, eq)] = word.slice(eq + 1);
    }
  }
  return { type, tag, attrs, raw: sentence };
}

/** Collect the `!re` attribute rows of a finished `talk()` call. */
export function replyRows(replies: ReplySentence[]): Record<string, string>[] {
  return replies.filter((r) => r.type === 're').map((r) => r.attrs);
}

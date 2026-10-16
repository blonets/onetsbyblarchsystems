/**
 * Minimal QR Code encoder — written from scratch for this project (zero deps).
 *
 * Supports byte mode only, error-correction level L, versions 1–10: up to
 * 271 data bytes, which comfortably covers hotspot voucher payloads.
 * (Alphanumeric/numeric modes are intentionally out of scope — every payload
 * we encode carries lowercase text, so byte mode is always correct.)
 *
 * Output: a boolean matrix (true = dark module), ready for SVG/canvas render.
 */

export interface QrMatrix {
  version: number;
  size: number;
  /** rows[r][c] === true → dark module */
  rows: boolean[][];
}

/** Max data bytes (byte mode, EC-L) per version. Index = version. */
const CAPACITY = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];

/** EC-L block layout per version: ec codewords per block + [blockCount, dataCw] groups. */
const BLOCKS: Record<number, { ecPerBlock: number; groups: Array<[number, number]> }> = {
  1: { ecPerBlock: 7, groups: [[1, 19]] },
  2: { ecPerBlock: 10, groups: [[1, 34]] },
  3: { ecPerBlock: 15, groups: [[1, 55]] },
  4: { ecPerBlock: 20, groups: [[1, 80]] },
  5: { ecPerBlock: 26, groups: [[1, 108]] },
  6: { ecPerBlock: 18, groups: [[2, 68]] },
  7: { ecPerBlock: 20, groups: [[2, 78]] },
  8: { ecPerBlock: 24, groups: [[2, 97]] },
  9: { ecPerBlock: 30, groups: [[2, 116]] },
  10: { ecPerBlock: 18, groups: [[2, 68], [2, 69]] },
};

/** Alignment-pattern centre positions per version. */
const ALIGN_POS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// ---------------------------------------------------------------------------
// GF(256) arithmetic (primitive polynomial x^8 + x^4 + x^3 + x^2 + 1)
// ---------------------------------------------------------------------------

const EXP = new Array<number>(512);
const LOG = new Array<number>(256);

(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Reed–Solomon generator polynomial of `degree`: ∏(x + α^i), coefficients high→low. */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    // Multiply by (x + α^i): the x-term shifts coefficients up one slot,
    // the α^i-term scales them in place.
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed–Solomon remainder (the ECC codewords) for a data block. */
function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const msg = [...data, ...new Array<number>(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return msg.slice(data.length);
}

// ---------------------------------------------------------------------------
// Data encoding (byte mode, EC-L)
// ---------------------------------------------------------------------------

/** Total data codewords (pre-ECC) for a version at EC-L. */
function dataCodewords(version: number): number {
  return BLOCKS[version].groups.reduce((sum, [count, dcw]) => sum + count * dcw, 0);
}

/** Encode bytes → data codewords (with mode header, terminator, padding). */
function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4); // byte mode indicator
  push(bytes.length, version <= 9 ? 8 : 16); // character count
  for (const b of bytes) push(b, 8);

  const totalBits = dataCodewords(version) * 8;
  push(0, Math.min(4, Math.max(0, totalBits - bits.length))); // terminator
  while (bits.length % 8 !== 0) bits.push(0); // byte-align

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }
  let pad = 0xec;
  while (codewords.length < dataCodewords(version)) {
    codewords.push(pad);
    pad = pad === 0xec ? 0x11 : 0xec;
  }
  return codewords;
}

/** Split into blocks, append ECC per block, interleave → final codeword stream. */
function interleave(data: number[], version: number): number[] {
  const { ecPerBlock, groups } = BLOCKS[version];
  const blocks: number[][] = [];
  let off = 0;
  for (const [count, dcw] of groups) {
    for (let i = 0; i < count; i++) {
      blocks.push(data.slice(off, off + dcw));
      off += dcw;
    }
  }
  const ecc = blocks.map((b) => rsRemainder(b, ecPerBlock));
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const e of ecc) out.push(e[i]);
  return out;
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

const FINDER = [0b1111111, 0b1000001, 0b1011101, 0b1011101, 0b1011101, 0b1000001, 0b1111111];
const ALIGN = [0b11111, 0b10001, 0b10101, 0b10001, 0b11111];

function newGrid(size: number): { m: number[][]; func: boolean[][] } {
  return {
    m: Array.from({ length: size }, () => new Array<number>(size).fill(-1)),
    func: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function drawFinder(m: number[][], func: boolean[][], size: number, r0: number, c0: number): void {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      if (dr === -1 || dr === 7 || dc === -1 || dc === 7) {
        m[r][c] = 0; // separator
      } else {
        m[r][c] = (FINDER[dr] >>> (6 - dc)) & 1;
      }
      func[r][c] = true;
    }
  }
}

/** Mark (but don't fill) format-info module positions as function modules. */
function reserveFormat(func: boolean[][], size: number): void {
  const mark = (r: number, c: number) => {
    func[r][c] = true;
  };
  // Copy 1: row-8 strip (8,0..5,7,8), col-8 strip (0..5,8),(7,8)
  for (let i = 0; i <= 5; i++) {
    mark(8, i);
    mark(i, 8);
  }
  mark(8, 7);
  mark(8, 8);
  mark(7, 8);
  // Copy 2: row-8 tail (8,size-1..size-8), col-8 tail (size-7..size-1,8)
  for (let i = 0; i < 8; i++) mark(8, size - 1 - i);
  for (let i = 8; i < 15; i++) mark(size - 15 + i, 8);
}

/** Mark (but don't fill) version-info module positions as function modules. */
function reserveVersion(func: boolean[][], size: number, version: number): void {
  if (version < 7) return;
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    func[a][b] = true;
    func[b][a] = true;
  }
}

function buildBase(version: number): { m: number[][]; func: boolean[][]; size: number } {
  const size = 21 + (version - 1) * 4;
  const { m, func } = newGrid(size);

  drawFinder(m, func, size, 0, 0);
  drawFinder(m, func, size, 0, size - 7);
  drawFinder(m, func, size, size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    m[6][i] = v;
    func[6][i] = true;
    m[i][6] = v;
    func[i][6] = true;
  }

  const pos = ALIGN_POS[version];
  for (const r of pos) {
    for (const c of pos) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          m[r + dr][c + dc] = (ALIGN[dr + 2] >>> (4 - (dc + 2))) & 1;
          func[r + dr][c + dc] = true;
        }
      }
    }
  }

  m[4 * version + 9][8] = 1; // dark module
  func[4 * version + 9][8] = true;

  reserveFormat(func, size);
  reserveVersion(func, size, version);
  return { m, func, size };
}

/** Zig-zag data placement (two-column bands, right to left, skipping column 6).
 * Every non-function module gets a value (0 once the codewords are exhausted)
 * so masking later applies uniformly across the whole encoding region. */
function placeData(m: number[][], func: boolean[][], size: number, codewords: number[]): void {
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!func[y][x]) {
          m[y][x] = bit < total ? (codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1 : 0;
          bit++;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Masking + format/version info
// ---------------------------------------------------------------------------

function maskApplies(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return (r * c) % 2 + ((r * c) % 3) === 0;
    case 6: return ((r * c) % 2 + ((r * c) % 3)) % 2 === 0;
    default: return ((r + c) % 2 + ((r * c) % 3)) % 2 === 0;
  }
}

/** 15-bit format info (EC-L + mask), BCH-coded, XOR mask 0x5412.
 *
 * Placement (bit i = LSB-first), verified against a reference encoder:
 * vertical   — (0..5,8)=bits 0..5, (7,8)=bit 6, (8,8)=bit 7, (size-7..size-1,8)=bits 8..14
 * horizontal — (8,size-1..size-8)=bits 0..7, (8,7)=bit 8, (8,5..0)=bits 9..14
 */
function drawFormat(m: number[][], size: number, mask: number): void {
  const data = (0b01 << 3) | mask; // EC level L = 01
  let rem = data;
  for (let i = 0; i < 10; i++) rem = ((rem << 1) ^ (((rem >>> 9) & 1) * 0x537)) & 0x3ff;
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = (bits >>> i) & 1;
    // vertical strip
    if (i < 6) m[i][8] = bit;
    else if (i < 8) m[i + 1][8] = bit;
    else m[size - 15 + i][8] = bit;
    // horizontal strip
    if (i < 8) m[8][size - 1 - i] = bit;
    else if (i < 9) m[8][7] = bit;
    else m[8][15 - i - 1] = bit;
  }
}

/** 18-bit version info (versions 7+), BCH-coded. */
function drawVersion(m: number[][], size: number, version: number): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = ((rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25)) & 0xfff;
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const bit = (bits >>> i) & 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m[a][b] = bit;
    m[b][a] = bit;
  }
}

function penalty(m: number[][], size: number): number {
  let p = 0;
  // N1: runs of 5+ in rows and columns
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (m[r][c] === m[r][c - 1]) run++;
      else {
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) p += 3 + (run - 5);
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (m[r][c] === m[r - 1][c]) run++;
      else {
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) p += 3 + (run - 5);
  }
  // N2: 2×2 blocks of same colour
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
  }
  // N3: finder-like patterns
  const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let a = true;
      let b = true;
      for (let k = 0; k < 11; k++) {
        if (m[r][c + k] !== p1[k]) a = false;
        if (m[r][c + k] !== p2[k]) b = false;
      }
      if (a || b) p += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      let a = true;
      let b = true;
      for (let k = 0; k < 11; k++) {
        if (m[r + k][c] !== p1[k]) a = false;
        if (m[r + k][c] !== p2[k]) b = false;
      }
      if (a || b) p += 40;
    }
  }
  // N4: dark-module ratio — k = |ceil(dark% / 5) − 10|
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c] === 1) dark++;
  const k = Math.abs(Math.ceil(((dark * 100) / (size * size)) / 5) - 10);
  p += k * 10;
  return p;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode `text` (UTF-8) as a QR matrix. Returns null when the payload exceeds
 * version 10-L capacity (271 bytes). Throws nothing.
 */
export function encodeQr(text: string): QrMatrix | null {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (bytes.length <= CAPACITY[v]) {
      version = v;
      break;
    }
  }
  if (version === 0) return null;

  const codewords = interleave(encodeData(bytes, version), version);
  const { m, func, size } = buildBase(version);
  placeData(m, func, size, codewords);

  // Pick the best mask by penalty (format+version info included in scoring).
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const trial = m.map((row, r) => row.map((v, c) => (!func[r][c] && maskApplies(mask, r, c) ? v ^ 1 : v)));
    drawFormat(trial, size, mask);
    drawVersion(trial, size, version);
    const p = penalty(trial, size);
    if (p < bestPenalty) {
      bestPenalty = p;
      bestMask = mask;
    }
  }

  const final = m.map((row, r) => row.map((v, c) => (!func[r][c] && maskApplies(bestMask, r, c) ? v ^ 1 : v)));
  drawFormat(final, size, bestMask);
  drawVersion(final, size, version);

  return {
    version,
    size,
    rows: final.map((row) => row.map((v) => v === 1)),
  };
}

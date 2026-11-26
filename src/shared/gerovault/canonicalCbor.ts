/**
 * A deterministic CBOR writer (RFC 8949 section 4.2.1, core deterministic encoding) for the
 * subset the `gero-vault/v1` objects use: integers, byte strings, text strings, arrays and maps
 * with text keys. `cbor.ts` is the matching strict reader.
 *
 * - Integers and lengths take the shortest head, and every length is definite.
 * - Map keys are sorted by the bytewise lexicographic order of their encodings. For text keys
 *   that is shorter keys first, then by bytes (the same order as RFC 7049's length-first rule).
 * - Floats, booleans, `null`, tags and simple values are not written, because the reader refuses
 *   them. A caller encodes a flag as the integer 0 or 1.
 *
 * Input mapping: `number` or `bigint` is an integer, `string` a text string, `Uint8Array` a byte
 * string, an array an array, and a plain object a map. Anything else throws a `TypeError`: callers
 * validate their values first, so a throw here is a programming error.
 */

export type CborWritable = number | bigint | string | Uint8Array | readonly CborWritable[] | CborWritableMap;

export interface CborWritableMap {
  readonly [key: string]: CborWritable;
}

const MAX_UINT64 = (1n << 64n) - 1n;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const utf8 = new TextEncoder();

function head(major: number, value: bigint): number[] {
  const m = major << 5;
  if (value < 24n) return [m | Number(value)];
  if (value < 0x100n) return [m | 24, Number(value)];
  if (value < 0x10000n) return [m | 25, Number(value >> 8n), Number(value & 0xffn)];
  const size = value < 0x100000000n ? 4 : 8;
  const out = [m | (size === 4 ? 26 : 27)];
  for (let i = size - 1; i >= 0; i--) out.push(Number((value >> BigInt(8 * i)) & 0xffn));
  return out;
}

function text(value: string): Uint8Array {
  if (LONE_SURROGATE.test(value)) throw new TypeError('A CBOR text string must be well-formed UTF-16');
  return utf8.encode(value);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function write(value: CborWritable, out: number[][], depth: number): void {
  if (depth > 64) throw new TypeError('CBOR value nested too deep');
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new TypeError('A CBOR integer must be a safe integer');
    const n = BigInt(value);
    if (n >= 0n) {
      if (n > MAX_UINT64) throw new TypeError('CBOR integer out of range');
      out.push(head(0, n));
    } else {
      if (-1n - n > MAX_UINT64) throw new TypeError('CBOR integer out of range');
      out.push(head(1, -1n - n));
    }
    return;
  }
  if (typeof value === 'string') {
    const bytes = text(value);
    out.push(head(3, BigInt(bytes.length)), Array.from(bytes));
    return;
  }
  if (value instanceof Uint8Array) {
    out.push(head(2, BigInt(value.length)), Array.from(value));
    return;
  }
  if (Array.isArray(value)) {
    out.push(head(4, BigInt(value.length)));
    for (const item of value) write(item, out, depth + 1);
    return;
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.keys(value).map(key => {
      const k = encodeCanonicalCbor(key);
      const v: number[][] = [];
      write((value as CborWritableMap)[key], v, depth + 1);
      return { k, v };
    });
    entries.sort((a, b) => compareBytes(a.k, b.k));
    out.push(head(5, BigInt(entries.length)));
    for (const { k, v } of entries) {
      out.push(Array.from(k));
      for (const chunk of v) out.push(chunk);
    }
    return;
  }
  throw new TypeError('Not a CBOR value this writer encodes');
}

/** The deterministic CBOR encoding of `value`. */
export function encodeCanonicalCbor(value: CborWritable): Uint8Array {
  const chunks: number[][] = [];
  write(value, chunks, 0);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

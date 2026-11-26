/**
 * A deterministic CBOR writer (RFC 8949 section 4.2.1, core deterministic encoding) for the
 * subset the `gero-vault/v1` objects use: integers, byte strings, text strings, booleans, arrays
 * and maps. `cbor.ts` is the matching strict reader (with `booleans: true` where booleans occur).
 *
 * - Integers and lengths take the shortest head, and every length is definite.
 * - Map keys are sorted by the bytewise lexicographic order of their encodings. For text keys
 *   that is shorter keys first, then by bytes; integer keys sort by their encoded heads.
 * - Floats, `null`, tags and other simple values are never written.
 *
 * Input mapping: `number` or `bigint` is an integer, `string` a text string, `Uint8Array` a byte
 * string, `boolean` a boolean, an array an array, a plain object a map with text keys, and a
 * `Map` a map with integer or text keys. Anything else throws a `TypeError`: callers validate
 * their values first, so a throw here is a programming error.
 */

export type CborWritable =
  | number
  | bigint
  | string
  | boolean
  | Uint8Array
  | readonly CborWritable[]
  | CborWritableMap
  | ReadonlyMap<number | bigint | string, CborWritable>;

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

/** Pieces of the encoding: heads as small arrays, byte and text strings as they are, never copied byte by byte. */
type Chunk = Uint8Array | readonly number[];

function write(value: CborWritable, out: Chunk[], depth: number): void {
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
    out.push(head(3, BigInt(bytes.length)), bytes);
    return;
  }
  if (typeof value === 'boolean') {
    out.push([value ? 0xf5 : 0xf4]);
    return;
  }
  if (value instanceof Uint8Array) {
    out.push(head(2, BigInt(value.length)), value);
    return;
  }
  if (Array.isArray(value)) {
    out.push(head(4, BigInt(value.length)));
    for (const item of value) write(item, out, depth + 1);
    return;
  }
  const isMap = value instanceof Map;
  if (isMap || (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)) {
    const pairs: [number | bigint | string, CborWritable][] = isMap
      ? [...(value as ReadonlyMap<number | bigint | string, CborWritable>).entries()]
      : Object.keys(value).map(key => [key, (value as CborWritableMap)[key]]);
    const entries = pairs.map(([key, item]) => {
      if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'bigint') throw new TypeError('A CBOR map key is an integer or text');
      const k = encodeCanonicalCbor(key);
      const v: Chunk[] = [];
      write(item, v, depth + 1);
      return { k, v };
    });
    entries.sort((a, b) => compareBytes(a.k, b.k));
    for (let i = 1; i < entries.length; i++) {
      if (compareBytes(entries[i - 1].k, entries[i].k) === 0) throw new TypeError('A CBOR map key appears twice');
    }
    out.push(head(5, BigInt(entries.length)));
    for (const { k, v } of entries) {
      out.push(k);
      for (const chunk of v) out.push(chunk);
    }
    return;
  }
  throw new TypeError('Not a CBOR value this writer encodes');
}

/** The deterministic CBOR encoding of `value`. */
export function encodeCanonicalCbor(value: CborWritable): Uint8Array {
  const chunks: Chunk[] = [];
  write(value, chunks, 0);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

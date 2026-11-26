/**
 * A strict, bounded CBOR reader for untrusted registration bytes: the subset transaction
 * metadata and native scripts use (integers, byte and text strings, arrays, maps).
 *
 * It refuses what a lenient decoder would quietly accept and then hash or show differently:
 * indefinite lengths, non-minimal heads, tags, floats and simple values, invalid UTF-8,
 * duplicate map keys, trailing bytes, and input deeper or larger than the limits. Every item
 * keeps its byte span, so a script is hashed over the exact bytes that were published.
 *
 * One opt-in exception: with `booleans: true` in the limits, the two simple values `false` and
 * `true` are read as booleans. Every other simple value is still refused, and without the option
 * booleans are refused as before.
 */

export type CborRefusal =
  | 'TRUNCATED'
  | 'INDEFINITE_LENGTH'
  | 'NON_MINIMAL'
  | 'UNSUPPORTED_TYPE'
  | 'INVALID_UTF8'
  | 'DUPLICATE_MAP_KEY'
  | 'TOO_DEEP'
  | 'TOO_MANY_ITEMS'
  | 'TRAILING_BYTES';

export class CborError extends Error {
  readonly reason: CborRefusal;

  constructor(reason: CborRefusal) {
    super(`CBOR refused: ${reason}`);
    this.name = 'CborError';
    this.reason = reason;
  }
}

/** A CBOR boolean, read only when the limits opt in (`booleans: true`). */
export type CborBoolean = { readonly type: 'bool'; readonly value: boolean };

/** A decoded value; `Extra` is `CborBoolean` when booleans are read, else nothing. */
export type CborValueOf<Extra> =
  | { readonly type: 'int'; readonly value: bigint }
  | { readonly type: 'bytes'; readonly value: Uint8Array }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'array'; readonly value: readonly CborItemOf<Extra>[] }
  | { readonly type: 'map'; readonly value: readonly (readonly [CborItemOf<Extra>, CborItemOf<Extra>])[] }
  | Extra;

export interface CborItemOf<Extra> {
  readonly value: CborValueOf<Extra>;
  /** Byte offset of the item's head. */
  readonly start: number;
  /** Byte offset just past the item. */
  readonly end: number;
}

export type CborValue = CborValueOf<never>;
export type CborItem = CborItemOf<never>;

export interface CborLimits {
  readonly maxDepth: number;
  readonly maxItems: number;
  /** Read `false` and `true` (and no other simple value). Off by default. */
  readonly booleans?: boolean;
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

class Reader {
  private offset = 0;
  private items = 0;

  constructor(private readonly bytes: Uint8Array, private readonly limits: CborLimits) {}

  done(): boolean {
    return this.offset === this.bytes.length;
  }

  private byte(): number {
    if (this.offset >= this.bytes.length) throw new CborError('TRUNCATED');
    return this.bytes[this.offset++];
  }

  /** Reads an argument of `size` bytes, big-endian. */
  private uint(size: number): bigint {
    let v = 0n;
    for (let i = 0; i < size; i++) v = (v << 8n) | BigInt(this.byte());
    return v;
  }

  private argument(info: number): bigint {
    if (info < 24) return BigInt(info);
    if (info === 31) throw new CborError('INDEFINITE_LENGTH');
    if (info > 27) throw new CborError('UNSUPPORTED_TYPE');
    const size = 1 << (info - 24);
    const v = this.uint(size);
    const floor = size === 1 ? 24n : 1n << BigInt(8 * (size / 2));
    if (v < floor) throw new CborError('NON_MINIMAL');
    return v;
  }

  private length(info: number): number {
    const n = this.argument(info);
    if (n > BigInt(this.bytes.length - this.offset)) throw new CborError('TRUNCATED');
    return Number(n);
  }

  private take(n: number): Uint8Array {
    if (this.offset + n > this.bytes.length) throw new CborError('TRUNCATED');
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  item(depth: number): CborItemOf<CborBoolean> {
    if (depth > this.limits.maxDepth) throw new CborError('TOO_DEEP');
    if (++this.items > this.limits.maxItems) throw new CborError('TOO_MANY_ITEMS');
    const start = this.offset;
    const head = this.byte();
    const major = head >> 5;
    const info = head & 0x1f;
    let value: CborValueOf<CborBoolean>;
    switch (major) {
      case 0:
        value = { type: 'int', value: this.argument(info) };
        break;
      case 1:
        value = { type: 'int', value: -1n - this.argument(info) };
        break;
      case 2:
        // A copy, so the value does not hold on to the input; slice() copies natively.
        value = { type: 'bytes', value: this.take(this.length(info)).slice() };
        break;
      case 3: {
        let text: string;
        try {
          text = utf8.decode(this.take(this.length(info)));
        } catch (e) {
          if (e instanceof CborError) throw e;
          throw new CborError('INVALID_UTF8');
        }
        value = { type: 'text', value: text };
        break;
      }
      case 4: {
        const n = this.length(info);
        const out: CborItemOf<CborBoolean>[] = [];
        for (let i = 0; i < n; i++) out.push(this.item(depth + 1));
        value = { type: 'array', value: out };
        break;
      }
      case 5: {
        const n = this.length(info);
        const out: [CborItemOf<CborBoolean>, CborItemOf<CborBoolean>][] = [];
        const seen = new Set<string>();
        for (let i = 0; i < n; i++) {
          const key = this.item(depth + 1);
          const encoded = bytesToHex(this.bytes.subarray(key.start, key.end));
          if (seen.has(encoded)) throw new CborError('DUPLICATE_MAP_KEY');
          seen.add(encoded);
          out.push([key, this.item(depth + 1)]);
        }
        value = { type: 'map', value: out };
        break;
      }
      case 7:
        // 0xf4 false, 0xf5 true; floats and every other simple value stay refused.
        if (!this.limits.booleans || (info !== 20 && info !== 21)) throw new CborError('UNSUPPORTED_TYPE');
        value = { type: 'bool', value: info === 21 };
        break;
      default:
        throw new CborError('UNSUPPORTED_TYPE');
    }
    return { value, start, end: this.offset };
  }
}

/**
 * Decodes exactly one CBOR item filling all of `bytes`. Throws `CborError`. Booleans are read only
 * when `limits.booleans` is true, and only then can the result contain one.
 */
export function readCbor(bytes: Uint8Array, limits: CborLimits & { readonly booleans: true }): CborItemOf<CborBoolean>;
export function readCbor(bytes: Uint8Array, limits: CborLimits & { readonly booleans?: false }): CborItem;
export function readCbor(bytes: Uint8Array, limits: CborLimits): CborItemOf<CborBoolean> {
  const reader = new Reader(bytes, limits);
  const item = reader.item(0);
  if (!reader.done()) throw new CborError('TRAILING_BYTES');
  return item;
}

// Hex digits by character code, -1 for anything else; and the two lowercase digits of each byte.
const HEX_VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < 16; i++) {
  HEX_VALUE['0123456789abcdef'.charCodeAt(i)] = i;
  HEX_VALUE['0123456789ABCDEF'.charCodeAt(i)] = i;
}
const HEX_PAIR = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));
const HEX_CODE = new TextEncoder().encode('0123456789abcdef');

/** Hex to bytes, or `undefined` for anything that is not an even-length hex string (either case). */
export function hexToBytes(hex: unknown): Uint8Array | undefined {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const a = hex.charCodeAt(2 * i);
    const b = hex.charCodeAt(2 * i + 1);
    const hi = a < 128 ? HEX_VALUE[a] : -1;
    const lo = b < 128 ? HEX_VALUE[b] : -1;
    if (hi < 0 || lo < 0) return undefined;
    out[i] = (hi << 4) | lo;
  }
  return out;
}

/** Bytes to lowercase hex. Long inputs go through one ASCII buffer rather than a string per byte. */
export function bytesToHex(bytes: Uint8Array): string {
  if (bytes.length <= 64) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += HEX_PAIR[bytes[i]];
    return out;
  }
  const ascii = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    ascii[2 * i] = HEX_CODE[bytes[i] >> 4];
    ascii[2 * i + 1] = HEX_CODE[bytes[i] & 15];
  }
  return utf8.decode(ascii);
}

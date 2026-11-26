/**
 * A strict, bounded CBOR reader for untrusted registration bytes: the subset transaction
 * metadata and native scripts use (integers, byte and text strings, arrays, maps).
 *
 * It refuses what a lenient decoder would quietly accept and then hash or show differently:
 * indefinite lengths, non-minimal heads, tags, floats and simple values, invalid UTF-8,
 * duplicate map keys, trailing bytes, and input deeper or larger than the limits. Every item
 * keeps its byte span, so a script is hashed over the exact bytes that were published.
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

export type CborValue =
  | { readonly type: 'int'; readonly value: bigint }
  | { readonly type: 'bytes'; readonly value: Uint8Array }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'array'; readonly value: readonly CborItem[] }
  | { readonly type: 'map'; readonly value: readonly (readonly [CborItem, CborItem])[] };

export interface CborItem {
  readonly value: CborValue;
  /** Byte offset of the item's head. */
  readonly start: number;
  /** Byte offset just past the item. */
  readonly end: number;
}

export interface CborLimits {
  readonly maxDepth: number;
  readonly maxItems: number;
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

  item(depth: number): CborItem {
    if (depth > this.limits.maxDepth) throw new CborError('TOO_DEEP');
    if (++this.items > this.limits.maxItems) throw new CborError('TOO_MANY_ITEMS');
    const start = this.offset;
    const head = this.byte();
    const major = head >> 5;
    const info = head & 0x1f;
    let value: CborValue;
    switch (major) {
      case 0:
        value = { type: 'int', value: this.argument(info) };
        break;
      case 1:
        value = { type: 'int', value: -1n - this.argument(info) };
        break;
      case 2:
        value = { type: 'bytes', value: Uint8Array.from(this.take(this.length(info))) };
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
        const out: CborItem[] = [];
        for (let i = 0; i < n; i++) out.push(this.item(depth + 1));
        value = { type: 'array', value: out };
        break;
      }
      case 5: {
        const n = this.length(info);
        const out: [CborItem, CborItem][] = [];
        const seen = new Set<string>();
        for (let i = 0; i < n; i++) {
          const key = this.item(depth + 1);
          const encoded = Array.from(this.bytes.subarray(key.start, key.end)).join(',');
          if (seen.has(encoded)) throw new CborError('DUPLICATE_MAP_KEY');
          seen.add(encoded);
          out.push([key, this.item(depth + 1)]);
        }
        value = { type: 'map', value: out };
        break;
      }
      default:
        throw new CborError('UNSUPPORTED_TYPE');
    }
    return { value, start, end: this.offset };
  }
}

/** Decodes exactly one CBOR item filling all of `bytes`. Throws `CborError`. */
export function readCbor(bytes: Uint8Array, limits: CborLimits): CborItem {
  const reader = new Reader(bytes, limits);
  const item = reader.item(0);
  if (!reader.done()) throw new CborError('TRAILING_BYTES');
  return item;
}

const HEX = /^(?:[0-9a-fA-F]{2})*$/;

/** Hex to bytes, or `undefined` for anything that is not an even-length hex string. */
export function hexToBytes(hex: unknown): Uint8Array | undefined {
  if (typeof hex !== 'string' || !HEX.test(hex)) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

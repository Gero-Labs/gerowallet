/**
 * Byte helpers of the Midnight key library. Midnight's runtime writes every field element and
 * every integer word as 32 bytes, little-endian; tags are their UTF-8 bytes.
 */

const HEX = /^(?:[0-9a-f]{2})*$/;
const utf8 = new TextEncoder();

/** Lowercase hex of `bytes`. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** The bytes of lowercase hex of exactly `length` bytes (any length when omitted); `undefined` otherwise. */
export function fromHex(hex: unknown, length?: number): Uint8Array | undefined {
  if (typeof hex !== 'string' || !HEX.test(hex)) return undefined;
  if (length !== undefined && hex.length !== 2 * length) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function utf8Bytes(text: string): Uint8Array {
  return utf8.encode(text);
}

/** LE2IP: the little-endian integer of `bytes`. */
export function le2ip(bytes: Uint8Array): bigint {
  let x = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(bytes[i]);
  return x;
}

/** LE32: `x` as 32 little-endian bytes. Throws a `RangeError` when it does not fit. */
export function le32(x: bigint): Uint8Array {
  if (x < 0n || x >= 1n << 256n) throw new RangeError('A word is a non-negative integer below 2^256');
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** The UTF-8 bytes of `text`, zero-padded to 32 bytes (Compact's `pad(32, text)`). */
export function pad32(text: string): Uint8Array {
  const bytes = utf8Bytes(text);
  if (bytes.length > 32) throw new RangeError('A padded word holds at most 32 bytes');
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
}

/** Byte-for-byte equality, without an early exit on the first difference. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

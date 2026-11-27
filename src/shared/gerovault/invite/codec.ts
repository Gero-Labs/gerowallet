/**
 * Byte and CBOR helpers of `gero-vault-invite/v1`: strict base64url, the X25519 public key check,
 * and a reader that turns strictly decoded CBOR into a closed record or a refusal.
 *
 * Every decoder in this folder follows one rule: decode with the strict reader (`../cbor.ts`),
 * check each field, then re-encode with the canonical writer and require the same bytes. So one
 * object has exactly one encoding, and a port that encodes differently fails the vectors.
 */
import { atLeastP } from '../attestation';
import { CborError, CborItem, CborValue, bytesToHex, hexToBytes, readCbor } from '../cbor';
import { CborWritable, encodeCanonicalCbor } from '../canonicalCbor';
import { readLabel } from '../labels';
import { INVITE_NETWORKS, InviteNetwork, KEY_BYTES } from './constants';

export { bytesToHex, hexToBytes };

/** Why untrusted invitation input was refused. Never shown to a user as text. */
export type InviteRefusalCode =
  | 'MALFORMED'
  | 'NOT_CANONICAL'
  | 'TOO_LARGE'
  | 'UNKNOWN_VERSION'
  | 'WRONG_KIND'
  | 'BAD_FIELD'
  | 'BAD_KEY'
  | 'BAD_SIGNATURE'
  | 'BAD_MAC'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'LIFETIME_TOO_LONG'
  | 'WRONG_SETUP'
  | 'WRONG_NETWORK'
  | 'WRONG_INVITE'
  | 'WRONG_RECIPIENT'
  | 'DECRYPT_FAILED'
  | 'BAD_REVOKE';

export type InviteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: InviteRefusalCode; readonly field?: string };

export class InviteRefusal extends Error {
  constructor(readonly code: InviteRefusalCode, readonly field?: string) {
    super(field ? `${code}: ${field}` : code);
    this.name = 'InviteRefusal';
  }
}

export const refuse = (code: InviteRefusalCode, field?: string): never => {
  throw new InviteRefusal(code, field);
};

/** Runs `fn`, turning an `InviteRefusal` into a refusal result. Anything else is a bug and propagates. */
export function attempt<T>(fn: () => T): InviteResult<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof InviteRefusal) return e.field ? { ok: false, code: e.code, field: e.field } : { ok: false, code: e.code };
    throw e;
  }
}

export async function attemptAsync<T>(fn: () => Promise<T>): Promise<InviteResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof InviteRefusal) return e.field ? { ok: false, code: e.code, field: e.field } : { ok: false, code: e.code };
    throw e;
  }
}

const utf8 = new TextEncoder();
export const ascii = (text: string): Uint8Array => utf8.encode(text);

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------------------------
// base64url (RFC 4648 section 5), no padding, strict

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64URL_VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64URL_VALUE[B64URL.charCodeAt(i)] = i;

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[n >> 18] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64URL[n >> 18] + B64URL[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64URL[n >> 18] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63];
  }
  return out;
}

/**
 * base64url without padding to bytes, or `undefined`: refuses padding, the standard alphabet's
 * `+` and `/`, whitespace, a length of 1 mod 4, and non-zero unused bits (so each byte string has
 * one spelling).
 */
export function fromBase64Url(text: unknown): Uint8Array | undefined {
  if (typeof text !== 'string' || text.length % 4 === 1) return undefined;
  const values = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const v = c < 128 ? B64URL_VALUE[c] : -1;
    if (v < 0) return undefined;
    values[i] = v;
  }
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  let i = 0;
  for (; i + 3 < text.length; i += 4) {
    const n = (values[i] << 18) | (values[i + 1] << 12) | (values[i + 2] << 6) | values[i + 3];
    out[o++] = n >> 16;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  const rest = text.length - i;
  if (rest === 2) {
    if (values[i + 1] & 15) return undefined;
    out[o++] = (values[i] << 2) | (values[i + 1] >> 4);
  } else if (rest === 3) {
    if (values[i + 2] & 3) return undefined;
    const n = (values[i] << 10) | (values[i + 1] << 4) | (values[i + 2] >> 2);
    out[o++] = n >> 8;
    out[o++] = n & 255;
  }
  return out;
}

/** Lowercase hex of exactly `length` bytes, or `undefined`. */
export function fixedHex(value: unknown, length: number): Uint8Array | undefined {
  if (typeof value !== 'string' || value.length !== 2 * length || value !== value.toLowerCase()) return undefined;
  return hexToBytes(value);
}

// ---------------------------------------------------------------------------------------------
// X25519 public keys

// The canonical u-coordinates of small order (RFC 7748 section 7; the curve's 8-torsion): 0, 1,
// the two points of order 8, and p - 1. Values at or above p are refused as non-canonical first.
const X25519_SMALL_ORDER = new Set([
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
]);

/**
 * An X25519 public key an invitation may use: 32 bytes, the top bit clear, u below p, and not one
 * of the small-order points. (Encryption also refuses an all-zero shared secret, `seal.ts`.)
 */
export function isUsableX25519Key(key: unknown): key is Uint8Array {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) return false;
  if (key[31] & 0x80 || atLeastP(key)) return false;
  return !X25519_SMALL_ORDER.has(bytesToHex(key));
}

// ---------------------------------------------------------------------------------------------
// Strict CBOR to closed records

const LIMITS = { maxDepth: 6, maxItems: 1024 } as const;

/** Strictly decodes one CBOR item (no booleans, no floats, no tags, no trailing bytes). */
export function decodeStrict(bytes: Uint8Array, maxBytes: number): CborItem {
  if (!(bytes instanceof Uint8Array)) return refuse('MALFORMED');
  if (bytes.length > maxBytes) return refuse('TOO_LARGE');
  try {
    return readCbor(bytes, LIMITS);
  } catch (e) {
    if (e instanceof CborError) return refuse('MALFORMED');
    throw e;
  }
}

/** Requires that `bytes` is exactly the canonical encoding of `value`. */
export function requireCanonical(bytes: Uint8Array, value: CborWritable): void {
  if (!sameBytes(bytes, encodeCanonicalCbor(value))) refuse('NOT_CANONICAL');
}

/** A map with text keys: required keys present, no key outside `required` and `optional`. */
export class Fields {
  private readonly map = new Map<string, CborValue>();

  constructor(value: CborValue, required: readonly string[], optional: readonly string[], private readonly where: string) {
    if (value?.type !== 'map') refuse('MALFORMED', where);
    const allowed = new Set([...required, ...optional]);
    for (const [k, v] of (value as Extract<CborValue, { type: 'map' }>).value) {
      if (k.value.type !== 'text' || !allowed.has(k.value.value)) refuse('BAD_FIELD', `${where}.${k.value.type === 'text' ? k.value.value : '?'}`);
      this.map.set((k.value as { value: string }).value, v.value);
    }
    for (const key of required) if (!this.map.has(key)) refuse('BAD_FIELD', `${where}.${key}`);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  private get(key: string): CborValue {
    return this.map.get(key) as CborValue;
  }

  private name(key: string): string {
    return `${this.where}.${key}`;
  }

  raw(key: string): CborValue {
    return this.get(key);
  }

  uint(key: string, max = Number.MAX_SAFE_INTEGER): number {
    const v = this.get(key);
    if (v?.type !== 'int' || v.value < 0n || v.value > BigInt(max)) refuse('BAD_FIELD', this.name(key));
    return Number((v as { value: bigint }).value);
  }

  text(key: string): string {
    const v = this.get(key);
    if (v?.type !== 'text') refuse('BAD_FIELD', this.name(key));
    return (v as { value: string }).value;
  }

  bytes(key: string, length: number): Uint8Array {
    const v = this.get(key);
    if (v?.type !== 'bytes' || v.value.length !== length) refuse('BAD_FIELD', this.name(key));
    return (v as { value: Uint8Array }).value;
  }

  boundedBytes(key: string, max: number): Uint8Array {
    const v = this.get(key);
    if (v?.type !== 'bytes' || v.value.length === 0 || v.value.length > max) refuse('BAD_FIELD', this.name(key));
    return (v as { value: Uint8Array }).value;
  }

  label(key: string): string {
    const label = readLabel(this.text(key));
    if (label === undefined || label.length === 0) refuse('BAD_FIELD', this.name(key));
    return label as string;
  }

  network(key: string): InviteNetwork {
    const network = this.text(key);
    if (!INVITE_NETWORKS.includes(network as InviteNetwork)) refuse('WRONG_NETWORK', this.name(key));
    return network as InviteNetwork;
  }

  x25519(key: string): Uint8Array {
    const k = this.bytes(key, KEY_BYTES);
    if (!isUsableX25519Key(k)) refuse('BAD_KEY', this.name(key));
    return k;
  }

  record(key: string, required: readonly string[], optional: readonly string[] = []): Fields {
    return new Fields(this.get(key), required, optional, this.name(key));
  }

  list(key: string, max: number): readonly CborValue[] {
    const v = this.get(key);
    if (v?.type !== 'array' || v.value.length > max) refuse('BAD_FIELD', this.name(key));
    return (v as Extract<CborValue, { type: 'array' }>).value.map(i => i.value);
  }
}

/** The protocol version and kind every payload starts with. */
export function expectHeader(f: Fields, kind: string): void {
  const v = f.raw('v');
  if (v?.type !== 'int' || v.value !== 1n) refuse('UNKNOWN_VERSION');
  if (f.text('kind') !== kind) refuse('WRONG_KIND');
}

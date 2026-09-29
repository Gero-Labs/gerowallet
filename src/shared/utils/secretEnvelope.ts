import { argon2id } from '@noble/hashes/argon2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { toB64url, fromB64url } from './mpc/base64url';

/**
 * `gpw2` — the versioned, purpose-bound envelope for every secret the wallet
 * stores under the spending password (root key, mnemonic, MPC device share,
 * 2FA data, SPO cold key, Strike key).
 *
 *   gpw2.<base64url( header || ciphertext+tag )>
 *   header = version(1)=2 | purpose(1) | kdf(1)=1 (Argon2id) | t(u32 BE) | m KiB(u32 BE) | p(u32 BE) | salt(16) | nonce(24)
 *   key    = Argon2id(utf8(password), salt, t, m, p, dkLen 32)
 *   AEAD   = XChaCha20-Poly1305(key, nonce, aad = "gero-gpw2" || header)
 *
 * The whole header is AEAD associated data, so changing the KDF params or the
 * purpose byte fails authentication. The purpose byte binds a blob to the field
 * it was written for: a reader states the purpose it expects and a blob written
 * for another field (e.g. a mnemonic blob copied into the root-key slot) is
 * rejected. KDF params are range-checked BEFORE running Argon2id so a crafted
 * blob cannot pin or OOM the service worker.
 *
 * Readers for the older formats (`gpw1`, raw-hex PBKDF2, legacy crypto-ts) live
 * in `crypto.ts`, which dispatches on format. This module only knows `gpw2`.
 */

export const SecretPurpose = {
  RootKey: 1,
  Mnemonic: 2,
  MpcShare: 3,
  SecurityData: 4,
  ColdKey: 5,
  StrikeKey: 6,
} as const;
export type SecretPurpose = typeof SecretPurpose[keyof typeof SecretPurpose];

export interface Argon2Params {
  t: number;
  m: number; // KiB
  p: number;
}

const PREFIX = 'gpw2';
const VERSION = 2;
const KDF_ARGON2ID = 1;
const SALT_LEN = 16;
const NONCE_LEN = 24;
const KEY_LEN = 32;
// version | purpose | kdf | t | m | p | salt | nonce
const HEADER_LEN = 1 + 1 + 1 + 4 + 4 + 4 + SALT_LEN + NONCE_LEN; // 55
const AAD_LABEL = new TextEncoder().encode('gero-gpw2');

/**
 * Accepted Argon2id cost range on read (and write). The floor follows the OWASP
 * minimums at p=1: m≥19 MiB with t≥2, or m≥46 MiB with t=1. A blob with weaker
 * params is refused; the ceiling bounds the memory/time a hostile blob can demand.
 */
export const GPW2_BOUNDS = {
  tMin: 1,
  tMax: 10,
  mMin: 19_456,
  mMinAtT1: 47_104,
  mMax: 262_144, // 256 MiB
  p: 1,
} as const;

/**
 * Write params. Provisional: OWASP baseline, identical to `gpw1`. The final
 * value is pinned after benchmarking Argon2id in the MV3 service worker on the
 * lowest supported device; raising it later is non-breaking because readers take
 * the params from the header.
 */
export const GPW2_WRITE_PARAMS: Readonly<Argon2Params> = { t: 2, m: 19_456, p: 1 };

const ALL_PURPOSES = new Set<number>(Object.values(SecretPurpose));

export function isGpw2(blob: unknown): blob is string {
  return typeof blob === 'string' && blob.startsWith(`${PREFIX}.`);
}

/**
 * Throw unless Argon2id params are inside `GPW2_BOUNDS`. Also used by the `gpw1`
 * reader, whose header carries the same params: check BEFORE deriving the key.
 */
export function assertArgon2Params({ t, m, p }: Argon2Params): void {
  const ok =
    Number.isInteger(t) && Number.isInteger(m) && Number.isInteger(p) &&
    t >= GPW2_BOUNDS.tMin && t <= GPW2_BOUNDS.tMax &&
    m >= (t === 1 ? GPW2_BOUNDS.mMinAtT1 : GPW2_BOUNDS.mMin) && m <= GPW2_BOUNDS.mMax &&
    p === GPW2_BOUNDS.p;
  if (!ok) throw new Error('Secret envelope KDF parameters out of range');
}

function aadFor(header: Uint8Array): Uint8Array {
  const aad = new Uint8Array(AAD_LABEL.length + header.length);
  aad.set(AAD_LABEL, 0);
  aad.set(header, AAD_LABEL.length);
  return aad;
}

function deriveKey(password: string, salt: Uint8Array, { t, m, p }: Argon2Params): Uint8Array {
  return argon2id(new TextEncoder().encode(password), salt, { t, m, p, dkLen: KEY_LEN });
}

/** Seal bytes under a password for one purpose. */
export function sealGpw2(
  plaintext: Uint8Array,
  password: string,
  purpose: SecretPurpose,
  params: Argon2Params = GPW2_WRITE_PARAMS,
): string {
  if (!password) throw new Error('Password cannot be empty');
  if (!ALL_PURPOSES.has(purpose)) throw new Error('Unknown secret purpose');
  assertArgon2Params(params);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const header = new Uint8Array(HEADER_LEN);
  const view = new DataView(header.buffer);
  header[0] = VERSION;
  header[1] = purpose;
  header[2] = KDF_ARGON2ID;
  view.setUint32(3, params.t, false);
  view.setUint32(7, params.m, false);
  view.setUint32(11, params.p, false);
  header.set(salt, 15);
  header.set(nonce, 15 + SALT_LEN);

  const key = deriveKey(password, salt, params);
  const sealed = xchacha20poly1305(key, nonce, aadFor(header)).encrypt(plaintext);

  const blob = new Uint8Array(HEADER_LEN + sealed.length);
  blob.set(header, 0);
  blob.set(sealed, HEADER_LEN);
  return `${PREFIX}.${toB64url(blob)}`;
}

/** Seal a UTF-8 string. */
export function sealGpw2Text(plaintext: string, password: string, purpose: SecretPurpose): string {
  return sealGpw2(new TextEncoder().encode(plaintext), password, purpose);
}

/**
 * Open a `gpw2` blob written for `purpose`. Throws on a wrong password,
 * tampering, a purpose mismatch, an unknown version/KDF, or out-of-range params.
 * Never returns partial output.
 */
export function openGpw2(blob: string, password: string, purpose: SecretPurpose): Uint8Array {
  if (!password) throw new Error('Password cannot be empty');
  if (!isGpw2(blob)) throw new Error('Not a gpw2 secret blob');

  const raw = fromB64url(blob.slice(PREFIX.length + 1));
  if (raw.length < HEADER_LEN + 16) throw new Error('Malformed secret blob');
  if (raw[0] !== VERSION) throw new Error('Unsupported secret envelope version');
  if (raw[1] !== purpose) throw new Error('Secret envelope purpose mismatch');
  if (raw[2] !== KDF_ARGON2ID) throw new Error('Unsupported secret envelope KDF');

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const params: Argon2Params = {
    t: view.getUint32(3, false),
    m: view.getUint32(7, false),
    p: view.getUint32(11, false),
  };
  assertArgon2Params(params);

  const header = raw.slice(0, HEADER_LEN);
  const salt = header.subarray(15, 15 + SALT_LEN);
  const nonce = header.subarray(15 + SALT_LEN, HEADER_LEN);
  const key = deriveKey(password, salt, params);
  // Throws on an invalid tag: wrong password, tampered header or ciphertext.
  return xchacha20poly1305(key, nonce, aadFor(header)).decrypt(raw.subarray(HEADER_LEN));
}

/** Open a `gpw2` blob holding UTF-8 text. Malformed UTF-8 throws. */
export function openGpw2Text(blob: string, password: string, purpose: SecretPurpose): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(openGpw2(blob, password, purpose));
}

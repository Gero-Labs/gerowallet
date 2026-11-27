/**
 * Jubjub secret scalars and Jubjub Schnorr signatures, exactly as `jubjubSchnorrVerify<1>`
 * checks them in the vault circuits.
 *
 * - Secret scalar from a child key `k` (32 bytes), by wide reduction:
 *   `sk = LE2IP(BLAKE2b-512("gero-vault/v1|midnight|jubjub-sk|" || k)) mod r_J`, refusing 0.
 *   Reducing 64 bytes keeps the bias below 2^-250; reducing 32 bytes would not.
 * - Hedged deterministic nonce:
 *   `r = LE2IP(BLAKE2b-512("gero-vault/v1|midnight|jubjub-nonce|" || LE32(sk) || LE32(digest) || rand32)) mod r_J`,
 *   refusing 0. A broken random source then cannot repeat a nonce for two digests, and a repeated
 *   `rand32` gives the same signature rather than a leaked key.
 * - Signature over a field element `digest`: `R = r * G`,
 *   `c = transientHash([R.x, R.y, pk.x, pk.y, digest]) mod r_J`, `s = r + c * sk mod r_J`.
 * - Verification (`checkJubjubSignature`, which says why it refuses): `s < r_J`, `R` on the curve,
 *   `pk` a validated key, and `s * G = R + c * pk`. The key check is not optional: under the
 *   identity or a key with a small-order component, signatures are easy to forge.
 *
 * BigInt arithmetic is not constant time; that is accepted for a software wallet signing a few
 * statements and is part of the client-code audit scope.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { MidnightKeyError } from './errors';
import { concatBytes, le2ip, le32, utf8Bytes } from './bytes';
import { addPoints, affine, checkJubjubPoint, isOnJubjubCurve, jubjubMulGenerator, jubjubPointsEqual, mulGeneratorPublic, mulPublic, snapshotJubjubPoint } from './jubjub';
import { isFieldElement, transientHash } from './poseidon';
import { FieldElement, JUBJUB_SCALAR_MODULUS, JubjubKeyPair, JubjubPoint, JubjubPublicKey, JubjubSecretKey, JubjubSignature } from './types';

export const JUBJUB_SK_TAG = 'gero-vault/v1|midnight|jubjub-sk|';
export const JUBJUB_NONCE_TAG = 'gero-vault/v1|midnight|jubjub-nonce|';

const RJ = JUBJUB_SCALAR_MODULUS;

/**
 * The Jubjub scalar of a 64-byte wide hash output, `LE2IP(wide) mod r_J`. Throws
 * `MidnightKeyError('ZERO_SCALAR')` for 0: the caller moves to the next index (or, for a nonce,
 * draws new randomness).
 */
export function scalarFromWideHash(wide: Uint8Array): bigint {
  if (!(wide instanceof Uint8Array) || wide.length !== 64) throw new MidnightKeyError('INVALID_SCALAR', 'A wide hash is 64 bytes');
  const s = le2ip(wide) % RJ;
  if (s === 0n) throw new MidnightKeyError('ZERO_SCALAR', 'The scalar is 0');
  return s;
}

function assertChildKey(k: Uint8Array): void {
  if (!(k instanceof Uint8Array) || k.length !== 32) throw new MidnightKeyError('INVALID_CHILD_KEY', 'A child key is 32 bytes');
}

/** The Jubjub secret scalar of a 32-byte child key. Throws `ZERO_SCALAR` (use the next index). */
export function jubjubSecretFromChildKey(k: Uint8Array): JubjubSecretKey {
  assertChildKey(k);
  const preimage = concatBytes(utf8Bytes(JUBJUB_SK_TAG), k);
  let wide: Uint8Array | undefined;
  try {
    wide = blake2b(preimage, { dkLen: 64 });
    return scalarFromWideHash(wide) as JubjubSecretKey;
  } finally {
    preimage.fill(0);
    wide?.fill(0);
  }
}

export function isJubjubSecretKey(sk: unknown): sk is JubjubSecretKey {
  return typeof sk === 'bigint' && sk > 0n && sk < RJ;
}

function assertSecret(sk: unknown): asserts sk is JubjubSecretKey {
  if (!isJubjubSecretKey(sk)) throw new MidnightKeyError('INVALID_SCALAR', 'A Jubjub secret key is from 1 below r_J');
}

/** The key pair of a secret scalar: `pk = sk * G`. */
export function jubjubKeyPair(sk: JubjubSecretKey): JubjubKeyPair {
  assertSecret(sk);
  return Object.freeze({ secretKey: sk, publicKey: jubjubMulGenerator(sk) as JubjubPublicKey });
}

/** The key pair of a 32-byte child key. */
export function jubjubKeyPairFromChildKey(k: Uint8Array): JubjubKeyPair {
  return jubjubKeyPair(jubjubSecretFromChildKey(k));
}

function assertDigest(digest: unknown): asserts digest is FieldElement {
  if (!isFieldElement(digest)) throw new MidnightKeyError('INVALID_FIELD_ELEMENT', 'A digest is a field element');
}

function assertRand(rand32: unknown): asserts rand32 is Uint8Array {
  if (!(rand32 instanceof Uint8Array) || rand32.length !== 32) throw new MidnightKeyError('INVALID_RANDOMNESS', 'The hedging randomness is 32 bytes');
}

/** The hedged deterministic nonce. Throws `ZERO_SCALAR` (draw new randomness). */
export function hedgedNonce(sk: JubjubSecretKey, digest: FieldElement, rand32: Uint8Array): bigint {
  assertSecret(sk);
  assertDigest(digest);
  assertRand(rand32);
  const skBytes = le32(sk);
  const preimage = concatBytes(utf8Bytes(JUBJUB_NONCE_TAG), skBytes, le32(digest), rand32);
  let wide: Uint8Array | undefined;
  try {
    wide = blake2b(preimage, { dkLen: 64 });
    return scalarFromWideHash(wide);
  } finally {
    skBytes.fill(0);
    preimage.fill(0);
    wide?.fill(0);
  }
}

/** The challenge `transientHash([R.x, R.y, pk.x, pk.y, digest]) mod r_J`. */
export function jubjubChallenge(announcement: JubjubPoint, publicKey: JubjubPoint, digest: FieldElement): bigint {
  return transientHash([announcement.x, announcement.y, publicKey.x, publicKey.y, digest]) % RJ;
}

/**
 * Signs `digest` (a field element: a statement digest, or a key card digest reduced into the
 * field). `rand32` defaults to 32 fresh random bytes; pass it only for test vectors.
 */
export function jubjubSign(sk: JubjubSecretKey, digest: FieldElement, rand32: Uint8Array = randomBytes(32)): JubjubSignature {
  assertSecret(sk);
  assertDigest(digest);
  assertRand(rand32);
  const r = hedgedNonce(sk, digest, rand32);
  const announcement = jubjubMulGenerator(r);
  const publicKey = jubjubMulGenerator(sk);
  const c = jubjubChallenge(announcement, publicKey, digest);
  return Object.freeze({ announcement, response: (r + c * sk) % RJ });
}

/**
 * Why a Jubjub signature does not verify, in the order checked:
 * - `DIGEST_NOT_A_FIELD_ELEMENT`;
 * - `MALFORMED`: not a signature object (or anything else that fails to compute);
 * - `RESPONSE_OUT_OF_RANGE`: `s` is not from 0 below `r_J` (`s + r_J` is the same scalar, refused
 *   so a signature has one form only);
 * - `ANNOUNCEMENT_NOT_ON_CURVE`: `R` is off the curve or has a coordinate from the modulus up;
 * - `INVALID_KEY`: the public key fails point validation (`checkJubjubPoint`). Without this check
 *   a signature under the identity or a small-order key is easy to forge;
 * - `MISMATCH`: `s * G` differs from `R + c * pk`.
 */
export type JubjubSignatureRefusal = 'DIGEST_NOT_A_FIELD_ELEMENT' | 'MALFORMED' | 'RESPONSE_OUT_OF_RANGE' | 'ANNOUNCEMENT_NOT_ON_CURVE' | 'INVALID_KEY' | 'MISMATCH';

/**
 * Checks that `signature` is `publicKey`'s signature over `digest`, and says why not. Never
 * throws. Every value is read once from the caller's objects; the checks and the arithmetic use
 * only the validated copies.
 */
export function checkJubjubSignature(publicKey: unknown, digest: unknown, signature: unknown): { readonly ok: true } | { readonly ok: false; readonly code: JubjubSignatureRefusal } {
  const refuse = (code: JubjubSignatureRefusal) => ({ ok: false, code }) as const;
  try {
    if (!isFieldElement(digest)) return refuse('DIGEST_NOT_A_FIELD_ELEMENT');
    if (!signature || typeof signature !== 'object') return refuse('MALFORMED');
    const response = (signature as JubjubSignature).response;
    const announcement = snapshotJubjubPoint((signature as JubjubSignature).announcement);
    if (typeof response !== 'bigint' || !announcement) return refuse('MALFORMED');
    if (response < 0n || response >= RJ) return refuse('RESPONSE_OUT_OF_RANGE');
    if (!isOnJubjubCurve(announcement)) return refuse('ANNOUNCEMENT_NOT_ON_CURVE');
    const key = checkJubjubPoint(publicKey);
    if (key.ok === false) return refuse('INVALID_KEY');
    const c = jubjubChallenge(announcement, key.key, digest);
    const equal = jubjubPointsEqual(addPoints(mulPublic(key.key, c), announcement), affine(mulGeneratorPublic(response)));
    return equal ? { ok: true } : refuse('MISMATCH');
  } catch {
    return refuse('MALFORMED');
  }
}

/** Whether `signature` is `publicKey`'s signature over `digest` (`checkJubjubSignature` passes). Never throws. */
export function jubjubVerify(publicKey: JubjubPublicKey | JubjubPoint, digest: FieldElement | bigint, signature: JubjubSignature): boolean {
  return checkJubjubSignature(publicKey, digest, signature).ok === true;
}

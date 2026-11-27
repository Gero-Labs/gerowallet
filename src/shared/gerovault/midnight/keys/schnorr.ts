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
 * - Verification: `s < r_J`, `R` on the curve, `pk` a validated key, and `s * G = R + c * pk`.
 *
 * BigInt arithmetic is not constant time; that is accepted for a software wallet signing a few
 * statements and is part of the client-code audit scope.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { MidnightKeyError } from './errors';
import { concatBytes, le2ip, le32, utf8Bytes } from './bytes';
import { addPoints, affine, checkJubjubPoint, isOnJubjubCurve, jubjubMulGenerator, jubjubPointsEqual, mulGeneratorPublic, mulPublic } from './jubjub';
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
  return scalarFromWideHash(blake2b(concatBytes(utf8Bytes(JUBJUB_SK_TAG), k), { dkLen: 64 })) as JubjubSecretKey;
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
  return scalarFromWideHash(blake2b(concatBytes(utf8Bytes(JUBJUB_NONCE_TAG), le32(sk), le32(digest), rand32), { dkLen: 64 }));
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

/** Whether `signature` is `publicKey`'s signature over `digest`. Never throws. */
export function jubjubVerify(publicKey: JubjubPublicKey | JubjubPoint, digest: FieldElement | bigint, signature: JubjubSignature): boolean {
  try {
    if (!isFieldElement(digest) || !signature || typeof signature !== 'object') return false;
    const { announcement, response } = signature;
    if (typeof response !== 'bigint' || response < 0n || response >= RJ) return false;
    if (!isOnJubjubCurve(announcement)) return false;
    if (checkJubjubPoint(publicKey).ok !== true) return false;
    const c = jubjubChallenge(announcement, publicKey, digest);
    return jubjubPointsEqual(addPoints(mulPublic(publicKey, c), announcement), affine(mulGeneratorPublic(response)));
  } catch {
    return false;
  }
}

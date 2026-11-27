/**
 * The owner upgrade key: BIP-340 Schnorr on secp256k1. The 32-byte BIP-32 child key at role `1'`
 * is itself the signing key, and its public key is the 32-byte x-only key, as the ledger's
 * `signatureVerifyingKey({ tag: 'schnorr', value })` returns it.
 *
 * Signatures follow the ledger's `signData({ tag: 'schnorr', value }, data)` exactly, so the
 * ledger verifies what this module signs (a maintenance update's `dataToSign`) and this module
 * verifies what the ledger signs: the BIP-340 message is `SHA-256(data)`, never `data` itself.
 * `upgradeKey.spec.ts` checks both directions against ledger-v9.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { MidnightKeyError } from './errors';
import { fromHex, toHex } from './bytes';
import { UpgradeKeyPair, UpgradePublicKeyHex } from './types';

const XONLY = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[0-9a-f]{128}$/;

/** Whether `hex` is an x-only public key that lifts to a secp256k1 point. Never throws. */
export function isUpgradePublicKey(hex: unknown): hex is UpgradePublicKeyHex {
  if (typeof hex !== 'string' || !XONLY.test(hex)) return false;
  try {
    schnorr.utils.lift_x(BigInt(`0x${hex}`));
    return true;
  } catch {
    return false;
  }
}

/** `hex` as an upgrade public key. Throws `MidnightKeyError('INVALID_UPGRADE_KEY')`. */
export function upgradePublicKey(hex: string): UpgradePublicKeyHex {
  if (!isUpgradePublicKey(hex)) throw new MidnightKeyError('INVALID_UPGRADE_KEY', 'An upgrade key is a 32-byte x-only secp256k1 key in lowercase hex');
  return hex;
}

function assertSecret(k: unknown): asserts k is Uint8Array {
  if (!(k instanceof Uint8Array) || k.length !== 32) throw new MidnightKeyError('INVALID_CHILD_KEY', 'An upgrade secret key is 32 bytes');
}

/** The upgrade key pair of a 32-byte child key. The secret is a copy: wipe both when done. */
export function upgradeKeyPairFromChildKey(k: Uint8Array): UpgradeKeyPair {
  assertSecret(k);
  let publicKey: Uint8Array;
  try {
    publicKey = schnorr.getPublicKey(k);
  } catch {
    throw new MidnightKeyError('INVALID_CHILD_KEY', 'The child key is not a secp256k1 secret key');
  }
  return Object.freeze({ secretKey: Uint8Array.from(k), publicKey: toHex(publicKey) as UpgradePublicKeyHex });
}

/**
 * The ledger's Schnorr signature over `data`: BIP-340 over `SHA-256(data)`, 64 bytes as hex.
 * `aux32` is BIP-340's auxiliary randomness, fresh by default; pass it only for test vectors.
 */
export function signUpgrade(secretKey: Uint8Array, data: Uint8Array, aux32: Uint8Array = randomBytes(32)): string {
  assertSecret(secretKey);
  if (!(data instanceof Uint8Array)) throw new TypeError('Signed data is bytes');
  if (!(aux32 instanceof Uint8Array) || aux32.length !== 32) throw new MidnightKeyError('INVALID_RANDOMNESS', 'BIP-340 auxiliary randomness is 32 bytes');
  return toHex(schnorr.sign(sha256(data), secretKey, aux32));
}

/** Whether `signature` (64 bytes, hex) is the ledger-style Schnorr signature of `publicKey` over `data`. Never throws. */
export function verifyUpgrade(publicKey: UpgradePublicKeyHex | string, data: Uint8Array, signature: string): boolean {
  try {
    if (!isUpgradePublicKey(publicKey) || typeof signature !== 'string' || !SIGNATURE.test(signature) || !(data instanceof Uint8Array)) return false;
    return schnorr.verify(fromHex(signature, 64) as Uint8Array, sha256(data), fromHex(publicKey, 32) as Uint8Array);
  } catch {
    return false;
  }
}

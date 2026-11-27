/**
 * The guardian salt and commitment.
 *
 * - Salt: `BLAKE2b-256("gero-vault/v1|midnight|guardian-salt|" || k_guardian)`, where `k_guardian`
 *   is the guardian's 32-byte BIP-32 child key at role `2'`. A guardian therefore rebuilds key and
 *   salt from the seed and the index alone, and finds its own slot in any vault's recovery config
 *   without a backup file. The salt is exactly as secret as the key. Enrolling again with a fresh
 *   salt means a new index.
 * - Commitment: the contract's `guardianCommitment(key, salt)`, `transientHash` of
 *   `{ domain: pad(32, "midnight-vault:guardian:v1"), kx, ky, salt }`. Only commitments are
 *   stored on chain; owners hold the keys and salts.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { MidnightKeyError } from './errors';
import { concatBytes, pad32, utf8Bytes } from './bytes';
import { bytes32Fields, transientHash } from './poseidon';
import { jubjubPublicKey } from './jubjub';
import { FieldElement, JubjubPoint } from './types';

export const GUARDIAN_SALT_TAG = 'gero-vault/v1|midnight|guardian-salt|';
export const GUARDIAN_COMMITMENT_DOMAIN = 'midnight-vault:guardian:v1';

/** The guardian salt of a guardian child key (32 bytes). */
export function guardianSalt(guardianChildKey: Uint8Array): Uint8Array {
  if (!(guardianChildKey instanceof Uint8Array) || guardianChildKey.length !== 32) {
    throw new MidnightKeyError('INVALID_CHILD_KEY', 'A guardian child key is 32 bytes');
  }
  const preimage = concatBytes(utf8Bytes(GUARDIAN_SALT_TAG), guardianChildKey);
  try {
    return blake2b(preimage, { dkLen: 32 });
  } finally {
    preimage.fill(0);
  }
}

/**
 * `guardianCommitment(key, salt)` as the contract computes it. The key must pass point
 * validation (throws `INVALID_POINT`), the salt is 32 bytes (throws `INVALID_SALT`).
 */
export function guardianCommitment(key: JubjubPoint, salt: Uint8Array): FieldElement {
  const k = jubjubPublicKey(key);
  if (!(salt instanceof Uint8Array) || salt.length !== 32) throw new MidnightKeyError('INVALID_SALT', 'A guardian salt is 32 bytes');
  return transientHash([...bytes32Fields(pad32(GUARDIAN_COMMITMENT_DOMAIN)), k.x, k.y, ...bytes32Fields(salt)]);
}

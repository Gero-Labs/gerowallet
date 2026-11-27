/**
 * Derivation of a participant's own vault keys from the BIP-39 seed (`paths.ts` for the path):
 *
 * - `k`: the 32-byte BIP-32 child private key at `m/1854'/2400'/n'/r'/i'` (`@scure/bip32`, the
 *   library the Midnight wallet SDK uses);
 * - Jubjub roles (approval, guardian, delegate): `sk` by wide hash-to-scalar of `k`, `pk = sk * G`
 *   (`schnorr.ts`);
 * - upgrade role: `k` itself is the BIP-340 key (`upgradeKey.ts`);
 * - guardian: also its salt and commitment (`guardian.ts`).
 *
 * The seed is the 64-byte BIP-39 seed of the phrase with an empty passphrase. Derive in the
 * background only, and wipe what comes back (`wipeOwnerKeys` and friends) once used: the child
 * keys and the upgrade secret are bytes and are zeroed; Jubjub scalars are BigInts, which no
 * JavaScript engine can wipe, so they are kept short-lived instead.
 *
 * A Jubjub scalar of 0 (probability about 2^-252) throws `MidnightKeyError('ZERO_SCALAR')`: the
 * caller allocates the next index.
 */
import { HDKey } from '@scure/bip32';
import { MidnightKeyError } from './errors';
import { midnightKeyPath } from './paths';
import { jubjubKeyPairFromChildKey } from './schnorr';
import { upgradeKeyPairFromChildKey } from './upgradeKey';
import { guardianCommitment, guardianSalt } from './guardian';
import { FieldElement, JubjubKeyPair, MidnightKeyRole, MidnightNetwork, UpgradeKeyPair } from './types';

export const BIP39_SEED_BYTES = 64;

/**
 * The 32-byte child private key at `m/1854'/2400'/n'/r'/i'`. A fresh copy: wipe it when done.
 * Throws `INVALID_SEED`, `INVALID_NETWORK`, `INVALID_ROLE` or `INVALID_INDEX`.
 */
export function midnightChildKey(seed: Uint8Array, network: MidnightNetwork, role: MidnightKeyRole, index: number): Uint8Array {
  if (!(seed instanceof Uint8Array) || seed.length !== BIP39_SEED_BYTES) throw new MidnightKeyError('INVALID_SEED', 'The seed is the 64-byte BIP-39 seed');
  const path = midnightKeyPath(network, role, index);
  const nodes: HDKey[] = [];
  try {
    let node = HDKey.fromMasterSeed(seed);
    nodes.push(node);
    for (const level of path) {
      node = node.deriveChild(level);
      nodes.push(node);
    }
    if (!node.privateKey || node.privateKey.length !== 32) throw new MidnightKeyError('INVALID_CHILD_KEY', 'No private key at the path');
    return Uint8Array.from(node.privateKey);
  } catch (e) {
    if (e instanceof MidnightKeyError) throw e;
    throw new MidnightKeyError('INVALID_CHILD_KEY', 'BIP-32 derivation failed at the path');
  } finally {
    for (const n of nodes) n.wipePrivateData();
  }
}

/** An owner's keys for one vault: approval and upgrade at the same index. */
export interface OwnerKeys {
  readonly network: MidnightNetwork;
  readonly index: number;
  readonly approval: JubjubKeyPair;
  readonly upgrade: UpgradeKeyPair;
}

/** A guardian's key, salt and commitment for one vault. */
export interface GuardianKeys {
  readonly network: MidnightNetwork;
  readonly index: number;
  readonly key: JubjubKeyPair;
  /** Secret, as secret as the key: wipe it when done. */
  readonly salt: Uint8Array;
  readonly commitment: FieldElement;
}

/** A delegate's key for one vault. */
export interface DelegateKeys {
  readonly network: MidnightNetwork;
  readonly index: number;
  readonly key: JubjubKeyPair;
}

function withChildKey<T>(seed: Uint8Array, network: MidnightNetwork, role: MidnightKeyRole, index: number, use: (k: Uint8Array) => T): T {
  const k = midnightChildKey(seed, network, role, index);
  try {
    return use(k);
  } finally {
    k.fill(0);
  }
}

/** The approval key at role `0'` and the upgrade key at role `1'`, both at `index`. */
export function deriveOwnerKeys(seed: Uint8Array, network: MidnightNetwork, index: number): OwnerKeys {
  const approval = withChildKey(seed, network, 'approval', index, jubjubKeyPairFromChildKey);
  const upgrade = withChildKey(seed, network, 'upgrade', index, upgradeKeyPairFromChildKey);
  return Object.freeze({ network, index, approval, upgrade });
}

/** The guardian key at role `2'`, its salt and its commitment. */
export function deriveGuardianKeys(seed: Uint8Array, network: MidnightNetwork, index: number): GuardianKeys {
  return withChildKey(seed, network, 'guardian', index, k => {
    const key = jubjubKeyPairFromChildKey(k);
    const salt = guardianSalt(k);
    return Object.freeze({ network, index, key, salt, commitment: guardianCommitment(key.publicKey, salt) });
  });
}

/** The delegate key at role `3'`. */
export function deriveDelegateKeys(seed: Uint8Array, network: MidnightNetwork, index: number): DelegateKeys {
  const key = withChildKey(seed, network, 'delegate', index, jubjubKeyPairFromChildKey);
  return Object.freeze({ network, index, key });
}

/** Zeroes the owner's upgrade secret. */
export function wipeOwnerKeys(keys: OwnerKeys): void {
  keys?.upgrade?.secretKey?.fill(0);
}

/** Zeroes the guardian's salt. */
export function wipeGuardianKeys(keys: GuardianKeys): void {
  keys?.salt?.fill(0);
}

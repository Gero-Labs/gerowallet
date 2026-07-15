import { split, combine } from 'shamir-secret-sharing';
import { MpcError } from './types';

export const TOTAL_SHARES = 3;
export const THRESHOLD = 2;

/** Split BIP39 entropy into TOTAL_SHARES shares; any THRESHOLD reconstruct. */
export async function splitEntropy(entropy: Uint8Array): Promise<Uint8Array[]> {
  if (entropy.length === 0) {
    throw new MpcError('entropy must be non-empty');
  }
  // shamir-secret-sharing: split(secret, totalShares, threshold)
  return split(entropy, TOTAL_SHARES, THRESHOLD);
}

/** Reconstruct the secret from THRESHOLD-or-more shares (each carries its index). */
export async function combineShares(shares: Uint8Array[]): Promise<Uint8Array> {
  if (shares.length < THRESHOLD) {
    throw new MpcError(`need at least ${THRESHOLD} shares to reconstruct`);
  }
  return combine(shares);
}

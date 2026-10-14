import { splitEntropy, combineShares } from './shamir';
import { encodeShare, decodeShare } from './shareCodec';
import { MpcValidationError, ShareRole } from './types';

export interface MpcShareSet {
  /** Stored locally on the enrolled device. */
  deviceShare: string;
  /** Sent to gero-backend, released only after Google JWT verification. */
  loginShare: string;
  /** Presented to the user to back up (later password-encrypted for download). */
  recoveryShare: string;
}

/** Split entropy into a role-tagged, encoded 2-of-3 share set. */
export async function createMpcShareSet(entropy: Uint8Array): Promise<MpcShareSet> {
  const [device, login, recovery] = await splitEntropy(entropy);
  return {
    deviceShare: encodeShare(ShareRole.Device, device),
    loginShare: encodeShare(ShareRole.Login, login),
    recoveryShare: encodeShare(ShareRole.Recovery, recovery),
  };
}

/** Reconstruct entropy from any two encoded shares (role is metadata; index is in the bytes). */
export async function reconstructEntropy(encodedA: string, encodedB: string): Promise<Uint8Array> {
  const a = decodeShare(encodedA).share;
  const b = decodeShare(encodedB).share;
  // One split never repeats a coordinate (the last byte), so a repeat means the
  // shares come from different splits, e.g. a login share from the wrong Google
  // account. Report the same mismatch the xpub check would, not a raw Shamir error.
  if (a[a.length - 1] === b[b.length - 1]) {
    throw new MpcValidationError('shares are not a valid pair for this wallet');
  }
  return combineShares([a, b]);
}

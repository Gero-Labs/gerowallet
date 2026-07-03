import * as bip39 from 'bip39';
import { reconstructEntropy } from './mpcShares';
import { MpcValidationError } from './types';
import { derivePublicKeyFromMnemonic } from '@/db/gero-db';

export function entropyToMnemonic(entropy: Uint8Array): string {
  return bip39.entropyToMnemonic(Buffer.from(entropy));
}

export function mnemonicToEntropyBytes(mnemonic: string): Uint8Array {
  return new Uint8Array(Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex'));
}

/** Derive the account-0 CIP-1852 bech32 xpub that a given entropy yields. */
export async function deriveExpectedXpub(entropy: Uint8Array): Promise<string> {
  return derivePublicKeyFromMnemonic(entropyToMnemonic(entropy));
}

/**
 * Reconstruct entropy from two encoded shares and VALIDATE it against the
 * enrolled wallet's expected xpub. Shamir combine has no cross-share binding —
 * mismatched shares reconstruct to a wrong secret silently — so this check is
 * mandatory before the entropy is used to derive a signing key.
 * @throws MpcValidationError if the derived xpub does not match expectedXpub.
 */
export async function reconstructAndValidateEntropy(
  deviceShare: string,
  loginShare: string,
  expectedXpub: string,
  deriveXpub: (entropy: Uint8Array) => Promise<string> = deriveExpectedXpub,
): Promise<Uint8Array> {
  const entropy = await reconstructEntropy(deviceShare, loginShare);
  const xpub = await deriveXpub(entropy);
  if (xpub !== expectedXpub) {
    throw new MpcValidationError('reconstructed key does not match this wallet');
  }
  return entropy;
}

import { encrypt, decrypt } from '@/shared/utils/crypto';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { createMpcShareSet, type MpcShareSet } from './mpcShares';
import { deriveExpectedXpub, entropyToMnemonic, reconstructAndValidateEntropy } from './mpcKeys';

/** Generate a fresh wallet's entropy, split into 3 shares, and derive its expected xpub. */
export async function prepareMpcWalletCreation(): Promise<{
  entropy: Uint8Array; shareSet: MpcShareSet; expectedXpub: string;
}> {
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const shareSet = await createMpcShareSet(entropy);
  const expectedXpub = await deriveExpectedXpub(entropy);
  return { entropy, shareSet, expectedXpub };
}

/** At-rest encryption for the locally-stored device share (AES via existing util). */
export function encryptDeviceShare(deviceShare: string, password: string): string {
  return encrypt(deviceShare, password);
}
export function decryptDeviceShare(blob: string, password: string): string {
  return decrypt(blob, password);
}

/**
 * Reconstruct the Cardano root-key bytes for signing: decrypt the local device
 * share, combine with the backend login share, VALIDATE against the wallet's
 * expected xpub, then materialize the root key. Returns bytes suitable for
 * WalletBg.signTx(..., privateKeyBytes).
 */
export async function reconstructRootKeyBytes(
  encryptedDeviceShare: string,
  password: string,
  loginShare: string,
  expectedXpub: string,
): Promise<Uint8Array> {
  const deviceShare = decryptDeviceShare(encryptedDeviceShare, password);
  const entropy = await reconstructAndValidateEntropy(deviceShare, loginShare, expectedXpub);
  const rootKey = resolvePrivateKey(entropyToMnemonic(entropy));
  return rootKey.bytes();
}

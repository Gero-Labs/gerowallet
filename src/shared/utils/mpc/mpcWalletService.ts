import { resolvePrivateKey } from '@/shared/utils/resolver';
import { createMpcShareSet, type MpcShareSet } from './mpcShares';
import { deriveExpectedXpub, entropyToMnemonic, reconstructAndValidateEntropy } from './mpcKeys';
import { decryptDeviceShare, type DeviceShareSecret } from './deviceShareCipher';

/** Generate a fresh wallet's entropy, split into 3 shares, and derive its expected xpub. */
export async function prepareMpcWalletCreation(): Promise<{
  entropy: Uint8Array; shareSet: MpcShareSet; expectedXpub: string;
}> {
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const shareSet = await createMpcShareSet(entropy);
  const expectedXpub = await deriveExpectedXpub(entropy);
  return { entropy, shareSet, expectedXpub };
}

/**
 * Reconstruct the Cardano root-key bytes for signing: decrypt the local device
 * share (passkey PRF or password), combine with the backend login share,
 * VALIDATE against the wallet's expected xpub, then materialize the root key.
 */
export async function reconstructRootKeyBytes(
  encryptedDeviceShare: string,
  secret: DeviceShareSecret,
  loginShare: string,
  expectedXpub: string,
): Promise<Uint8Array> {
  const deviceShare = await decryptDeviceShare(encryptedDeviceShare, secret);
  const entropy = await reconstructAndValidateEntropy(deviceShare, loginShare, expectedXpub);
  const rootKey = resolvePrivateKey(entropyToMnemonic(entropy));
  return rootKey.bytes();
}

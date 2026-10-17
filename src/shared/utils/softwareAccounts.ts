// Accounts of a software wallet (recovery phrase, PassKey or Google), derived
// from its root key. Each account's xpub is what its record stores and what
// signing checks the derived account key against (deriveSigningAccountKey).
import * as bip39 from 'bip39';
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { CoinTypes, HARDENED, WalletTypePurpose } from '@/models/types';
import { accountXpub, assertAccountIndices, cardanoAccountPath, type AccountXpub } from './walletAccount';

/** The CIP-1852 account xpubs of `rootKey` at `accountIndices`. */
export async function deriveAccountXpubs(rootKey: Bip32PrivateKey, accountIndices: number[]): Promise<AccountXpub[]> {
  await ready();
  return assertAccountIndices(accountIndices).map((index) => {
    const hex = rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index]).toPublic().hex();
    return accountXpub(hex.slice(0, 64), hex.slice(64), cardanoAccountPath(index));
  });
}

/** The same, from a recovery phrase held during a restore. */
export async function deriveAccountXpubsFromMnemonic(mnemonic: string, accountIndices: number[]): Promise<AccountXpub[]> {
  await ready();
  const rootKey = Bip32PrivateKey.fromBip39Entropy(Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex'), '');
  return deriveAccountXpubs(rootKey, accountIndices);
}

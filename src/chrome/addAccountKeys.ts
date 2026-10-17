// "Add account" for a recovery-phrase or Google wallet: the xpub of one more of
// its accounts. The root key is decrypted with the spending password, or taken
// from the Google session the wallet was unlocked with, here in the background;
// only the account's public key goes back to the page. A PassKey wallet derives
// in the page instead, where WebAuthn can run (the documented PRF exception).
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import type { Wallet } from '@/models/types';
import { assertAccountIndices, canAddAccounts, isHardwareWallet, secretsWallet } from '@/shared/utils/walletAccount';
import { deriveAccountXpubs } from '@/shared/utils/softwareAccounts';

export type AddAccountErrorCode = 'not-found' | 'not-supported' | 'wrong-password' | 'locked';

export class AddAccountError extends Error {
  constructor(readonly code: AddAccountErrorCode) {
    super(`Could not derive the account: ${code}`);
    this.name = 'AddAccountError';
  }
}

export interface DeriveAccountXpubDeps {
  getWallets(): Promise<Record<number, Wallet>>;
  /** The root key an unlocked Google wallet's session holds (mpcSessionCache). */
  sessionRootKey(walletId: number): Uint8Array | undefined;
  /** The single reader for a stored root key (decryptPrivateKey); throws on a wrong password. */
  decryptRootKey(encryptedPrivateKey: string, password: string): Uint8Array;
}

/**
 * The bech32 xpub of account `accountIndex` of the wallet `walletId` belongs to.
 * The root key must derive the wallet's own account-#0 xpub, so a key from any
 * other wallet is refused. The root key copy is wiped before returning.
 */
export async function deriveAccountXpubFlow(
  input: { walletId: unknown; accountIndex: unknown; password?: unknown },
  deps: DeriveAccountXpubDeps,
): Promise<string> {
  const wallets = await deps.getWallets();
  const record = typeof input.walletId === 'number' ? wallets[input.walletId] : undefined;
  if (!record) throw new AddAccountError('not-found');
  const wallet = secretsWallet(record, wallets);
  if (!canAddAccounts(wallet) || isHardwareWallet(wallet)) throw new AddAccountError('not-supported');
  const [accountIndex] = assertAccountIndices([input.accountIndex]);
  if (accountIndex === 0) throw new AddAccountError('not-supported');

  let rootKeyBytes: Uint8Array;
  if (wallet.encryptionMethod === 'mpc') {
    const cached = deps.sessionRootKey(wallet.id);
    if (!cached) throw new AddAccountError('locked');
    rootKeyBytes = Uint8Array.from(cached);
  } else if (wallet.encryptionMethod !== 'prf' && wallet.encryptedPrivateKey) {
    if (typeof input.password !== 'string' || !input.password) throw new AddAccountError('wrong-password');
    let decrypted: Uint8Array;
    try {
      decrypted = deps.decryptRootKey(wallet.encryptedPrivateKey, input.password);
    } catch {
      throw new AddAccountError('wrong-password');
    }
    rootKeyBytes = Uint8Array.from(decrypted);
    decrypted.fill(0);
  } else {
    throw new AddAccountError('not-supported');
  }

  try {
    const [own, account] = await deriveAccountXpubs(Bip32PrivateKey.fromBytes(rootKeyBytes), [0, accountIndex]);
    if (own.publicKey.toLowerCase() !== wallet.publicKey?.toLowerCase()) throw new AddAccountError('not-supported');
    return account.publicKey;
  } finally {
    rootKeyBytes.fill(0);
  }
}

/**
 * Signing a vault transaction with this wallet's own vault key, in software, in the background
 * worker only (`signBundleFlow.ts`, `GEROVAULT_SIGN_VAULT_BUNDLE`): no page opens the root key.
 *
 * The key is the CIP-1854 payment key at `m/1854'/1815'/0'/0/i`, `i` being this wallet's own
 * index in the vault, derived from the wallet's root key. It must hash to the payment key the vault
 * record holds for this wallet; otherwise nothing is signed. Only the transaction id is signed.
 * Hardware wallets, PassKey (PRF) wallets and Google wallets do not sign here yet (`signerSupport`).
 *
 * Kept free of page-only imports: the background imports this file.
 */
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { CARDANO_COIN_TYPE, CIP146_ACCOUNT, CIP1854_PURPOSE, ROLE } from '@/shared/gerovault';
import type { VaultVkeyWitness } from '@/modules/gerovault/contracts';
import { withDerivedKey } from '@/modules/gerovault/keyWipe';
import { WalletType, type Wallet } from '@/models/types';
import { spendError } from './errors';

const HARDENED = 0x80000000;
const TX_ID = /^[0-9a-f]{64}$/;

/**
 * - `software`: a recovery-phrase wallet with a spending password: signs here.
 * - `hardware`: Ledger, Trezor or Keystone: vault signing on a device comes later.
 * - `passkey`: a PassKey (PRF) wallet: comes later.
 * - `none`: Google and watch wallets, and no wallet.
 */
export type VaultSignerSupport = 'software' | 'hardware' | 'passkey' | 'none';

export type SignerWallet = Pick<Wallet, 'type' | 'encryptionMethod' | 'prfEncryptedPrivateKey' | 'webAuthnCredentialId' | 'encryptedPrivateKey'>;

export function signerSupport(wallet: SignerWallet | null | undefined): VaultSignerSupport {
  if (!wallet) return 'none';
  if (wallet.type === WalletType.Ledger || wallet.type === WalletType.Trezor || wallet.type === WalletType.Keystone) return 'hardware';
  if (wallet.type !== WalletType.Normal) return 'none';
  if (wallet.encryptionMethod === 'prf' || (!!wallet.prfEncryptedPrivateKey && !!wallet.webAuthnCredentialId)) return 'passkey';
  if (wallet.encryptionMethod === 'mpc') return 'none';
  return wallet.encryptedPrivateKey ? 'software' : 'none';
}

/**
 * Signs `txId` with the payment key at `m/1854'/1815'/0'/0/ownIndex` of `rootKeyBytes`, after
 * checking that key hashes to `expectedCredential`. Throws `KEY_MISMATCH` otherwise. Every private
 * key derived on the way, and the signing key, are overwritten before this returns; the caller owns
 * `rootKeyBytes` and overwrites them.
 */
export async function signWithRootKey(
  rootKeyBytes: Uint8Array,
  ownIndex: number,
  expectedCredential: string,
  txId: string,
): Promise<VaultVkeyWitness> {
  if (!TX_ID.test(txId)) spendError('KEY_MISMATCH', 'A transaction id is 32 bytes of lowercase hex');
  if (!Number.isInteger(ownIndex) || ownIndex < 0 || ownIndex >= HARDENED) spendError('KEY_MISMATCH', 'Not a vault index');
  await ready();
  const root = Bip32PrivateKey.fromBytes(rootKeyBytes);
  const path = [HARDENED + CIP1854_PURPOSE, HARDENED + CARDANO_COIN_TYPE, HARDENED + CIP146_ACCOUNT, ROLE.PAYMENT, ownIndex];
  return withDerivedKey(root, path, bip32 => {
    const key = bip32.toRawKey();
    try {
      const publicKey = key.toPublic();
      if (publicKey.hash().hex() !== expectedCredential) spendError('KEY_MISMATCH', 'This wallet\'s key at its vault index is not the vault\'s');
      return Object.freeze({ vkey: publicKey.hex(), signature: key.sign(HexBlob(txId)).hex() });
    } finally {
      key.bytes().fill(0);
    }
  });
}

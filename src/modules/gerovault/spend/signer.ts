/**
 * Signing a vault transaction with this wallet's own vault key, in software, in the background
 * worker only (`signBundleFlow.ts`, `GEROVAULT_SIGN_VAULT_BUNDLE`): no page opens the root key.
 *
 * The key is the CIP-1854 payment key at `m/1854'/1815'/0'/0/i`, `i` being this wallet's own
 * index in the vault, derived from the wallet's root key. It must hash to the payment key the vault
 * record holds for this wallet; otherwise nothing is signed. Only the transaction id is signed.
 * For a stake or DUST operation the stake key at `m/1854'/1815'/0'/2/i` signs too, under the same
 * rule against the record's stake key; and when the operation's collateral is this wallet's own,
 * the CIP-1852 payment key of its first address (`m/1852'/1815'/a'/0/0`), which must hash both to
 * the collateral the body names and to the key the wallet's account public key gives there.
 * Hardware wallets, PassKey (PRF) wallets and Google wallets do not sign here yet (`signerSupport`).
 *
 * Kept free of page-only imports: the background imports this file.
 */
import { Bip32PrivateKey, Bip32PublicKey, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { bech32, bech32m } from 'bech32';
import { CARDANO_COIN_TYPE, CIP146_ACCOUNT, CIP1854_PURPOSE, ROLE, type Role } from '@/shared/gerovault';
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

/** Derives `path` from the root, checks the key hashes to `expected`, signs `txId`, overwrites every key. */
function signAtPath(root: Bip32PrivateKey, path: readonly number[], expected: string, txId: string, mismatch: string): VaultVkeyWitness {
  return withDerivedKey(root, path, bip32 => {
    const key = bip32.toRawKey();
    try {
      const publicKey = key.toPublic();
      if (publicKey.hash().hex() !== expected) spendError('KEY_MISMATCH', mismatch);
      return Object.freeze({ vkey: publicKey.hex(), signature: key.sign(HexBlob(txId)).hex() });
    } finally {
      key.bytes().fill(0);
    }
  });
}

/**
 * Signs `txId` with the vault key of `role` at `m/1854'/1815'/0'/role/ownIndex` of
 * `rootKeyBytes`, after checking that key hashes to `expectedKeyHash` (the record's payment
 * credential or stake key hash for this wallet). Throws `KEY_MISMATCH` otherwise. Every private key
 * derived on the way, and the signing key, are overwritten before this returns; the caller owns
 * `rootKeyBytes` and overwrites them.
 */
export async function signVaultRoleWithRootKey(
  rootKeyBytes: Uint8Array,
  role: Role,
  ownIndex: number,
  expectedKeyHash: string,
  txId: string,
): Promise<VaultVkeyWitness> {
  if (!TX_ID.test(txId)) spendError('KEY_MISMATCH', 'A transaction id is 32 bytes of lowercase hex');
  if (!Number.isInteger(ownIndex) || ownIndex < 0 || ownIndex >= HARDENED) spendError('KEY_MISMATCH', 'Not a vault index');
  if (role !== ROLE.PAYMENT && role !== ROLE.STAKE) spendError('KEY_MISMATCH', 'Not a vault role');
  await ready();
  const root = Bip32PrivateKey.fromBytes(rootKeyBytes);
  const path = [HARDENED + CIP1854_PURPOSE, HARDENED + CARDANO_COIN_TYPE, HARDENED + CIP146_ACCOUNT, role, ownIndex];
  return signAtPath(root, path, expectedKeyHash, txId, 'This wallet\'s key at its vault index is not the vault\'s');
}

/** The payment key at `m/1854'/1815'/0'/0/ownIndex`: see `signVaultRoleWithRootKey`. */
export async function signWithRootKey(
  rootKeyBytes: Uint8Array,
  ownIndex: number,
  expectedCredential: string,
  txId: string,
): Promise<VaultVkeyWitness> {
  return signVaultRoleWithRootKey(rootKeyBytes, ROLE.PAYMENT, ownIndex, expectedCredential, txId);
}

const CIP1852_PURPOSE = 1852;
const MAX_ACCOUNT_INDEX = 0x7fffffff;

/**
 * The key hash of the CIP-1852 payment key of a wallet's first address (`.../0/0`), from its
 * account public key (bech32, as the wallet record stores it). Public derivation only: the address
 * a proposer offers collateral from. Undefined for anything that is not an account public key.
 */
export async function accountCollateralKeyHash(accountPublicKey: unknown): Promise<string | undefined> {
  if (typeof accountPublicKey !== 'string' || accountPublicKey.length === 0) return undefined;
  try {
    let words: number[];
    try {
      words = bech32.decode(accountPublicKey, 1023).words;
    } catch {
      words = bech32m.decode(accountPublicKey, 1023).words;
    }
    await ready();
    return Bip32PublicKey.fromBytes(Uint8Array.from(bech32.fromWords(words))).derive([0, 0]).toRawKey().hash().hex();
  } catch {
    return undefined;
  }
}

/**
 * Signs `txId` with the CIP-1852 payment key of the wallet's first address, at
 * `m/1852'/1815'/accountIndex'/0/0`, for the collateral of a DUST operation. The key must hash to
 * `collateralKeyHash` (the body's collateral) and to the key `accountPublicKey` gives at `0/0`, so
 * it is this wallet's own first address and nothing else. Every key is overwritten as above.
 */
export async function signCollateralWithRootKey(
  rootKeyBytes: Uint8Array,
  accountIndex: number,
  accountPublicKey: string,
  collateralKeyHash: string,
  txId: string,
): Promise<VaultVkeyWitness> {
  if (!TX_ID.test(txId)) spendError('KEY_MISMATCH', 'A transaction id is 32 bytes of lowercase hex');
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > MAX_ACCOUNT_INDEX) spendError('KEY_MISMATCH', 'Not an account index');
  if ((await accountCollateralKeyHash(accountPublicKey)) !== collateralKeyHash) spendError('KEY_MISMATCH', 'The collateral is not this wallet\'s first address');
  const root = Bip32PrivateKey.fromBytes(rootKeyBytes);
  const path = [HARDENED + CIP1852_PURPOSE, HARDENED + CARDANO_COIN_TYPE, HARDENED + accountIndex, 0, 0];
  return signAtPath(root, path, collateralKeyHash, txId, 'This wallet\'s first address key is not the collateral\'s');
}

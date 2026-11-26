/**
 * Signing a vault transaction with this wallet's own vault key, in software.
 *
 * The key is the CIP-1854 payment key at `m/1854'/1815'/0'/0/i`, `i` being this wallet's own
 * index in the vault, derived from the wallet's root key. The root key is reached the way the
 * wallet already reaches it for a password: the spending password is first checked by the
 * background worker (`VERIFY_SPENDING_PASSWORD`, which counts toward the wallet's back-off), then
 * the stored root key is opened with it (`decryptPrivateKey`, the one reader of every stored
 * format). The derived key must hash to the payment key the vault record holds for this wallet;
 * otherwise nothing is signed.
 *
 * Only the transaction id is signed. No private key is logged, kept or returned: the decrypted
 * bytes are overwritten once the signature exists. Hardware wallets, PassKey (PRF) wallets and
 * Google wallets do not sign here yet (`signerSupport`).
 */
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { CARDANO_COIN_TYPE, CIP146_ACCOUNT, CIP1854_PURPOSE, ROLE } from '@/shared/gerovault';
import type { VaultVkeyWitness } from '@/modules/gerovault/contracts';
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

type SignerWallet = Pick<Wallet, 'type' | 'encryptionMethod' | 'prfEncryptedPrivateKey' | 'webAuthnCredentialId' | 'encryptedPrivateKey'>;

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
 * checking that key hashes to `expectedCredential`. Throws `KEY_MISMATCH` otherwise.
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
  const key = root
    .derive([HARDENED + CIP1854_PURPOSE, HARDENED + CARDANO_COIN_TYPE, HARDENED + CIP146_ACCOUNT, ROLE.PAYMENT, ownIndex])
    .toRawKey();
  const publicKey = key.toPublic();
  if (publicKey.hash().hex() !== expectedCredential) spendError('KEY_MISMATCH', 'This wallet\'s key at its vault index is not the vault\'s');
  return Object.freeze({ vkey: publicKey.hex(), signature: key.sign(HexBlob(txId)).hex() });
}

export interface PasswordSigningDeps {
  /** Checks the spending password with the background worker, under its back-off. */
  readonly verifyPassword: (password: string) => Promise<boolean>;
  /** Opens the stored root key with the password. */
  readonly openRootKey: (encryptedPrivateKey: string, password: string) => Promise<Uint8Array>;
}

async function verifyWithBackground(password: string): Promise<boolean> {
  const [{ Messaging }, { MessageTypes }] = await Promise.all([import('@/chrome/messaging'), import('@/models/MessageTypes')]);
  const reply = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.VERIFY_SPENDING_PASSWORD, data: { password } }) as
    { data?: { success?: boolean } } | undefined;
  return reply?.data?.success === true;
}

async function openStoredRootKey(encryptedPrivateKey: string, password: string): Promise<Uint8Array> {
  const { decryptPrivateKey } = await import('@/shared/utils/crypto');
  return decryptPrivateKey(encryptedPrivateKey, password);
}

const defaultDeps: PasswordSigningDeps = { verifyPassword: verifyWithBackground, openRootKey: openStoredRootKey };

/**
 * Signs `txId` with this wallet's vault key, opened with the spending password. Throws
 * `UNSUPPORTED_WALLET`, `WRONG_PASSWORD` or `KEY_MISMATCH`.
 */
export async function signWithSpendingPassword(
  input: {
    readonly wallet: SignerWallet | null | undefined;
    readonly password: string;
    readonly ownIndex: number;
    readonly expectedCredential: string;
    readonly txId: string;
  },
  deps: PasswordSigningDeps = defaultDeps,
): Promise<VaultVkeyWitness> {
  const { wallet } = input;
  if (signerSupport(wallet) !== 'software' || !wallet?.encryptedPrivateKey) {
    spendError('UNSUPPORTED_WALLET', 'This wallet cannot sign a vault transaction here yet');
  }
  if (!input.password) spendError('WRONG_PASSWORD', 'The spending password is required');
  let verified = false;
  try {
    verified = await deps.verifyPassword(input.password);
  } catch {
    verified = false;
  }
  if (!verified) spendError('WRONG_PASSWORD', 'The spending password was refused');
  let rootKey: Uint8Array | undefined;
  try {
    try {
      rootKey = await deps.openRootKey(wallet.encryptedPrivateKey, input.password);
    } catch {
      return spendError('WRONG_PASSWORD', 'The stored key did not open with this password');
    }
    return await signWithRootKey(rootKey, input.ownIndex, input.expectedCredential, input.txId);
  } finally {
    rootKey?.fill(0);
  }
}

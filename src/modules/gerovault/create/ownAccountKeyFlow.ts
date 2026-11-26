/**
 * This wallet's CIP-1854 multisig account key (`m/1854'/1815'/0'`), the public half only, derived
 * from its root key behind the wallet's own credential. The vault keys at any index come from it
 * by public derivation (`keys.ts`), so the root key is needed once per flow and never leaves the
 * place it is decrypted in.
 *
 * The same shape as "Add account" (`src/chrome/addAccountKeys.ts`):
 * - a recovery-phrase wallet decrypts its root key with the spending password, and a Google wallet
 *   takes it from its unlocked session, both in the background (`deriveMultisigAccountKeyFlow`);
 * - a PassKey wallet decrypts in the page, where WebAuthn runs (the documented PRF exception,
 *   `ownAccountKey.ts`).
 * Either way only the public key goes back, and the root key copy is wiped.
 *
 * Kept free of page-only imports: the background imports this file.
 */
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { Blockchain, CoinTypes, HARDENED, WalletType, WalletTypePurpose, type Wallet } from '@/models/types';
import { CIP1854_ACCOUNT_PATH } from '@/shared/gerovault/paths';
import { accountXpub, cardanoAccountPath, isHardwareWallet, resolveAccountIndex, secretsWallet } from '@/shared/utils/walletAccount';
import { withDerivedKey } from '@/modules/gerovault/keyWipe';

/**
 * - `not-found`: no such wallet.
 * - `not-supported`: a wallet that cannot hold vault keys here (hardware, watch, another chain, an
 *   added account) or a root key that is not this wallet's.
 * - `wrong-password`: the spending password did not decrypt the root key.
 * - `locked`: a Google wallet whose session is not unlocked.
 * - `unavailable`: the background has no handler for this request in this build.
 * - `cancelled`: the PassKey prompt was dismissed.
 */
export type OwnAccountKeyErrorCode = 'not-found' | 'not-supported' | 'wrong-password' | 'locked' | 'unavailable' | 'cancelled';

const CODES: readonly string[] = ['not-found', 'not-supported', 'wrong-password', 'locked', 'unavailable', 'cancelled'];

export class OwnAccountKeyError extends Error {
  constructor(readonly code: OwnAccountKeyErrorCode) {
    super(`Could not derive the vault account key: ${code}`);
    this.name = 'OwnAccountKeyError';
  }
}

/** A code from a response, or `not-supported` for anything unknown. */
export function ownAccountKeyErrorCode(value: unknown): OwnAccountKeyErrorCode {
  return typeof value === 'string' && CODES.includes(value) ? value as OwnAccountKeyErrorCode : 'not-supported';
}

/**
 * Which wallets may create a vault here. CIP-0146 fixes the multisig account at `0'`, so the vault
 * keys belong to the recovery phrase, not to one CIP-1852 account: two account records of one
 * phrase would hold the same vault keys and allocate indexes on their own. Only account #0's record
 * holds vaults. Hardware wallets sign at 1854 paths through their own flow, which is not here yet.
 */
export function canHoldVaultKeys(wallet: Pick<Wallet, 'chain' | 'type' | 'encryptionMethod' | 'accountIndex' | 'parentWalletId'>): boolean {
  if (wallet.chain !== Blockchain.CARDANO || isHardwareWallet(wallet) || wallet.type === WalletType.Watch) return false;
  if (wallet.type === WalletType.Google && wallet.encryptionMethod !== 'mpc') return false;
  if (wallet.type !== WalletType.Normal && wallet.type !== WalletType.Google) return false;
  try {
    return resolveAccountIndex(wallet) === 0 && wallet.parentWalletId == null;
  } catch {
    return false;
  }
}

/**
 * The multisig account key of a root key, as 128 hex characters (key and chain code), after
 * checking that the root key derives this wallet's own CIP-1852 account #0 key: a root key of any
 * other wallet is refused. Every private key derived on the way is overwritten (`withDerivedKey`);
 * the caller wipes the root key's bytes.
 */
export async function multisigAccountKeyOfRoot(rootKeyBytes: Uint8Array, accountZeroXpub: string | undefined): Promise<string> {
  await ready();
  const root = Bip32PrivateKey.fromBytes(rootKeyBytes);
  const zero = withDerivedKey(root, [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED], key => key.toPublic().hex());
  const own = accountXpub(zero.slice(0, 64), zero.slice(64), cardanoAccountPath(0)).publicKey;
  if (!accountZeroXpub || own.toLowerCase() !== accountZeroXpub.toLowerCase()) throw new OwnAccountKeyError('not-supported');
  return withDerivedKey(root, CIP1854_ACCOUNT_PATH, key => key.toPublic().hex());
}

export interface DeriveMultisigAccountKeyDeps {
  getWallets(): Promise<Record<number, Wallet>>;
  /** The root key an unlocked Google wallet's session holds (mpcSessionCache). */
  sessionRootKey(walletId: number): Uint8Array | undefined;
  /** The single reader for a stored root key (decryptPrivateKey); throws on a wrong password. */
  decryptRootKey(encryptedPrivateKey: string, password: string): Uint8Array;
}

/**
 * Background side: the multisig account key of wallet `walletId`, as 128 hex characters. Never
 * log `input` (it holds the spending password). PassKey wallets derive in the page instead.
 */
export async function deriveMultisigAccountKeyFlow(
  input: { readonly walletId?: unknown; readonly password?: unknown },
  deps: DeriveMultisigAccountKeyDeps,
): Promise<string> {
  const wallets = await deps.getWallets();
  const record = typeof input?.walletId === 'number' ? wallets[input.walletId] : undefined;
  if (!record) throw new OwnAccountKeyError('not-found');
  if (!canHoldVaultKeys(record)) throw new OwnAccountKeyError('not-supported');
  const wallet = secretsWallet(record, wallets);

  let rootKeyBytes: Uint8Array;
  if (wallet.encryptionMethod === 'mpc') {
    const cached = deps.sessionRootKey(wallet.id);
    if (!cached) throw new OwnAccountKeyError('locked');
    rootKeyBytes = Uint8Array.from(cached);
  } else if (wallet.encryptionMethod !== 'prf' && wallet.encryptedPrivateKey) {
    if (typeof input.password !== 'string' || !input.password) throw new OwnAccountKeyError('wrong-password');
    let decrypted: Uint8Array;
    try {
      decrypted = deps.decryptRootKey(wallet.encryptedPrivateKey, input.password);
    } catch {
      throw new OwnAccountKeyError('wrong-password');
    }
    rootKeyBytes = Uint8Array.from(decrypted);
    decrypted.fill(0);
  } else {
    throw new OwnAccountKeyError('not-supported');
  }

  try {
    return await multisigAccountKeyOfRoot(rootKeyBytes, wallet.publicKey);
  } finally {
    rootKeyBytes.fill(0);
  }
}

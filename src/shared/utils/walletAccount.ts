// Which HD account a wallet record signs with.
//
// Every account of a seed or hardware device is its own wallet record, carrying
// the account-level xpub its addresses come from and the index that xpub was
// derived at. Records created before multi-account support have no index and are
// account 0. The background reads the index from the record, never from a
// request, so a page cannot pick the key a transaction is signed with.
import type { Bip32PrivateKey } from '@cardano-sdk/crypto';
import { getPublicKey } from '@/chrome/serialization';
import {
  Blockchain,
  CoinTypes,
  HARDENED,
  WalletType,
  WalletTypePurpose,
  coin_type,
  purpose,
  type Keys,
  type Wallet,
} from '@/models/types';

/** Indices at or above 2^31 cannot be hardened, and CIP-1852 hardens the account level. */
const MAX_ACCOUNT_INDEX = 0x7fffffff;

/**
 * Chains whose records may hold an account other than 0. Bitcoin and Midnight
 * signing still derives account 0 throughout, so a record claiming another
 * account there is refused rather than signed for with the wrong key.
 */
const MULTI_ACCOUNT_CHAINS: ReadonlySet<string> = new Set([
  Blockchain.CARDANO,
  Blockchain.APEX_PRIME,
  Blockchain.APEX_VECTOR,
]);

export class InvalidAccountIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAccountIndexError';
  }
}

type AccountRecord = Pick<Wallet, 'accountIndex' | 'chain' | 'type' | 'encryptionMethod'>;

/** Watch wallets have no keys, and a legacy Google wallet's address comes from a contract. */
function canHoldOtherAccounts(wallet: AccountRecord): boolean {
  if (!MULTI_ACCOUNT_CHAINS.has(wallet.chain)) return false;
  if (wallet.type === WalletType.Watch) return false;
  return !(wallet.type === WalletType.Google && wallet.encryptionMethod !== 'mpc');
}

/**
 * The record's account index, 0 when it has none. Throws for anything that is not
 * a valid hardened account index, or for an account other than 0 on a wallet that
 * cannot hold one: signing with a guessed account would produce witnesses for keys
 * the wallet does not own.
 */
export function resolveAccountIndex(wallet: AccountRecord): number {
  const index: unknown = wallet.accountIndex;
  if (index === undefined || index === null) return 0;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > MAX_ACCOUNT_INDEX) {
    throw new InvalidAccountIndexError('Invalid account index on this wallet');
  }
  if (index > 0 && !canHoldOtherAccounts(wallet)) {
    throw new InvalidAccountIndexError('This wallet type supports only account #0');
  }
  return index;
}

/**
 * The CIP-1852 account key to sign with, derived from the root key. Refuses one
 * whose public half is not `accountXpub`, the record's `publicKey`: every address,
 * credential and stake key the wallet shows comes from that xpub, so any other
 * account key would sign for keys the wallet does not own.
 */
export function deriveSigningAccountKey(rootKey: Bip32PrivateKey, accountIndex: number, accountXpub: string | undefined): Bip32PrivateKey {
  const accountKey = rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + accountIndex]);
  if (!accountXpub || accountKey.toPublic().hex() !== getPublicKey(accountXpub).hex()) {
    throw new InvalidAccountIndexError('The signing key does not belong to this account');
  }
  return accountKey;
}

/** CIP-1852 account path, e.g. `m/1852'/1815'/1'`. */
export function cardanoAccountPath(accountIndex: number): string {
  return `m/${purpose.hdwallet}'/${coin_type.cardano}'/${accountIndex}'`;
}

/**
 * The account index in a CIP-1852 path (`m/1852'/1815'/N'/...`, with or without
 * the `m/` Keystone leaves off), or undefined for any other path.
 */
export function accountIndexFromPath(path: string): number | undefined {
  const match = /^(?:m\/)?1852'\/1815'\/(\d+)'(?:\/|$)/.exec(path);
  if (!match) return undefined;
  const index = Number(match[1]);
  return index <= MAX_ACCOUNT_INDEX ? index : undefined;
}

/**
 * The single account every CIP-1852 path in `keys` belongs to. Hardware signers
 * take their account from the same key set they send paths from, so the two
 * cannot disagree. Throws when the paths name more than one account, or none.
 */
export function accountIndexFromKeys(keys: Keys): number {
  const groups = [keys.payment, keys.change, keys.stake, keys.drep129, keys.drep105, keys.ccCold, keys.ccHot];
  const accounts = new Set<number>();
  for (const group of groups) {
    for (const key of group ?? []) {
      const index = key.path ? accountIndexFromPath(key.path) : undefined;
      if (index !== undefined) accounts.add(index);
    }
  }
  if (accounts.size !== 1) {
    throw new InvalidAccountIndexError(accounts.size === 0
      ? 'This wallet has no keys to sign with yet'
      : 'This wallet\'s keys belong to more than one account');
  }
  return [...accounts][0];
}

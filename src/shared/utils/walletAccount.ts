// Which HD account a wallet record signs with.
//
// Every account of a seed or hardware device is its own wallet record, carrying
// the account-level xpub its addresses come from and the index that xpub was
// derived at. Records created before multi-account support have no index and are
// account 0. The background reads the index from the record, never from a
// request, so a page cannot pick the key a transaction is signed with.
import { bech32, bech32m } from 'bech32';
import type { Bip32PrivateKey } from '@cardano-sdk/crypto';
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
 * Chains whose records may hold an account other than 0. Midnight signing still
 * derives account 0 throughout, so a record claiming another account there is
 * refused rather than signed for with the wrong key. Bitcoin signs at the
 * record's account for recovery-phrase and PassKey wallets only: its hardware
 * signers still send account 0 paths.
 */
const MULTI_ACCOUNT_CHAINS: ReadonlySet<string> = new Set([
  Blockchain.CARDANO,
  Blockchain.APEX_PRIME,
  Blockchain.APEX_VECTOR,
  Blockchain.BITCOIN,
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
  if (wallet.chain === Blockchain.BITCOIN) return wallet.type === WalletType.Normal;
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
  if (!accountXpub || accountKey.toPublic().hex() !== xpubHex(accountXpub)) {
    throw new InvalidAccountIndexError('The signing key does not belong to this account');
  }
  return accountKey;
}

/** The key and chain code a bech32 (or bech32m) account xpub holds, as hex; what `getPublicKey()` decodes. */
function xpubHex(xpub: string): string {
  let words: number[];
  try {
    words = bech32.decode(xpub, 1023).words;
  } catch {
    words = bech32m.decode(xpub, 1023).words;
  }
  return Buffer.from(bech32.fromWords(words)).toString('hex');
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

// ---------------------------------------------------------------------------
// Account groups. Accounts other than #0 of a device are records of their own,
// added under the account-#0 record (`parentWalletId`); the wallet list shows
// them together.
// ---------------------------------------------------------------------------

type GroupRecord = Pick<Wallet, 'id' | 'name' | 'chain' | 'network' | 'type' | 'accountIndex' | 'parentWalletId'>;
type WalletList<T> = T[] | Record<string | number, T> | null | undefined;
const listOf = <T>(wallets: WalletList<T>): T[] => (Array.isArray(wallets) ? wallets : Object.values(wallets ?? {}));

/**
 * The account-#0 record `wallet` was added under, or null when it stands alone: no
 * parent recorded, the parent is gone, or it is not the same kind of wallet on the
 * same chain and network. A stale id never groups unrelated wallets.
 */
export function parentWallet<T extends GroupRecord>(wallet: T, wallets: WalletList<T>): T | null {
  if (wallet.parentWalletId == null || wallet.parentWalletId === wallet.id) return null;
  const parent = listOf(wallets).find((candidate) => candidate.id === wallet.parentWalletId);
  if (!parent || parent.parentWalletId != null) return null;
  return parent.chain === wallet.chain && parent.network === wallet.network && parent.type === wallet.type ? parent : null;
}

/** The accounts added under `parent`, by account index. */
export function childAccounts<T extends GroupRecord>(parent: T, wallets: WalletList<T>): T[] {
  return listOf(wallets)
    .filter((wallet) => wallet.id !== parent.id && parentWallet(wallet, wallets)?.id === parent.id)
    .sort((a, b) => (a.accountIndex ?? 0) - (b.accountIndex ?? 0) || a.id - b.id);
}

/**
 * Wallets that can add another account: on Cardano hardware devices, seeds
 * (password or PassKey) and Google wallets; on Bitcoin seeds only.
 */
export function canAddAccounts(wallet: Pick<Wallet, 'chain' | 'type' | 'encryptionMethod'>): boolean {
  if (wallet.chain === Blockchain.BITCOIN) return wallet.type === WalletType.Normal;
  if (wallet.chain !== Blockchain.CARDANO) return false;
  if (isHardwareWallet(wallet)) return true;
  return wallet.type === WalletType.Normal || (wallet.type === WalletType.Google && wallet.encryptionMethod === 'mpc');
}

/** Ledger, Trezor and Keystone: the accounts come from the device, not from a stored secret. */
export function isHardwareWallet(wallet: Pick<Wallet, 'type'>): boolean {
  return ([WalletType.Ledger, WalletType.Trezor, WalletType.Keystone] as string[]).includes(wallet.type ?? '');
}

/** The lowest account index the group of `wallet` does not hold yet. */
export function nextAccountIndex<T extends GroupRecord>(wallet: T, wallets: WalletList<T>): number {
  const taken = new Set(accountGroup(wallet, wallets).map((account) => account.accountIndex ?? 0));
  let index = 0;
  while (taken.has(index)) index++;
  return index;
}

/** Every account of the group `wallet` belongs to: account #0 first, then the rest by index. */
export function accountGroup<T extends GroupRecord>(wallet: T, wallets: WalletList<T>): T[] {
  const root = parentWallet(wallet, wallets) ?? wallet;
  return [root, ...childAccounts(root, wallets)];
}

/** "Cold storage · Account #1" for an account added under another record, else the record's name. */
export function walletDisplayName<T extends GroupRecord>(wallet: T, wallets: WalletList<T>): string {
  const parent = parentWallet(wallet, wallets);
  return parent ? `${parent.name} · ${wallet.name}` : wallet.name;
}

/**
 * Names a rename of `wallet` must not take. An added account is named within its
 * group, so two devices can both have an "Account #1"; any other wallet is named
 * among the wallets the list shows at the top level.
 */
export function conflictingWalletNames<T extends GroupRecord>(wallet: T, wallets: WalletList<T>): string[] {
  const parent = parentWallet(wallet, wallets);
  const peers = parent ? childAccounts(parent, wallets) : listOf(wallets).filter((other) => !parentWallet(other, wallets));
  return peers.filter((other) => other.id !== wallet.id).map((other) => other.name);
}

// ---------------------------------------------------------------------------
// Secrets and security settings of a group. A wallet's root key, recovery
// phrase, unlock identity (PassKey, Google) and security settings are stored
// once, on its account-#0 record. An account added under it stores none of them,
// and reads them from there: one password, one PassKey, one lock for the group.
// ---------------------------------------------------------------------------

/** Record fields only account #0 of a group stores. */
export const GROUP_SECRET_FIELDS: readonly (keyof Wallet)[] = [
  'encryptionMethod',
  'encryptedPrivateKey',
  'encryptedMnemonic',
  'prfEncryptedPrivateKey',
  'prfEncryptedMnemonic',
  'prfSpendingPassword',
  'webAuthnCredentialId',
  'webAuthnTransports',
  'mpcPrfSaltId',
  'userId',
  'mpcDeviceShare',
  'mpcDeviceShareNext',
];

/** The record holding `wallet`'s secrets and security settings: its account #0, or itself. */
export function secretsWallet<T extends GroupRecord>(wallet: T, wallets: WalletList<T>): T {
  return parentWallet(wallet, wallets) ?? wallet;
}

/**
 * The id `wallet`'s secrets are bound to and its security settings are stored
 * under. A PassKey wallet's encryption is bound to this id, so decrypting with an
 * added account's own id fails. `secretsWalletId` is set on the logged-in wallet
 * by the background (withGroupSecrets); a stored record has none and is its own.
 */
export function secretsWalletId(wallet: Pick<Wallet, 'id'> & { secretsWalletId?: number }): number {
  return wallet.secretsWalletId ?? wallet.id;
}

/**
 * `wallet` as the background logs it in, with the secrets of the record that
 * stores them: an added account takes its account #0's, and `secretsWalletId`
 * names that record. Group membership is read from the stored records, not from
 * `wallet`, which comes from a request. An added account whose account #0 is gone
 * or does not match gets no secrets, so it cannot unlock or sign. Signing still
 * refuses a root key whose account key is not `wallet.publicKey`
 * (deriveSigningAccountKey).
 */
export function withGroupSecrets<T extends Wallet>(wallet: T, wallets: WalletList<Wallet>): T & { secretsWalletId: number } {
  const stored = listOf(wallets).find((candidate) => candidate.id === wallet.id);
  if (stored?.parentWalletId == null && wallet.parentWalletId == null) return { ...wallet, secretsWalletId: wallet.id };
  // An account Gero does not store has no group to check, so it gets no secrets.
  const parent = stored ? parentWallet(stored, wallets) : null;
  const secrets: Partial<Wallet> = Object.fromEntries(GROUP_SECRET_FIELDS.map((field) => [field, parent?.[field]]));
  return { ...wallet, ...secrets, parentWalletId: stored?.parentWalletId, secretsWalletId: parent?.id ?? wallet.id };
}

// ---------------------------------------------------------------------------
// Accounts exported from a hardware wallet at pairing, or derived from a
// software wallet's root key (softwareAccounts.ts).
// ---------------------------------------------------------------------------

/** One account of a device or seed, as its wallet record stores it. */
export interface AccountXpub {
  accountIndex: number;
  /** bech32 `xpub` over the 32-byte public key and 32-byte chain code (`wallet.publicKey`). */
  publicKey: string;
  keys: { chainCode: string; path: string; publicKey: string }[];
}

/** At most this many accounts are asked of a device at once. */
export const MAX_ACCOUNTS_PER_EXPORT = 20;

/**
 * Account indices to ask a device for, validated: a non-empty list of distinct
 * hardened account indices, no more than MAX_ACCOUNTS_PER_EXPORT. They can come
 * from a page, so the background checks them before talking to the device.
 */
export function assertAccountIndices(indices: unknown): number[] {
  if (!Array.isArray(indices) || indices.length === 0 || indices.length > MAX_ACCOUNTS_PER_EXPORT
    || !indices.every((index) => Number.isInteger(index) && index >= 0 && index <= MAX_ACCOUNT_INDEX)
    || new Set(indices).size !== indices.length) {
    throw new InvalidAccountIndexError('Invalid account indices');
  }
  return indices as number[];
}

/**
 * The account behind an exported or derived key. `path` must be the CIP-1852 account
 * path the key was derived at (Keystone leaves off the `m/`); the account index is
 * taken from it, so a key for any other path is refused rather than stored.
 */
export function accountXpub(publicKeyHex: string, chainCodeHex: string, path: string): AccountXpub {
  const accountIndex = accountIndexFromPath(path);
  const accountPath = accountIndex === undefined ? '' : cardanoAccountPath(accountIndex);
  if (!accountPath || (path.startsWith('m/') ? path : `m/${path}`) !== accountPath
    || !/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{64}$/i.test(chainCodeHex)) {
    throw new InvalidAccountIndexError('The device returned a key for an unexpected path');
  }
  const words = bech32.toWords(Buffer.from(publicKeyHex + chainCodeHex, 'hex'));
  return {
    accountIndex: accountIndex!,
    publicKey: bech32.encode('xpub', words, 1023),
    keys: [{ chainCode: chainCodeHex, path: accountPath, publicKey: publicKeyHex }],
  };
}

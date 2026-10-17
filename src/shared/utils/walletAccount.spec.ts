import { describe, expect, it } from 'vitest';
import { bech32 } from 'bech32';
import type { Bip32PrivateKey } from '@cardano-sdk/crypto';
import { Blockchain, CoinTypes, HARDENED, WalletType, WalletTypePurpose, type Keys, type Wallet } from '@/models/types';
import { resolvePrivateKey } from './resolver';
import {
  InvalidAccountIndexError,
  MAX_ACCOUNTS_PER_EXPORT,
  accountGroup,
  accountIndexFromKeys,
  accountIndexFromPath,
  assertAccountIndices,
  canAddAccounts,
  cardanoAccountPath,
  childAccounts,
  conflictingWalletNames,
  deriveSigningAccountKey,
  accountXpub,
  isHardwareWallet,
  nextAccountIndex,
  parentWallet,
  resolveAccountIndex,
  secretsWallet,
  secretsWalletId,
  walletDisplayName,
  withGroupSecrets,
} from './walletAccount';

const MNEMONIC = `${'abandon '.repeat(23)}art`;

/** The bech32 account xpub a record stores in `publicKey` for account `index`. */
function bech32AccountXpub(rootKey: Bip32PrivateKey, index: number): string {
  const publicKeyHex = rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index]).toPublic().hex();
  return bech32.encode('xpub', bech32.toWords(Buffer.from(publicKeyHex, 'hex')), 1023);
}

function keysAt(...paths: string[]): Keys {
  return {
    payment: paths.map((path, i) => ({ address: `addr${i}`, cred: '11'.repeat(28), path })),
    change: [],
    stake: [],
    script: [],
    ccCold: [],
    ccHot: [],
    drep105: [],
    drep129: [],
  };
}

const cardano = { chain: Blockchain.CARDANO, type: WalletType.Normal };

describe('resolveAccountIndex', () => {
  it('treats a record without an index as account 0', () => {
    expect(resolveAccountIndex(cardano)).toBe(0);
    expect(resolveAccountIndex({ ...cardano, accountIndex: null as unknown as number })).toBe(0);
  });

  it.each([
    ['a seed wallet', { type: WalletType.Normal }],
    ['a Ledger', { type: WalletType.Ledger }],
    ['a Trezor', { type: WalletType.Trezor }],
    ['a Keystone', { type: WalletType.Keystone }],
    ['a Google (MPC) wallet', { type: WalletType.Google, encryptionMethod: 'mpc' as const }],
  ])('returns the index of %s on Cardano', (_, fields) => {
    expect(resolveAccountIndex({ chain: Blockchain.CARDANO, accountIndex: 3, ...fields })).toBe(3);
  });

  it('accepts accounts on the Apex Fusion chains, which share the CIP-1852 derivation', () => {
    expect(resolveAccountIndex({ ...cardano, chain: Blockchain.APEX_PRIME, accountIndex: 1 })).toBe(1);
    expect(resolveAccountIndex({ ...cardano, chain: Blockchain.APEX_VECTOR, accountIndex: 1 })).toBe(1);
  });

  it.each([-1, 1.5, 0x80000000, Number.NaN, '1'])('refuses %s', (accountIndex) => {
    expect(() => resolveAccountIndex({ ...cardano, accountIndex: accountIndex as number })).toThrow(InvalidAccountIndexError);
  });

  it.each([
    ['a Bitcoin wallet', { chain: Blockchain.BITCOIN, type: WalletType.Normal }],
    ['a Midnight wallet', { chain: Blockchain.MIDNIGHT, type: WalletType.Normal }],
    ['a watch wallet', { chain: Blockchain.CARDANO, type: WalletType.Watch }],
    ['a legacy Google wallet', { chain: Blockchain.CARDANO, type: WalletType.Google }],
  ])('refuses an account other than 0 on %s, and accepts account 0', (_, fields) => {
    expect(() => resolveAccountIndex({ ...fields, accountIndex: 1 })).toThrow(InvalidAccountIndexError);
    expect(resolveAccountIndex({ ...fields, accountIndex: 0 })).toBe(0);
  });
});

describe('paths', () => {
  it('builds the CIP-1852 account path', () => {
    expect(cardanoAccountPath(0)).toBe("m/1852'/1815'/0'");
    expect(cardanoAccountPath(12)).toBe("m/1852'/1815'/12'");
  });

  it('reads the account from a CIP-1852 path, with or without the m/ Keystone leaves off', () => {
    expect(accountIndexFromPath("m/1852'/1815'/0'/0/4")).toBe(0);
    expect(accountIndexFromPath("m/1852'/1815'/7'/2/0")).toBe(7);
    expect(accountIndexFromPath("1852'/1815'/2'")).toBe(2);
  });

  it.each(["m/1854'/1815'/0'/0/0", "m/44'/0'/0'/0/0", "m/1852'/1815'/1/0/0", '', "m/1852'/1815'/1'x"])(
    'reads no account from %j',
    (path) => {
      expect(accountIndexFromPath(path)).toBeUndefined();
    },
  );

  it('takes the one account a key set belongs to', () => {
    expect(accountIndexFromKeys(keysAt("m/1852'/1815'/1'/0/0", "m/1852'/1815'/1'/0/1"))).toBe(1);
  });

  it('ignores keys without a CIP-1852 path', () => {
    expect(accountIndexFromKeys(keysAt('', "m/1854'/1815'/0'/0/0", "m/1852'/1815'/4'/0/0"))).toBe(4);
  });

  it('refuses a key set that spans accounts, or names none', () => {
    expect(() => accountIndexFromKeys(keysAt("m/1852'/1815'/0'/0/0", "m/1852'/1815'/1'/0/0"))).toThrow(InvalidAccountIndexError);
    expect(() => accountIndexFromKeys(keysAt())).toThrow(InvalidAccountIndexError);
  });
});

describe('deriveSigningAccountKey', () => {
  const rootKey = resolvePrivateKey(MNEMONIC);

  it('derives the account key whose public half is the record’s xpub', () => {
    const accountKey = deriveSigningAccountKey(rootKey, 1, bech32AccountXpub(rootKey, 1));
    expect(accountKey.toPublic().hex()).toBe(
      rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + 1]).toPublic().hex(),
    );
  });

  it('refuses an index that does not match the xpub', () => {
    expect(() => deriveSigningAccountKey(rootKey, 0, bech32AccountXpub(rootKey, 1))).toThrow(InvalidAccountIndexError);
    expect(() => deriveSigningAccountKey(rootKey, 1, bech32AccountXpub(rootKey, 0))).toThrow(InvalidAccountIndexError);
  });

  it('refuses a record with no xpub', () => {
    expect(() => deriveSigningAccountKey(rootKey, 0, undefined)).toThrow(InvalidAccountIndexError);
  });
});

describe('account groups', () => {
  const record = (id: number, name: string, fields: Record<string, unknown> = {}) => ({
    id, name, chain: Blockchain.CARDANO, network: 'Mainnet', type: WalletType.Keystone, ...fields,
  });
  const head = record(1, 'Cold storage');
  const second = record(7, 'Account #2', { accountIndex: 2, parentWalletId: 1 });
  const first = record(5, 'Account #1', { accountIndex: 1, parentWalletId: 1 });
  const other = record(3, 'Daily', { type: WalletType.Ledger });
  const otherAccount = record(9, 'Account #1', { type: WalletType.Ledger, accountIndex: 1, parentWalletId: 3 });
  const wallets = { 1: head, 3: other, 5: first, 7: second, 9: otherAccount };

  it('finds the wallet an account was added under, and none for a wallet that stands alone', () => {
    expect(parentWallet(first, wallets)).toBe(head);
    expect(parentWallet(head, wallets)).toBeNull();
  });

  it('never groups under a missing parent, or one on another chain, network or device', () => {
    expect(parentWallet(record(11, 'x', { parentWalletId: 99 }), wallets)).toBeNull();
    expect(parentWallet(record(11, 'x', { parentWalletId: 1, network: 'Preprod' }), wallets)).toBeNull();
    expect(parentWallet(record(11, 'x', { parentWalletId: 1, type: WalletType.Ledger }), wallets)).toBeNull();
    expect(parentWallet(record(11, 'x', { parentWalletId: 5 }), wallets)).toBeNull(); // 5 is itself an added account
    expect(parentWallet(record(11, 'x', { parentWalletId: 11 }), wallets)).toBeNull();
  });

  it('lists a wallet’s accounts by index, with account #0 first in its group', () => {
    expect(childAccounts(head, wallets)).toEqual([first, second]);
    expect(accountGroup(second, wallets)).toEqual([head, first, second]);
    expect(accountGroup(other, wallets)).toEqual([other, otherAccount]);
  });

  it('names an added account after the wallet it belongs to', () => {
    expect(walletDisplayName(first, wallets)).toBe('Cold storage · Account #1');
    expect(walletDisplayName(head, wallets)).toBe('Cold storage');
  });

  it('checks a rename within the account’s own wallet, or among top-level wallets', () => {
    expect(conflictingWalletNames(first, wallets)).toEqual(['Account #2']); // not the Ledger's "Account #1"
    expect(conflictingWalletNames(head, wallets).sort()).toEqual(['Daily']);
  });

  it('offers more accounts for Cardano hardware, recovery-phrase, PassKey and Google wallets', () => {
    expect(canAddAccounts(head)).toBe(true);
    expect(canAddAccounts(record(2, 'x', { type: WalletType.Trezor }))).toBe(true);
    expect(canAddAccounts(record(2, 'x', { type: WalletType.Normal }))).toBe(true);
    expect(canAddAccounts(record(2, 'x', { type: WalletType.Normal, encryptionMethod: 'prf' }))).toBe(true);
    expect(canAddAccounts(record(2, 'x', { type: WalletType.Google, encryptionMethod: 'mpc' }))).toBe(true);
    expect(canAddAccounts(record(2, 'x', { type: WalletType.Google }))).toBe(false); // legacy contract wallet
    expect(canAddAccounts(record(2, 'x', { type: WalletType.Watch }))).toBe(false);
    expect(canAddAccounts(record(2, 'x', { chain: Blockchain.BITCOIN }))).toBe(false);
    expect(canAddAccounts(record(2, 'x', { type: WalletType.Normal, chain: Blockchain.MIDNIGHT }))).toBe(false);
  });
});

describe('device account export', () => {
  const KEY = 'aa'.repeat(32);
  const CHAIN_CODE = 'bb'.repeat(32);

  it('accepts a list of distinct account indices', () => {
    expect(assertAccountIndices([0, 1, 7])).toEqual([0, 1, 7]);
  });

  it.each([[[]], [[0, 0]], [[-1]], [[1.5]], [['1']], ['0'], [Array.from({ length: MAX_ACCOUNTS_PER_EXPORT + 1 }, (_, i) => i)]])(
    'refuses %j', (indices) => {
      expect(() => assertAccountIndices(indices)).toThrow(InvalidAccountIndexError);
    });

  it('builds the record’s xpub and key from an exported account key', () => {
    const account = accountXpub(KEY, CHAIN_CODE, "1852'/1815'/3'");
    expect(account.accountIndex).toBe(3);
    expect(account.keys).toEqual([{ chainCode: CHAIN_CODE, path: "m/1852'/1815'/3'", publicKey: KEY }]);
    expect(Buffer.from(bech32.fromWords(bech32.decode(account.publicKey, 1023).words)).toString('hex')).toBe(KEY + CHAIN_CODE);
  });

  it.each(["m/1852'/1815'/3'/0/0", "m/44'/1815'/3'", "m/1852'/1815'/3"])('refuses a key exported at %s', (path) => {
    expect(() => accountXpub(KEY, CHAIN_CODE, path)).toThrow(InvalidAccountIndexError);
  });

  it('refuses a malformed key', () => {
    expect(() => accountXpub('aa', CHAIN_CODE, "m/1852'/1815'/0'")).toThrow(InvalidAccountIndexError);
  });
});

describe('secrets of a group', () => {
  const secrets = {
    encryptionMethod: 'prf' as const, prfEncryptedPrivateKey: 'prf-root', prfEncryptedMnemonic: 'prf-phrase',
    webAuthnCredentialId: 'credential', webAuthnTransports: ['internal' as AuthenticatorTransport],
  };
  const base = { chain: Blockchain.CARDANO, network: 'Mainnet', type: WalletType.Normal };
  const head = { id: 1, name: 'Daily', ...base, publicKey: 'xpub-0', ...secrets };
  const added = { id: 2, name: 'Account #1', ...base, publicKey: 'xpub-1', accountIndex: 1, parentWalletId: 1, encryptionMethod: 'prf' as const };
  const third = { id: 4, name: 'Account #3', ...base, publicKey: 'xpub-3', accountIndex: 3, parentWalletId: 1, encryptionMethod: 'prf' as const };
  const savings = { id: 3, name: 'Savings', ...base, publicKey: 'xpub-s', encryptionMethod: 'password' as const, encryptedPrivateKey: 'savings-root' };
  const wallets = { 1: head, 2: added, 3: savings, 4: third };

  it('keeps them on account #0, which an added account reads them from', () => {
    expect(secretsWallet(added, wallets)).toBe(head);
    expect(secretsWallet(head, wallets)).toBe(head);
    expect(secretsWalletId({ id: 2, secretsWalletId: 1 })).toBe(1);
    expect(secretsWalletId({ id: 2 })).toBe(2);
  });

  it('logs an added account in with its account #0’s secrets, under that record’s id', () => {
    const logged = withGroupSecrets(added, wallets);
    expect(logged).toMatchObject({ id: 2, publicKey: 'xpub-1', accountIndex: 1, parentWalletId: 1, ...secrets, secretsWalletId: 1 });
  });

  it('logs any other wallet in as it is', () => {
    expect(withGroupSecrets(savings, wallets)).toEqual({ ...savings, secretsWalletId: 3 });
  });

  it('gives no secrets to an account whose account #0 is gone, nor any it was handed', () => {
    const orphan = { ...added, id: 5, parentWalletId: 99, prfEncryptedPrivateKey: 'smuggled' };
    const logged: Wallet & { secretsWalletId: number } = withGroupSecrets(orphan, { ...wallets, 5: { ...orphan, prfEncryptedPrivateKey: undefined } });
    expect(logged.prfEncryptedPrivateKey).toBeUndefined();
    expect(logged.webAuthnCredentialId).toBeUndefined();
    expect(logged.secretsWalletId).toBe(5);
  });

  it('gives no secrets to an account Gero does not store, whatever account #0 it names', () => {
    const unstored: Wallet & { secretsWalletId: number } = withGroupSecrets({ ...added, id: 99 }, wallets);
    expect(unstored.prfEncryptedPrivateKey).toBeUndefined();
    expect(unstored.parentWalletId).toBeUndefined();
    expect(unstored.secretsWalletId).toBe(99);
  });

  it('reads the group from the stored records, not from the request', () => {
    // A request claiming another wallet as its account #0 gets nothing from it.
    const claimed: Wallet & { secretsWalletId: number } = withGroupSecrets({ ...savings, parentWalletId: 1 }, wallets);
    expect(claimed.parentWalletId).toBeUndefined();
    expect(claimed.encryptedPrivateKey).toBeUndefined();
    expect(claimed.prfEncryptedPrivateKey).toBeUndefined();
    expect(claimed.secretsWalletId).toBe(3);
  });

  it('offers the lowest account index the group does not have yet', () => {
    expect(nextAccountIndex(head, wallets)).toBe(2);
    expect(nextAccountIndex(third, wallets)).toBe(2);
    expect(nextAccountIndex(savings, wallets)).toBe(1);
  });

  it('tells hardware wallets apart', () => {
    expect(isHardwareWallet({ type: WalletType.Keystone })).toBe(true);
    expect(isHardwareWallet({ type: WalletType.Normal })).toBe(false);
  });
});

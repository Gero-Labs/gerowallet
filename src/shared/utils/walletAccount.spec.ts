import { describe, expect, it } from 'vitest';
import { bech32 } from 'bech32';
import type { Bip32PrivateKey } from '@cardano-sdk/crypto';
import { Blockchain, CoinTypes, HARDENED, WalletType, WalletTypePurpose, type Keys } from '@/models/types';
import { resolvePrivateKey } from './resolver';
import {
  InvalidAccountIndexError,
  accountIndexFromKeys,
  accountIndexFromPath,
  cardanoAccountPath,
  deriveSigningAccountKey,
  resolveAccountIndex,
} from './walletAccount';

const MNEMONIC = `${'abandon '.repeat(23)}art`;

/** The bech32 account xpub a record stores in `publicKey` for account `index`. */
function accountXpub(rootKey: Bip32PrivateKey, index: number): string {
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
    const accountKey = deriveSigningAccountKey(rootKey, 1, accountXpub(rootKey, 1));
    expect(accountKey.toPublic().hex()).toBe(
      rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + 1]).toPublic().hex(),
    );
  });

  it('refuses an index that does not match the xpub', () => {
    expect(() => deriveSigningAccountKey(rootKey, 0, accountXpub(rootKey, 1))).toThrow(InvalidAccountIndexError);
    expect(() => deriveSigningAccountKey(rootKey, 1, accountXpub(rootKey, 0))).toThrow(InvalidAccountIndexError);
  });

  it('refuses a record with no xpub', () => {
    expect(() => deriveSigningAccountKey(rootKey, 0, undefined)).toThrow(InvalidAccountIndexError);
  });
});

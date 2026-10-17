// src/chrome/walletBgAccountIndex.spec.ts
//
// A wallet record holds one HD account: its `publicKey` is that account's xpub, and
// `accountIndex` the index it was derived at (absent on every record created before
// multi-account support, which are account 0). These drive a real WalletBg (real
// Dexie via fake-indexeddb, real key derivation) to check that the key paths it hands
// the hardware signers and the keys it signs with are that account's, never account 0's.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Cardano, Serialization } from '@cardano-sdk/core';
import type { Bip32PrivateKey } from '@cardano-sdk/crypto';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import WalletStore from '@/stores/walletStore';
import { getAddress, getPaymentKeyExternal, getStakeKey } from './serialization';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { InvalidAccountIndexError, withGroupSecrets } from '@/shared/utils/walletAccount';
import { encryptWithPassword } from '@/shared/utils/crypto';
import { Blockchain, CoinTypes, HARDENED, Network, WalletType, WalletTypePurpose, type Keys } from '@/models/types';

// clearForWalletSwitch() clears the wallet-scoped alarms; there is no extension API here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stand-in for the chrome namespace
(globalThis as any).chrome = {
  alarms: {
    getAll: (cb: (alarms: unknown[]) => void) => cb([]),
    clear: vi.fn(),
    create: vi.fn(),
    onAlarm: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: () => false },
  },
  storage: { local: { set: vi.fn(), get: vi.fn() } },
  runtime: {},
};

const rootKey: Bip32PrivateKey = resolvePrivateKey(`${'abandon '.repeat(23)}art`);
const rootKeyBytes = Buffer.from(rootKey.bytes());

function accountXpub(index: number): string {
  const publicKeyHex = rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index]).toPublic().hex();
  return bech32.encode('xpub', bech32.toWords(Buffer.from(publicKeyHex, 'hex')), 1023);
}

let walletSeq = 0;
function bootWallet(fields: Record<string, unknown>): WalletBg {
  // A fresh id per wallet: getDb() caches by `wallet-<id>`.
  walletSeq += 1;
  const wallet = { id: 930_000 + walletSeq, name: `account-${walletSeq}`, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, ...fields };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  return new WalletBg(wallet as any);
}

/** A transaction spending one UTxO at `address`, its change back to the same address. */
function spendFrom(address: string): { txCbor: string; utxos: Cardano.Utxo[] } {
  const addressHex = Cardano.Address.fromBech32(address).toBytes();
  const txId = 'aa'.repeat(32);
  const txCbor = `84a300818258 20${txId}00 0181825839${addressHex}1a001e8480 021a00030d40 a0f5f6`.replace(/ /g, '');
  const utxos: Cardano.Utxo[] = [[
    { txId: Cardano.TransactionId(txId), index: 0, address: address as Cardano.PaymentAddress },
    { address: address as Cardano.PaymentAddress, value: { coins: 5_000_000n } },
  ]];
  return { txCbor, utxos };
}

function signingKeys(witnesses: string): string[] {
  const vkeys = Serialization.TransactionWitnessSet.fromCbor(Serialization.TxCBOR(witnesses)).vkeys()?.values() ?? [];
  return vkeys.map((witness) => witness.vkey());
}

describe('WalletBg on account #1', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  it('hands out key paths under the account it was derived at', () => {
    const bg = bootWallet({ publicKey: accountXpub(1), accountIndex: 1 });
    const keys: Keys = bg.resolvePathsForMissingAddresses([]);

    expect(bg.accountIndex).toBe(1);
    expect(keys.payment[0].path).toBe("m/1852'/1815'/1'/0/0");
    expect(keys.change[0].path).toBe("m/1852'/1815'/1'/1/0");
    expect(keys.stake[0].path).toBe("m/1852'/1815'/1'/2/0");
    expect(keys.drep129[0].path).toBe("m/1852'/1815'/1'/3/0");
    expect(keys.ccCold[0].path).toBe("m/1852'/1815'/1'/4/0");
    expect(keys.ccHot[0].path).toBe("m/1852'/1815'/1'/5/0");
    // The addresses still come from the account xpub.
    expect(keys.payment[0].address).toBe(getAddress(accountXpub(1), Blockchain.CARDANO, Network.PREPROD, 0).toBech32());
  });

  it('keeps account 0 paths for a record created before accounts existed', () => {
    const bg = bootWallet({ publicKey: accountXpub(0) });
    const keys: Keys = bg.resolvePathsForMissingAddresses([]);

    expect(bg.accountIndex).toBe(0);
    expect(keys.payment[0].path).toBe("m/1852'/1815'/0'/0/0");
    expect(keys.stake[0].path).toBe("m/1852'/1815'/0'/2/0");
  });

  it('signs a transaction with that account’s payment key', async () => {
    const bg = bootWallet({ publicKey: accountXpub(1), accountIndex: 1 });
    const keys = bg.resolvePathsForMissingAddresses([]);
    const { txCbor, utxos } = spendFrom(keys.payment[0].address!);

    const { witnesses } = await bg.signTx(txCbor, '', utxos, keys, rootKeyBytes);

    expect(signingKeys(witnesses)).toEqual([getPaymentKeyExternal(accountXpub(1), 0).hex()]);
  });

  it('still signs an account 0 wallet with account 0’s key', async () => {
    const bg = bootWallet({ publicKey: accountXpub(0) });
    const keys = bg.resolvePathsForMissingAddresses([]);
    const { txCbor, utxos } = spendFrom(keys.payment[0].address!);

    const { witnesses } = await bg.signTx(txCbor, '', utxos, keys, rootKeyBytes);

    expect(signingKeys(witnesses)).toEqual([getPaymentKeyExternal(accountXpub(0), 0).hex()]);
  });

  it('refuses to sign when the record’s index and xpub name different accounts', async () => {
    const bg = bootWallet({ publicKey: accountXpub(0), accountIndex: 1 });
    const keys = bg.resolvePathsForMissingAddresses([]);
    const { txCbor, utxos } = spendFrom(keys.payment[0].address!);

    await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(InvalidAccountIndexError);
  });

  it('signs data with that account’s stake key', async () => {
    const bg = bootWallet({ publicKey: accountXpub(1), accountIndex: 1 });
    const keys = bg.resolvePathsForMissingAddresses([]);

    const { key } = await bg.signData(bg.stakeAddress!, 'cafe', '', keys, rootKeyBytes);

    expect(key).toContain(getStakeKey(accountXpub(1), 0).hex());
    expect(key).not.toContain(getStakeKey(accountXpub(0), 0).hex());
  });

  it('refuses a record claiming an account its chain cannot sign for', () => {
    expect(() => bootWallet({ chain: Blockchain.BITCOIN, network: 'Mainnet', publicKey: 'xpub-unused', accountIndex: 1 }))
      .toThrow(InvalidAccountIndexError);
  });
});

describe('WalletBg on an account added under a recovery-phrase wallet', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  it('signs with that account’s key, decrypted from its account #0’s root key', async () => {
    const encryptedPrivateKey = encryptWithPassword('public-test-password', rootKeyBytes.toString('hex'));
    const head = { id: 940_001, name: 'Daily', chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, publicKey: accountXpub(0), encryptionMethod: 'password' as const, encryptedPrivateKey };
    const added = { id: 940_002, name: 'Account #1', chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, publicKey: accountXpub(1), accountIndex: 1, parentWalletId: head.id, encryptionMethod: 'password' as const };
    const bg = new WalletBg(withGroupSecrets(added, [head, added]));
    const keys = bg.resolvePathsForMissingAddresses([]);
    const { txCbor, utxos } = spendFrom(keys.payment[0].address!);

    const { witnesses } = await bg.signTx(txCbor, 'public-test-password', utxos, keys);

    expect(bg.secretsWalletId).toBe(head.id);
    expect(signingKeys(witnesses)).toEqual([getPaymentKeyExternal(accountXpub(1), 0).hex()]);
  });

  it('has nothing to sign with when its account #0 is gone', async () => {
    const added = { id: 940_003, name: 'Account #1', chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, publicKey: accountXpub(1), accountIndex: 1, parentWalletId: 940_999, encryptionMethod: 'password' as const };
    const bg = new WalletBg(withGroupSecrets(added, [added]));
    const keys = bg.resolvePathsForMissingAddresses([]);
    const { txCbor, utxos } = spendFrom(keys.payment[0].address!);

    await expect(bg.signTx(txCbor, 'public-test-password', utxos, keys)).rejects.toThrow();
  });
});

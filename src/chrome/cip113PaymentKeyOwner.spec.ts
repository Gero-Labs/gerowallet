// src/chrome/cip113PaymentKeyOwner.spec.ts
//
// CIP-113 UTxOs whose owner slot holds one of the wallet's PAYMENT keys, the convention
// Minswap V3 pays with. They sit under a different reward address than the wallet's, so:
//  - gero-sync only returns them when the SUBSCRIBE names them (programmableAddresses);
//  - their lovelace is not inside the stake-level `controlled_amount`, so it must be shown
//    as locked without being subtracted from the spendable balance;
//  - they are locked holdings like any other, so a transaction spending one is refused.
// Drives a real WalletBg against a real Dexie (fake-indexeddb) and the real Preview
// deployment constants; only metadata, messaging and the registry read are stubbed.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));
vi.mock('@/api/cip113-registry-api', () => ({ fetchAllPolicyAssets: vi.fn(async () => []) }));

import Dexie from 'dexie';
import { WalletBg, PROGRAMMABLE_SUBSCRIPTION_ADDRESS_CAP } from './walletBg';
import WalletStore, { walletStore, totalProgrammableLockedLovelace, type Account } from '@/stores/walletStore';
import { TransactionsLoader } from '@/db/loaders/walletLoader';
import { getAddress, getPaymentKeyExternal, getPaymentKeyInternal, getRewardAddress, getStakeKey } from './serialization';
import { CIP113_BASE_PREVIEW } from '@/utils/cip113Deployments';
import networks from '@/utils/networks';
import { Blockchain, WalletType } from '@/models/types';

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

// A real CIP-1852 account xpub, so key derivation behaves as it does for a user's wallet.
const XPUB = 'acct_xvk14hczmhwlqeadp0f3m7vzgda9suxdpl73hvwzk9jhmfm3kzv05hwhyxdd40a0hac6u39ws58ek3y0kkcvwx08ds6s80qhasqqgmtgyzcreur64';
const NETWORK = 'Preview';
const PLB = CIP113_BASE_PREVIEW[0];

const STAKE_KEY = getStakeKey(XPUB, 0).hash().hex();
const PAYMENT_KEY_0 = getPaymentKeyExternal(XPUB, 0).hash().hex();

/** A CIP-113 address: the deployed PLB script pays, `owner` sits in the stake slot. */
function programmableAddress(owner: string): string {
  return Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { hash: Hash28ByteBase16(PLB), type: Cardano.CredentialType.ScriptHash },
    { hash: Hash28ByteBase16(owner), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

const ownAddress = getAddress(XPUB, Blockchain.CARDANO, NETWORK, 0).toBech32();
const stakeOwned = programmableAddress(STAKE_KEY);
const paymentOwned = programmableAddress(PAYMENT_KEY_0);

const SPENDABLE_TX = '1'.repeat(64);
const STAKE_OWNED_TX = '2'.repeat(64);
const PAYMENT_OWNED_TX = '3'.repeat(64);
const TOKEN = `${'b'.repeat(56)}${Buffer.from('DUM').toString('hex')}`;

let walletSeq = 0;

function bootWallet(overrides: Record<string, unknown> = {}): WalletBg {
  // A fresh id per test: getDb() caches by `wallet-<id>`.
  walletSeq += 1;
  const wallet = {
    id: 930_000 + walletSeq,
    name: `cip113-owner-${walletSeq}`,
    chain: Blockchain.CARDANO,
    network: NETWORK,
    publicKey: XPUB,
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  const bg = new WalletBg(wallet as any);
  bg.syncService.syncAssets = vi.fn().mockResolvedValue(undefined);
  return bg;
}

function utxo(txId: string, address: string, coins: bigint, assets?: [string, bigint][]): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index: 0, address: address as Cardano.PaymentAddress },
    {
      address: address as Cardano.PaymentAddress,
      value: {
        coins,
        assets: assets ? new Map(assets.map(([u, q]) => [Cardano.AssetId(u), q])) : undefined,
      },
    },
  ] as Cardano.Utxo;
}

const spending = (txId: string) => ({
  body: { inputs: [{ txId: Cardano.TransactionId(txId), index: 0 }] },
} as Cardano.Tx);

describe('CIP-113 holdings owned by a payment key', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  it('shows them as locked holdings, never as spendable', async () => {
    const bg = bootWallet();

    await bg.applyUtxos([
      utxo(SPENDABLE_TX, ownAddress, 10_000_000n),
      utxo(PAYMENT_OWNED_TX, paymentOwned, 2_000_000n, [[TOKEN, 2_004_570n]]),
    ], true);

    expect(walletStore.utxos).toHaveLength(1);
    expect(Object.keys(walletStore.programmableTokens)).toEqual([TOKEN]);
  });

  it('keeps their lovelace out of the share subtracted from controlled_amount', async () => {
    const bg = bootWallet();

    await bg.applyUtxos([
      utxo(SPENDABLE_TX, ownAddress, 10_000_000n),
      utxo(STAKE_OWNED_TX, stakeOwned, 4_000_000n),
      utxo(PAYMENT_OWNED_TX, paymentOwned, 2_000_000n, [[TOKEN, 1n]]),
    ], true);

    expect(walletStore.programmableLockedLovelace).toBe('4000000');
    expect(walletStore.programmableLockedLovelaceOutsideStake).toBe('2000000');
    expect(totalProgrammableLockedLovelace()).toBe(6_000_000n);

    // The provider's stake-level total holds the spendable and the stake-owned locked
    // lovelace only: the payment-owned UTxO sits under another reward address.
    WalletStore.setAccount({ controlled_amount: '14000000' } as Account);
    expect(walletStore.account?.controlled_amount).toBe('10000000');
  });

  it('refuses a transaction spending one', async () => {
    const bg = bootWallet();

    await bg.applyUtxos([
      utxo(SPENDABLE_TX, ownAddress, 10_000_000n),
      utxo(PAYMENT_OWNED_TX, paymentOwned, 2_000_000n, [[TOKEN, 1n]]),
    ], true);

    expect(bg.hasProgrammableInputs()).toBe(true);
    expect(bg.findProgrammableInputs(spending(PAYMENT_OWNED_TX))).toEqual([`${PAYMENT_OWNED_TX}#0`]);
    expect(bg.findProgrammableInputs(spending(SPENDABLE_TX))).toEqual([]);
  });

  it('does not claim one owned by somebody else\'s payment key', async () => {
    const bg = bootWallet();
    const strangers = programmableAddress('0'.repeat(55) + '1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await bg.applyUtxos([
      utxo(SPENDABLE_TX, ownAddress, 10_000_000n),
      utxo(PAYMENT_OWNED_TX, strangers, 2_000_000n, [[TOKEN, 1n]]),
    ], true);

    // The trust-boundary tripwire: gero-sync sent holdings that are not ours.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('owned by other wallets'));
    warn.mockRestore();
    expect(walletStore.programmableTokens).toEqual({});
    expect(totalProgrammableLockedLovelace()).toBe(0n);
    expect(bg.findProgrammableInputs(spending(PAYMENT_OWNED_TX))).toEqual([]);
  });
});

describe('programmableSubscriptionAddresses', () => {
  it('names the CIP-113 address of each payment key, external and internal interleaved', () => {
    const addresses = bootWallet().programmableSubscriptionAddresses();

    expect(addresses.slice(0, 4)).toEqual([
      programmableAddress(PAYMENT_KEY_0),
      programmableAddress(getPaymentKeyInternal(XPUB, 0).hash().hex()),
      programmableAddress(getPaymentKeyExternal(XPUB, 1).hash().hex()),
      programmableAddress(getPaymentKeyInternal(XPUB, 1).hash().hex()),
    ]);
  });

  it('never names the stake-key address, which the stake-address anchor already covers', () => {
    expect(bootWallet().programmableSubscriptionAddresses()).not.toContain(stakeOwned);
  });

  it('covers both chains of the default range within the cap', () => {
    // Default credential range: 20 external + 20 internal keys, one PLB script.
    expect(bootWallet().programmableSubscriptionAddresses()).toHaveLength(40);
  });

  it('stops at the cap gero-sync enforces when the range has grown', () => {
    const bg = bootWallet();
    // expandCredentialsIfNeeded() doubles the range when the server reports a key address
    // past it; drive it up to well beyond the cap.
    for (let i = 0; i < 4; i++) {
      const beyond = getAddress(XPUB, Blockchain.CARDANO, NETWORK, 20 * 2 ** (i + 1) - 1).toBech32();
      bg.expandCredentialsIfNeeded([beyond]);
    }

    const addresses = bg.programmableSubscriptionAddresses();
    expect(addresses).toHaveLength(PROGRAMMABLE_SUBSCRIPTION_ADDRESS_CAP);
    expect(addresses[0]).toBe(programmableAddress(PAYMENT_KEY_0));
  });

  it('uses the watched payment key for a watch wallet', () => {
    const bg = bootWallet({ type: WalletType.Watch, watchAddress: ownAddress, publicKey: '' });

    expect(bg.programmableSubscriptionAddresses()).toEqual([programmableAddress(PAYMENT_KEY_0)]);
  });

  it('is empty where CIP-113 is off', () => {
    const spy = vi.spyOn(networks, 'resolveProgrammableLogicBaseScriptHashes').mockReturnValue([]);
    try {
      expect(bootWallet().programmableSubscriptionAddresses()).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('transaction history of CIP-113 holdings', () => {
  const TX = 'a'.repeat(64);
  let dbSeq = 0;

  /** One stored transaction paying `outputs`, run through the real loader with the real matcher. */
  async function historyRow(outputs: { address: string; amount: { unit: string; quantity: number }[] }[]) {
    const bg = bootWallet();
    dbSeq += 1;
    const db = new Dexie(`cip113-history-${dbSeq}`);
    db.version(1).stores({ transactions: 'id' });
    await db.open();
    const loader = new TransactionsLoader(async () => db, {
      baseAddress: ownAddress,
      stakeAddress: getRewardAddress(XPUB, Blockchain.CARDANO, NETWORK).toBech32(),
      chain: Blockchain.CARDANO,
      network: NETWORK,
      isEnterpriseAddress: () => false,
      // As LoaderFactory wires it from WalletBg.
      ownProgrammableAddressMatcher: () => bg.ownProgrammableAddressMatcher(),
      networkId: () => 0,
      setUtxosAndAddresses: async () => {},
    });
    try {
      await db.table('transactions').put({
        id: TX, tx_hash: TX, tx_timestamp: 1,
        utxo: { inputs: [], outputs: outputs.map((o, i) => ({ output_index: i, ...o })) },
      });
      await loader.load();
      await vi.waitFor(() => expect(walletStore.transactions).toHaveLength(1));
      return walletStore.transactions[0];
    } finally {
      loader.unsubscribe();
      await db.delete();
    }
  }

  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  // A Minswap V3 fill pays only the payment-key-owned CIP-113 address.
  it('shows a payment-key-owned receipt instead of an empty row', async () => {
    const row = await historyRow([{
      address: paymentOwned,
      amount: [{ unit: 'lovelace', quantity: 2_000_000 }, { unit: TOKEN, quantity: 123 }],
    }]);

    expect(row.receivedAssets).toEqual([expect.objectContaining({ unit: TOKEN, quantity: 123 })]);
    expect(row.receivedAmount).toBe(2_000_000);
  });

  it('shows a stake-key-owned receipt the same way', async () => {
    const row = await historyRow([{
      address: stakeOwned,
      amount: [{ unit: 'lovelace', quantity: 4_000_000 }, { unit: TOKEN, quantity: 7 }],
    }]);

    expect(row.receivedAssets).toEqual([expect.objectContaining({ unit: TOKEN, quantity: 7 })]);
  });

  // The DeFi-deposit rule stands for every other script: one carrying the wallet's stake
  // key is still foreign to history accounting.
  it('still ignores another script address carrying the wallet\'s stake key', async () => {
    const otherScript = Cardano.BaseAddress.fromCredentials(
      Cardano.NetworkId.Testnet,
      { hash: Hash28ByteBase16('c'.repeat(56)), type: Cardano.CredentialType.ScriptHash },
      { hash: Hash28ByteBase16(STAKE_KEY), type: Cardano.CredentialType.KeyHash },
    ).toAddress().toBech32();

    const row = await historyRow([{
      address: otherScript,
      amount: [{ unit: 'lovelace', quantity: 5_000_000 }, { unit: TOKEN, quantity: 1 }],
    }]);

    expect(row.receivedAssets).toEqual([]);
    expect(row.receivedAmount).toBe(0);
  });
});

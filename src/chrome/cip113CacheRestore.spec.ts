// src/chrome/cip113CacheRestore.spec.ts
//
// Regression tests for the three ways the CIP-113 locked share could go missing, all of
// them rooted in `walletStore.programmableLockedLovelace` being in-memory state that an
// MV3 service-worker restart destroys. These drive a real WalletBg against a real Dexie
// (fake-indexeddb) and the real Preview deployment constants — the only stubs are the
// two I/O boundaries a unit test cannot cross: asset metadata fetch and the cross-context
// messaging bus.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import WalletStore, { walletStore, type Account } from '@/stores/walletStore';
import { getAddress, getStakeKey } from './serialization';
import { serializeUtxoRows } from './utxoCache';
import { getDb, setWalletConfiguration } from '@/db/wallet-db';
import { CIP113_BASE_PREVIEW } from '@/utils/cip113Deployments';
import { Blockchain } from '@/models/types';

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

// A real CIP-1852 account xpub (derived from a fixed seed), so BIP44 derivation and the
// address plumbing behave exactly as they do for a user's wallet.
const XPUB = 'acct_xvk14hczmhwlqeadp0f3m7vzgda9suxdpl73hvwzk9jhmfm3kzv05hwhyxdd40a0hac6u39ws58ek3y0kkcvwx08ds6s80qhasqqgmtgyzcreur64';
const NETWORK = 'Preview';

const SPENDABLE_TX = '1'.repeat(64);
const PROGRAMMABLE_TX = '2'.repeat(64);
const SPENDABLE_COINS = 10_000_000n;
const LOCKED_COINS = 4_000_000n;
/** What the provider reports for the stake address: both halves, in one number. */
const CONTROLLED_TOTAL = (SPENDABLE_COINS + LOCKED_COINS).toString();

const TOKEN = `${'a'.repeat(56)}${Buffer.from('LOCKED').toString('hex')}`;

let walletSeq = 0;

function makeWallet() {
  // A fresh id per test: getDb() caches by `wallet-<id>`, so this is what isolates the
  // per-wallet DB between tests.
  walletSeq += 1;
  return {
    id: 900_000 + walletSeq,
    name: `cip113-test-${walletSeq}`,
    chain: Blockchain.CARDANO,
    network: NETWORK,
    publicKey: XPUB,
  };
}

/** A WalletBg with the asset-metadata fetch stubbed — the only network call in this path. */
function bootWallet(wallet: ReturnType<typeof makeWallet>): WalletBg {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  const bg = new WalletBg(wallet as any);
  bg.syncService.syncAssets = vi.fn().mockResolvedValue(undefined);
  return bg;
}

const ownAddress = getAddress(XPUB, Blockchain.CARDANO, NETWORK, 0).toBech32();

/** The CIP-113 franken-address: the deployed PLB script pays, this wallet's stake key owns. */
const programmableAddress = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Testnet,
  { hash: Hash28ByteBase16(CIP113_BASE_PREVIEW[0]), type: Cardano.CredentialType.ScriptHash },
  { hash: Hash28ByteBase16(getStakeKey(XPUB, 0).hash().hex()), type: Cardano.CredentialType.KeyHash },
).toAddress().toBech32();

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

const spendableUtxo = () => utxo(SPENDABLE_TX, ownAddress, SPENDABLE_COINS);
const programmableUtxo = () => utxo(PROGRAMMABLE_TX, programmableAddress, LOCKED_COINS, [[TOKEN, 7n]]);

/** A transaction spending the programmable UTxO, as a dApp would build it. */
const txSpendingProgrammable = {
  body: { inputs: [{ txId: Cardano.TransactionId(PROGRAMMABLE_TX), index: 0 }] },
} as Cardano.Tx;

/**
 * What `walletManager.login()` does to the store on a fresh service worker: `this.walletBg`
 * is null, so it takes the clearForWalletSwitch() branch and everything hydrated out of
 * chrome.storage.local is discarded. Only the per-wallet DB survives.
 */
function simulateWorkerRestart() {
  WalletStore.clearForWalletSwitch();
  expect(walletStore.programmableLockedLovelace).toBe('0');
}

/** The cached-load block of walletManager.login(), in its real order. */
async function loginFromCache(bg: WalletBg) {
  await bg.loadProgrammableRefs();
  await bg.loadCachedUtxos();
  await bg.loadCachedAccount();
}

describe('CIP-113 locked share across a service-worker restart', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  it('keeps the locked lovelace out of the spendable balance after a live push', async () => {
    const bg = bootWallet(makeWallet());

    await bg.applyUtxos([spendableUtxo(), programmableUtxo()], true);
    WalletStore.setAccount({ controlled_amount: CONTROLLED_TOTAL } as Account);

    expect(walletStore.programmableLockedLovelace).toBe(LOCKED_COINS.toString());
    expect(walletStore.account?.controlled_amount).toBe(SPENDABLE_COINS.toString());
    // The partition itself: only the spendable half can be selected as an input.
    expect(walletStore.utxos).toHaveLength(1);
  });

  // Finding 1. The cache used to hold the spendable half only, so the restored wallet had
  // no idea any lovelace was locked and applied the stake-level total unadjusted — Send
  // max and swap sizing read the locked ADA as spendable until the next live sync.
  it('still knows the lovelace is locked after a restart, with no live sync', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    await bg.applyUtxos([spendableUtxo(), programmableUtxo()], true);
    await bg.setAccountInfo({ controlled_amount: CONTROLLED_TOTAL });

    simulateWorkerRestart();
    await loginFromCache(bootWallet(wallet));

    expect(walletStore.programmableLockedLovelace).toBe(LOCKED_COINS.toString());
    expect(walletStore.account?.controlled_amount).toBe(SPENDABLE_COINS.toString());
  });

  it('restores the locked holdings themselves, not just their lovelace', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    await bg.applyUtxos([spendableUtxo(), programmableUtxo()], true);

    simulateWorkerRestart();
    await loginFromCache(bootWallet(wallet));

    expect(Object.keys(walletStore.programmableTokens)).toEqual([TOKEN]);
    expect(walletStore.utxos).toHaveLength(1);
  });

  it('re-arms the signing guard from the restored partition', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    await bg.applyUtxos([spendableUtxo(), programmableUtxo()], true);

    simulateWorkerRestart();
    const restarted = bootWallet(wallet);
    await loginFromCache(restarted);

    expect(restarted.findProgrammableInputs(txSpendingProgrammable))
      .toEqual([`${PROGRAMMABLE_TX}#0`]);
  });

  // Finding 3. reconcileControlledAmountFromUtxos() adds the locked share back onto the
  // spendable sum to keep the persisted `account` row on the provider's stake-level
  // meaning. Run after a restart with the partition unknown, it added zero and wrote a
  // row the store would then subtract the locked share from a second time.
  it('reconciles an account row that still carries the locked share after a restart', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    await bg.applyUtxos([spendableUtxo(), programmableUtxo()], true);

    simulateWorkerRestart();
    const restarted = bootWallet(wallet);
    await loginFromCache(restarted);
    await restarted.syncService['reconcileControlledAmountFromUtxos']();

    // The row keeps the unadjusted total…
    const row = await restarted.getAccountInfo();
    expect(row.controlled_amount).toBe(CONTROLLED_TOTAL);
    // …and the store still shows only the spendable share once it is applied.
    WalletStore.setAccount(row as Account);
    expect(walletStore.account?.controlled_amount).toBe(SPENDABLE_COINS.toString());
  });
});

// Finding 2. applyUtxos() returned at the empty-list check before the partition was
// touched, so holdings that went away stayed on the books: the locked share kept being
// subtracted from every later account push, and the refusal index kept refusing inputs
// the wallet no longer had.
describe('CIP-113 partition when the holdings go away', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  it('clears the locked share when a push arrives with no UTxOs', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), programmableUtxo()], true);

    await bg.applyUtxos([], true);

    expect(walletStore.programmableLockedLovelace).toBe('0');
    expect(walletStore.programmableTokens).toEqual({});
  });

  it('stops subtracting the vanished locked share from the account', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), programmableUtxo()], true);

    await bg.applyUtxos([], true);
    WalletStore.setAccount({ controlled_amount: SPENDABLE_COINS.toString() } as Account);

    expect(walletStore.account?.controlled_amount).toBe(SPENDABLE_COINS.toString());
  });

  it('stops refusing inputs the wallet no longer holds', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), programmableUtxo()], true);

    await bg.applyUtxos([], true);

    expect(bg.findProgrammableInputs(txSpendingProgrammable)).toEqual([]);
  });

  it('does not resurrect the cleared holdings from the cache on the next restart', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    await bg.applyUtxos([spendableUtxo(), programmableUtxo()], true);
    await bg.applyUtxos([], true);

    simulateWorkerRestart();
    await loginFromCache(bootWallet(wallet));

    expect(walletStore.programmableLockedLovelace).toBe('0');
  });
});

// Superseded deployments are removed from cip113Deployments.ts rather than retained (see
// the policy in its header). This pins what removal means for a UTxO still sitting at a
// removed script with this wallet's stake key, next to one at the current deployment. The
// removed hash is a literal on purpose: it must not follow the constants file.
describe('CIP-113 holdings at a removed deployment', () => {
  const REMOVED_PREVIEW_PLB = '698c48a630206282690774aebcfa9410895c09f85bc103b19f9888dc';
  const REMOVED_TX = '3'.repeat(64);
  const REMOVED_COINS = 4_000_000n;
  const REMOVED_TOKEN = `${'b'.repeat(56)}${Buffer.from('OLD').toString('hex')}`;

  const removedAddress = Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { hash: Hash28ByteBase16(REMOVED_PREVIEW_PLB), type: Cardano.CredentialType.ScriptHash },
    { hash: Hash28ByteBase16(getStakeKey(XPUB, 0).hash().hex()), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
  const removedUtxo = () => utxo(REMOVED_TX, removedAddress, REMOVED_COINS, [[REMOVED_TOKEN, 3n]]);
  const txSpendingRemoved = {
    body: { inputs: [{ txId: Cardano.TransactionId(REMOVED_TX), index: 0 }] },
  } as Cardano.Tx;

  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  it('is not a configured deployment', () => {
    expect(CIP113_BASE_PREVIEW).not.toContain(REMOVED_PREVIEW_PLB);
  });

  it('is never spendable, so it cannot enter coin selection', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), programmableUtxo(), removedUtxo()], true);

    expect(walletStore.utxos).toHaveLength(1);
    expect(walletStore.utxos[0][0].txId).toBe(SPENDABLE_TX);
  });

  it('is not displayed and its lovelace is not counted as locked', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), programmableUtxo(), removedUtxo()], true);

    expect(Object.keys(walletStore.programmableTokens)).toEqual([TOKEN]);
    expect(walletStore.programmableLockedLovelace).toBe(LOCKED_COINS.toString());
  });

  // The stated cost of removal: the provider's stake-level total includes the removed
  // deployment's lovelace, and only the current deployment's share is subtracted from it.
  it('leaves its lovelace inside the stake-level account figure', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), programmableUtxo(), removedUtxo()], true);
    WalletStore.setAccount({ controlled_amount: (SPENDABLE_COINS + LOCKED_COINS + REMOVED_COINS).toString() } as Account);

    expect(walletStore.account?.controlled_amount).toBe((SPENDABLE_COINS + REMOVED_COINS).toString());
  });

  // Signing: only the current deployment's holdings are in the refusal index.
  it('is not refused for signing, while the current deployment still is', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), programmableUtxo(), removedUtxo()], true);

    expect(bg.findProgrammableInputs(txSpendingRemoved)).toEqual([]);
    expect(bg.findProgrammableInputs(txSpendingProgrammable)).toEqual([`${PROGRAMMABLE_TX}#0`]);
  });

  // The upgrade path: a cache written by a build that still configured this hash holds the
  // UTxO tagged 'programmable' and its ref in the persisted refusal index. Login must
  // re-classify it rather than trust either row.
  it('drops a cache written while the deployment was still configured', async () => {
    const wallet = makeWallet();
    const db = await getDb(wallet.id);
    await db.table('utxos').bulkPut([
      ...serializeUtxoRows([spendableUtxo()], 'spendable'),
      ...serializeUtxoRows([removedUtxo()], 'programmable'),
    ]);
    await setWalletConfiguration(wallet.id, 'cip113ProgrammableInputRefs', JSON.stringify([`${REMOVED_TX}#0`]));

    const upgraded = bootWallet(wallet);
    await loginFromCache(upgraded);

    expect(walletStore.utxos).toHaveLength(1);
    expect(walletStore.programmableTokens).toEqual({});
    expect(walletStore.programmableLockedLovelace).toBe('0');
    expect(upgraded.findProgrammableInputs(txSpendingRemoved)).toEqual([]);
    expect(upgraded.hasProgrammableInputs()).toBe(false);
  });

  it('behaves the same after a service-worker restart', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    await bg.applyUtxos([spendableUtxo(), programmableUtxo(), removedUtxo()], true);

    simulateWorkerRestart();
    const restarted = bootWallet(wallet);
    await loginFromCache(restarted);

    expect(walletStore.utxos).toHaveLength(1);
    expect(Object.keys(walletStore.programmableTokens)).toEqual([TOKEN]);
    expect(walletStore.programmableLockedLovelace).toBe(LOCKED_COINS.toString());
    expect(restarted.findProgrammableInputs(txSpendingRemoved)).toEqual([]);
    expect(restarted.findProgrammableInputs(txSpendingProgrammable)).toEqual([`${PROGRAMMABLE_TX}#0`]);
  });
});

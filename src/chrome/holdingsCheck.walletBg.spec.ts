// The background's half of holdingsCheck.ts: what gero-sync reports is checked
// against an independent indexer, and what the indexer disproves stops being shown.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import type { IndexedOutput } from './holdingsCheck';

const indexer = vi.hoisted(() => ({
  known: new Map<string, IndexedOutput>(),
  total: null as bigint | null,
  outputs: vi.fn(),
}));

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));
vi.mock('@/api/cip113-registry-api', () => ({ fetchAllPolicyAssets: vi.fn(async () => []) }));
vi.mock('./holdingsCheck', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./holdingsCheck')>()),
  koiosOutputSource: () => indexer.outputs,
  koiosAccountTotalSource: () => async () => indexer.total,
}));

import { WalletBg } from './walletBg';
import WalletStore, { walletStore, type Account } from '@/stores/walletStore';
import { CONFIRM_GRACE_MS } from './holdingsCheck';
import { getAddress } from './serialization';
import { Blockchain } from '@/models/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stand-in for the chrome namespace
(globalThis as any).chrome = {
  alarms: {
    getAll: (cb: (alarms: unknown[]) => void) => cb([]),
    clear: vi.fn(),
    create: vi.fn(),
    onAlarm: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: () => false },
  },
  storage: { local: { set: vi.fn(), get: vi.fn() } },
  runtime: { id: 'gero-test' },
};

const XPUB = 'acct_xvk14hczmhwlqeadp0f3m7vzgda9suxdpl73hvwzk9jhmfm3kzv05hwhyxdd40a0hac6u39ws58ek3y0kkcvwx08ds6s80qhasqqgmtgyzcreur64';
const NETWORK = 'Mainnet';
const ownAddress = getAddress(XPUB, Blockchain.CARDANO, NETWORK, 0).toBech32();
const REAL = '1'.repeat(64);
const FAKE = 'f'.repeat(64);

function utxo(txId: string, coins: bigint): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index: 0, address: ownAddress as Cardano.PaymentAddress },
    { address: ownAddress as Cardano.PaymentAddress, value: { coins } },
  ] as Cardano.Utxo;
}

let walletSeq = 0;
function bootWallet(): WalletBg {
  walletSeq += 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  const bg = new WalletBg({ id: 940_000 + walletSeq, name: `holdings-${walletSeq}`, chain: Blockchain.CARDANO, network: NETWORK, publicKey: XPUB } as any);
  bg.syncService.syncAssets = vi.fn().mockResolvedValue(undefined);
  return bg;
}

describe('holdings reported by gero-sync, checked against an independent indexer', () => {
  let now = 1_000_000;
  let bg: WalletBg | null = null;

  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
    WalletStore.setHoldingsWarning(null);
    indexer.known = new Map([[`${REAL}#0`, { address: ownAddress, coins: 5_000_000n, assets: new Map(), spent: false }]]);
    indexer.total = 5_000_000n;
    indexer.outputs.mockReset().mockImplementation(async (refs: string[]) =>
      new Map(refs.filter((r) => indexer.known.has(r)).map((r) => [r, indexer.known.get(r)!])));
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    bg?.unsubscribeAll();
    vi.restoreAllMocks();
  });

  it('stops showing a fabricated UTxO the indexer never confirms, and says why', async () => {
    bg = bootWallet();
    WalletStore.setAccount({ controlled_amount: '500005000000' } as Account);
    await bg.applyUtxos([utxo(REAL, 5_000_000n), utxo(FAKE, 500_000_000_000n)], true);
    expect(walletStore.utxos).toHaveLength(2);

    await bg.runHoldingsCheck();
    expect(walletStore.utxos).toHaveLength(2); // the indexer may just be behind
    expect(walletStore.holdingsWarning).toBeNull();

    now += CONFIRM_GRACE_MS;
    await bg.runHoldingsCheck();
    expect((walletStore.utxos as Cardano.Utxo[]).map(([input]) => input.txId)).toEqual([REAL]);
    expect(walletStore.holdingsWarning).toEqual({ walletId: bg.id, chainTotal: '5000000' });

    // The next push from gero-sync carries it again: it stays hidden.
    await bg.applyUtxos([utxo(REAL, 5_000_000n), utxo(FAKE, 500_000_000_000n)], true);
    expect((walletStore.utxos as Cardano.Utxo[]).map(([input]) => input.txId)).toEqual([REAL]);
  });

  it('hides at once a UTxO whose value the indexer contradicts', async () => {
    bg = bootWallet();
    WalletStore.setAccount({ controlled_amount: '5000000' } as Account);
    await bg.applyUtxos([utxo(REAL, 500_000_000_000n)], true);
    await bg.runHoldingsCheck();
    expect(walletStore.utxos).toHaveLength(0);
    expect(walletStore.holdingsWarning?.walletId).toBe(bg.id);
  });

  it('leaves a balance the indexer agrees with alone', async () => {
    bg = bootWallet();
    WalletStore.setAccount({ controlled_amount: '5000000' } as Account);
    await bg.applyUtxos([utxo(REAL, 5_000_000n)], true);
    await bg.runHoldingsCheck();
    now += CONFIRM_GRACE_MS;
    await bg.runHoldingsCheck();
    expect(walletStore.utxos).toHaveLength(1);
    expect(walletStore.holdingsWarning).toBeNull();
  });

  it('checks nothing outside the extension', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the chrome stand-in above
    const runtime = (globalThis as any).chrome.runtime;
    delete runtime.id;
    try {
      bg = bootWallet();
      await bg.applyUtxos([utxo(FAKE, 500_000_000_000n)], true);
      now += CONFIRM_GRACE_MS;
      await bg.runHoldingsCheck();
      expect(indexer.outputs).not.toHaveBeenCalled();
      expect(walletStore.utxos).toHaveLength(1);
    } finally {
      runtime.id = 'gero-test';
    }
  });
});

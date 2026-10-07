// src/chrome/watchWalletSubscription.spec.ts
//
// A watch wallet absorbs the payment credential of every sibling address gero-sync
// reports, and the caller resubscribes with whatever expandCredentialsIfNeeded()
// returns. resubscribe() REPLACES the socket's credential set, so on a CIP-113-configured
// network that return value must stay the empty list: a payment-key allowlist never
// matches the programmable_logic_base script address, and the next push would drop the
// programmable UTxOs (and overstate the balance by their locked lovelace).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import { getAddress } from './serialization';
import WalletStore, { walletStore } from '@/stores/walletStore';
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

// A real CIP-1852 account xpub, used only to produce a well-formed watched base address.
const XPUB = 'acct_xvk14hczmhwlqeadp0f3m7vzgda9suxdpl73hvwzk9jhmfm3kzv05hwhyxdd40a0hac6u39ws58ek3y0kkcvwx08ds6s80qhasqqgmtgyzcreur64';
const NETWORK = 'Preview';

const watchedAddress = getAddress(XPUB, Blockchain.CARDANO, NETWORK, 0);
const SIBLING_PAYMENT = '00000000000000000000000000000000000000000000000000000001';

/** A sibling the watched wallet controls: another payment key under the same stake key. */
const siblingAddress = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Testnet,
  { hash: Hash28ByteBase16(SIBLING_PAYMENT), type: Cardano.CredentialType.KeyHash },
  watchedAddress.asBase()!.getStakeCredential(),
).toAddress().toBech32();

/** The CIP-113 address owned by the watched wallet: PLB script pays, its stake key owns. */
const programmableAddress = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Testnet,
  { hash: Hash28ByteBase16(CIP113_BASE_PREVIEW[0]), type: Cardano.CredentialType.ScriptHash },
  watchedAddress.asBase()!.getStakeCredential(),
).toAddress().toBech32();

let walletSeq = 0;

function bootWatchWallet(): WalletBg {
  // A fresh id per wallet: getDb() caches by `wallet-<id>`.
  walletSeq += 1;
  const wallet = {
    id: 910_000 + walletSeq,
    name: 'watch-test',
    chain: Blockchain.CARDANO,
    network: NETWORK,
    type: WalletType.Watch,
    watchAddress: watchedAddress.toBech32(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  const bg = new WalletBg(wallet as any);
  bg.syncService.syncAssets = vi.fn().mockResolvedValue(undefined);
  return bg;
}

function utxo(txId: string, address: string, coins: bigint): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index: 0, address: address as Cardano.PaymentAddress },
    { address: address as Cardano.PaymentAddress, value: { coins } },
  ] as Cardano.Utxo;
}

describe('watch wallet resubscribe credentials', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the empty CIP-113 subscription when it absorbs a sibling address', () => {
    const bg = bootWatchWallet();
    expect(bg.subscriptionCredentials()).toEqual([]);

    expect(bg.expandCredentialsIfNeeded([siblingAddress])).toEqual([]);
  });

  it('still absorbs the sibling credential for the client-side partition', () => {
    const bg = bootWatchWallet();
    bg.expandCredentialsIfNeeded([siblingAddress]);

    expect(bg.derivePaymentCredentials()).toContain(SIBLING_PAYMENT);
  });

  it('converges: replaying the same addresses does not resubscribe again', () => {
    const bg = bootWatchWallet();
    bg.expandCredentialsIfNeeded([siblingAddress]);

    expect(bg.expandCredentialsIfNeeded([siblingAddress])).toBeNull();
  });

  it('sends the payment-key allowlist, sibling included, where CIP-113 is not configured', () => {
    // A network with no CIP-113 deployment configured.
    vi.spyOn(networks, 'resolveProgrammableLogicBaseScriptHashes').mockReturnValue([]);
    const bg = bootWatchWallet();

    const expanded = bg.expandCredentialsIfNeeded([siblingAddress]);

    expect(expanded).toContain(SIBLING_PAYMENT);
    expect(expanded).toEqual(bg.subscriptionCredentials());
  });

  // With the filter off the server reports the programmable-token script address under
  // the watched stake key. Its hash is a script, not one of this wallet's payment keys.
  it('does not absorb the programmable-token script address as a payment credential', () => {
    const bg = bootWatchWallet();

    expect(bg.expandCredentialsIfNeeded([programmableAddress])).toBeNull();
    expect(bg.derivePaymentCredentials()).not.toContain(CIP113_BASE_PREVIEW[0]);
  });
});

describe('watch wallet CIP-113 partition', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  it('keeps its own programmable UTxO out of the spendable set after a sibling absorb', async () => {
    const bg = bootWatchWallet();
    bg.expandCredentialsIfNeeded([siblingAddress, programmableAddress]);

    await bg.applyUtxos([
      utxo('1'.repeat(64), watchedAddress.toBech32(), 10_000_000n),
      utxo('2'.repeat(64), programmableAddress, 4_000_000n),
    ], true);

    expect(walletStore.utxos).toHaveLength(1);
    expect(walletStore.programmableLockedLovelace).toBe('4000000');
  });
});

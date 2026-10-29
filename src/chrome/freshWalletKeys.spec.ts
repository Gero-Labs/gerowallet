// src/chrome/freshWalletKeys.spec.ts
//
// Where CIP-113 is configured (mainnet, preprod and preview), the wallet subscribes to
// gero-sync with `credentials: []`, and gero-sync then reports only the addresses that
// already have on-chain history (nexus /api/account/{stake}/addresses). For a wallet that
// has never been used that list is empty, so the server never names an address to derive
// keys from. Keys used to come only from that list (or from a row a previous sync cached),
// which left a brand-new software wallet with no keys at all: no receive address, no DRep
// ID, and no stake key to sign the wallet-control proof with. The wallet derives them
// itself now. These drive a real WalletBg against a real Dexie (fake-indexeddb).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import WalletStore, { walletStore } from '@/stores/walletStore';
import { getAddress, getStakeKey } from './serialization';
import { getDb } from '@/db/wallet-db';
import { CIP113_BASE_PREPROD } from '@/utils/cip113Deployments';
import { Blockchain, Network, WalletType, type Keys } from '@/models/types';

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

let walletSeq = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
function bootWallet(fields: Record<string, unknown>, googleBaseAddress?: string): WalletBg {
  // A fresh id per wallet: getDb() caches by `wallet-<id>`, so this is what isolates the
  // per-wallet DB between tests.
  walletSeq += 1;
  const wallet = { id: 920_000 + walletSeq, name: `fresh-${walletSeq}`, chain: Blockchain.CARDANO, ...fields };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  const bg = new WalletBg(wallet as any, googleBaseAddress);
  bg.syncService.syncAssets = vi.fn().mockResolvedValue(undefined);
  return bg;
}

const softwareWallet = (network: string) => bootWallet({ network, publicKey: XPUB, type: WalletType.Normal });

function utxo(txId: string, address: string, coins: bigint): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index: 0, address: address as Cardano.PaymentAddress },
    { address: address as Cardano.PaymentAddress, value: { coins } },
  ] as Cardano.Utxo;
}

describe('fresh software wallet on a CIP-113 network', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  it.each([Network.MAINNET, Network.PREPROD, Network.PREVIEW])(
    'has a receive address, stake key and DRep ID on %s before gero-sync names any address',
    async (network) => {
      const bg = softwareWallet(network);
      // The trigger: gero-sync answers this subscription with `addresses: []`.
      expect(bg.subscriptionCredentials()).toEqual([]);

      await bg.loadCachedKeys();

      const keys = walletStore.keys as Keys;
      expect(keys?.payment?.[0]?.address).toBe(getAddress(XPUB, Blockchain.CARDANO, network, 0).toBech32());
      expect(keys.payment[0].path).toBe("m/1852'/1815'/0'/0/0");
      expect(keys.stake[0].address).toBe(bg.stakeAddress);
      expect(keys.stake[0].cred).toBe(getStakeKey(XPUB, 0).hash().hex());
      expect(keys.drep129[0].address).toMatch(/^drep1/);
      // Nothing has been seen on chain, so nothing is reported as used (CIP-30 getUsedAddresses).
      expect([...keys.payment, ...keys.change].some((k) => k.used)).toBe(false);
    },
  );

  it('does not let an empty server answer wipe the derived keys', async () => {
    const bg = softwareWallet(Network.PREPROD);
    await bg.loadCachedKeys();
    const derived = walletStore.keys;
    expect(derived).not.toBeNull();

    expect(await bg.syncService.syncKeys([])).toBeNull();

    expect(walletStore.keys).toBe(derived);
  });

  it('lets a later server answer naming a used address refine the derived keys', async () => {
    const bg = softwareWallet(Network.PREPROD);
    await bg.loadCachedKeys();
    const first = getAddress(XPUB, Blockchain.CARDANO, Network.PREPROD, 0).toBech32();

    await bg.syncService.syncKeys([first]);

    expect((walletStore.keys as Keys).payment[0]).toMatchObject({ address: first, used: true });
  });

  it('restores a cached key row instead of re-deriving it', async () => {
    const bg = softwareWallet(Network.PREPROD);
    const cached = bg.resolvePathsForMissingAddresses([getAddress(XPUB, Blockchain.CARDANO, Network.PREPROD, 3).toBech32()]);
    const db = await getDb(bg.id);
    await db.table('addresses').put({ address: XPUB, resolvedKeys: cached });

    await bg.loadCachedKeys();

    expect(walletStore.keys).toEqual(cached);
    expect((walletStore.keys as Keys).payment[3].used).toBe(true);
  });

  it('keeps its own programmable UTxO out of the spendable set', async () => {
    const bg = softwareWallet(Network.PREPROD);
    await bg.loadCachedKeys();
    const own = getAddress(XPUB, Blockchain.CARDANO, Network.PREPROD, 0).toBech32();
    const programmable = Cardano.BaseAddress.fromCredentials(
      Cardano.NetworkId.Testnet,
      { hash: Hash28ByteBase16(CIP113_BASE_PREPROD[0]), type: Cardano.CredentialType.ScriptHash },
      { hash: Hash28ByteBase16(getStakeKey(XPUB, 0).hash().hex()), type: Cardano.CredentialType.KeyHash },
    ).toAddress().toBech32();

    await bg.applyUtxos([utxo('1'.repeat(64), own, 10_000_000n), utxo('2'.repeat(64), programmable, 4_000_000n)], true);

    expect(walletStore.utxos).toHaveLength(1);
    expect(walletStore.programmableLockedLovelace).toBe('4000000');
    const keys = walletStore.keys as Keys;
    expect([...keys.payment, ...keys.change].map((k) => k.address)).not.toContain(programmable);
  });

  it('derives a watch wallet\'s keys from the watched address', async () => {
    const watched = getAddress(XPUB, Blockchain.CARDANO, Network.PREPROD, 0).toBech32();
    const bg = bootWallet({ network: Network.PREPROD, type: WalletType.Watch, watchAddress: watched });

    await bg.loadCachedKeys();

    expect((walletStore.keys as Keys).payment.map((k) => k.address)).toEqual([watched]);
  });

  // Its address comes from a contract, not from HD derivation: keys derived from the xpub
  // would show the user an address the wallet does not sync.
  it('derives nothing for a legacy contract-address Google wallet', async () => {
    const contractAddress = getAddress(XPUB, Blockchain.CARDANO, Network.PREPROD, 7).toBech32();
    const bg = bootWallet({ network: Network.PREPROD, publicKey: XPUB, type: WalletType.Google }, contractAddress);

    await bg.loadCachedKeys();

    expect(walletStore.keys).toBeNull();
  });
});

describe('Keystone wallet record', () => {
  // The Keystone signers read the paired firmware version through loggedWallet, which
  // walletManager builds from these fields.
  it('carries the fingerprint and paired firmware version from the record', () => {
    const bg = bootWallet({ network: Network.MAINNET, publicKey: XPUB, type: WalletType.Keystone, xfp: '0a1b2c3d', firmwareVersion: '3.2.0' });

    expect(bg.xfp).toBe('0a1b2c3d');
    expect(bg.firmwareVersion).toBe('3.2.0');
  });
});

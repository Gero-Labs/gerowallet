// WalletBg.signTx and the NFT market guard: a transaction that creates a Gero listing or spends
// one of the wallet's own is refused unless it is the exact transaction a prepare handler verified
// and granted an allowance for, and then it is signed once. Drives a real WalletBg (real Dexie via
// fake-indexeddb, real key derivation) with the public "abandon ... art" test phrase.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16, type Bip32PrivateKey } from '@cardano-sdk/crypto';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from '@/chrome/walletBg';
import WalletStore from '@/stores/walletStore';
import { getPaymentKeyExternal, getStakeKey } from '@/chrome/serialization';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { setWalletConfiguration } from '@/db/wallet-db';
import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { clearCip113SignAllowance, grantCip113SignAllowance } from '@/chrome/cip113Allowance';
import { NFT_MARKET_DEPLOYMENTS_PREPROD } from '@/utils/nftMarketDeployments';
import { Blockchain, CoinTypes, HARDENED, Network, WalletType, WalletTypePurpose } from '@/models/types';
import {
  NFT_MARKET_SIGN_REFUSAL_MESSAGE,
  clearMarketSignAllowance,
  grantMarketSignAllowance,
  hasMarketSignAllowance,
} from './marketAllowance';
import { findMarketTouch } from './marketGuard';
import type { OwnListing } from './ownListings';

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

const V1 = NFT_MARKET_DEPLOYMENTS_PREPROD[0];
const rootKey: Bip32PrivateKey = resolvePrivateKey(`${'abandon '.repeat(23)}art`);
const rootKeyBytes = Buffer.from(rootKey.bytes());
const XPUB = bech32.encode(
  'xpub',
  bech32.toWords(Buffer.from(rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED]).toPublic().hex(), 'hex')),
  1023,
);

const FEE_TX = 'f1'.repeat(32);
const LISTING_TX = 'b1'.repeat(32);
const OTHER_LISTING_TX = 'b2'.repeat(32);
const PROGRAMMABLE_TX = 'c1'.repeat(32);
const LISTING_REF = `${LISTING_TX}#0`;
const NFT = `${'e'.repeat(56)}${Buffer.from('Gero NFT').toString('hex')}`;

let walletSeq = 0;
async function bootWallet(network: string = Network.PREPROD): Promise<WalletBg> {
  walletSeq += 1;
  const id = 950_000 + walletSeq;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  const bg = new WalletBg({ id, name: `market-${walletSeq}`, chain: Blockchain.CARDANO, network, type: WalletType.Normal, publicKey: XPUB } as any);
  await setWalletConfiguration(id, 'cip113ProgrammableInputRefs', JSON.stringify([`${PROGRAMMABLE_TX}#0`]));
  await bg.loadProgrammableRefs();
  return bg;
}

/** The listing's address: the listing script, the wallet's own stake key. */
const listingAddress = () =>
  Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { hash: Hash28ByteBase16(V1.scriptHash), type: Cardano.CredentialType.ScriptHash },
    { hash: Hash28ByteBase16(getStakeKey(XPUB, 0).hash().hex() as string), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32() as Cardano.PaymentAddress;

/** The wallet's own listing at `ref`, as the store holds it once the listed partition verified it. */
function ownListing(ref: string, owner: string): OwnListing {
  return {
    ref,
    unit: NFT,
    datum: { owner, sellerAddress: 'addr_test1own', price: 50_000_000n, royalties: [], buyer: null },
    depositLovelace: '2000000',
    deploymentVersion: 1,
  };
}

interface Shape {
  /** Spend this UTxO (a listing) alongside the fee input. */
  spend?: string;
  /** Add an output at the listing script (creates a listing). */
  create?: boolean;
  /** Also spend a programmable-token UTxO. */
  programmable?: boolean;
}

/** A market-shaped transaction: a fee input, optionally a listing spent, optionally one created. */
function marketTx(bg: WalletBg, shape: Shape = {}) {
  const keys = bg.resolvePathsForMissingAddresses([]);
  const own = keys.payment[0].address as Cardano.PaymentAddress;
  const inputs: Cardano.TxIn[] = [{ txId: Cardano.TransactionId(FEE_TX), index: 0 }];
  if (shape.spend) {
    const [txId, index] = shape.spend.split('#');
    inputs.push({ txId: Cardano.TransactionId(txId), index: Number(index) });
  }
  if (shape.programmable) inputs.push({ txId: Cardano.TransactionId(PROGRAMMABLE_TX), index: 0 });
  const outputs: Cardano.TxOut[] = [{ address: own, value: { coins: 3_000_000n } }];
  if (shape.create) {
    outputs.push({ address: listingAddress(), value: { coins: 2_000_000n, assets: new Map([[Cardano.AssetId(NFT), 1n]]) } });
  }
  const tx = Serialization.Transaction.fromCore({
    id: Cardano.TransactionId('00'.repeat(32)),
    body: { inputs, outputs, fee: 200_000n },
    witness: { signatures: new Map() },
  });
  const utxos: Cardano.Utxo[] = [[
    { txId: Cardano.TransactionId(FEE_TX), index: 0, address: own },
    { address: own, value: { coins: 9_000_000n } },
  ]];
  return { txCbor: tx.toCbor(), txId: tx.getId(), core: tx.toCore(), utxos, keys };
}

function signingKeys(witnesses: string): string[] {
  const vkeys = Serialization.TransactionWitnessSet.fromCbor(Serialization.TxCBOR(witnesses)).vkeys()?.values() ?? [];
  return vkeys.map((witness) => witness.vkey()).sort();
}

const OWN_PAYMENT_KEY_HEX = () => getPaymentKeyExternal(XPUB, 0).hex();
const ownerHash = () => getPaymentKeyExternal(XPUB, 0).hash().hex() as string;

describe('WalletBg.signTx with the NFT market guard', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
    clearMarketSignAllowance();
    clearCip113SignAllowance();
  });

  describe('a transaction that creates a listing', () => {
    it('is refused without an allowance', async () => {
      const bg = await bootWallet();
      const { txCbor, utxos, keys } = marketTx(bg, { create: true });
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);
    });

    it('is signed with an allowance, and only once', async () => {
      const bg = await bootWallet();
      const { txCbor, txId, core, utxos, keys } = marketTx(bg, { create: true });
      const hits = findMarketTouch(core, NFT_MARKET_DEPLOYMENTS_PREPROD, new Set());
      expect(hits).toEqual(['creates-listing:1']);
      grantMarketSignAllowance(bg.id, txId, hits);

      const { witnesses } = await bg.signTx(txCbor, '', utxos, keys, rootKeyBytes);
      expect(signingKeys(witnesses)).toEqual([OWN_PAYMENT_KEY_HEX()]);
      expect(hasMarketSignAllowance(bg.id, txId, hits)).toBe(false);

      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);
    });

    it('is refused when the allowance names another transaction, another wallet, or other hits', async () => {
      const bg = await bootWallet();
      const { txCbor, txId, utxos, keys } = marketTx(bg, { create: true });

      grantMarketSignAllowance(bg.id, 'cd'.repeat(32), ['creates-listing:1']);
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);

      grantMarketSignAllowance(bg.id + 1, txId, ['creates-listing:1']);
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);

      // The right transaction, but verified as touching a different output.
      grantMarketSignAllowance(bg.id, txId, ['creates-listing:0']);
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);
    });

    it('is refused before the root key is decrypted', async () => {
      const bg = await bootWallet();
      const { txCbor, utxos, keys } = marketTx(bg, { create: true });
      // No pre-decrypted key and a password that opens nothing: the refusal must come first.
      await expect(bg.signTx(txCbor, 'not-the-password', utxos, keys)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);
    });

    it('does not use the allowance up when the signer is not authorized', async () => {
      const bg = await bootWallet();
      const { txCbor, txId, core, utxos, keys } = marketTx(bg, { create: true });
      grantMarketSignAllowance(bg.id, txId, findMarketTouch(core, NFT_MARKET_DEPLOYMENTS_PREPROD, new Set()));

      const unauthorized = () => { throw new Error('session ended'); };
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes, unauthorized)).rejects.toThrow('session ended');
      // Still there for the user's retry.
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toBeTruthy();
    });
  });

  describe('a transaction that spends one of the wallet\'s own listings', () => {
    it('is refused without an allowance, and signed once with one', async () => {
      const bg = await bootWallet();
      WalletStore.setListedListings([ownListing(LISTING_REF, ownerHash())], '2000000');
      const { txCbor, txId, core, utxos, keys } = marketTx(bg, { spend: LISTING_REF });
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);

      const hits = findMarketTouch(core, NFT_MARKET_DEPLOYMENTS_PREPROD, new Set([LISTING_REF]));
      expect(hits).toEqual([`spends-listing:${LISTING_REF}`]);
      grantMarketSignAllowance(bg.id, txId, hits);
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toBeTruthy();
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);
    });

    it('a reprice-shaped transaction needs an allowance covering both the spend and the new output', async () => {
      const bg = await bootWallet();
      WalletStore.setListedListings([ownListing(LISTING_REF, ownerHash())], '2000000');
      const { txCbor, txId, utxos, keys } = marketTx(bg, { spend: LISTING_REF, create: true });

      grantMarketSignAllowance(bg.id, txId, [`spends-listing:${LISTING_REF}`]);
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);

      grantMarketSignAllowance(bg.id, txId, ['creates-listing:1', `spends-listing:${LISTING_REF}`]);
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toBeTruthy();
    });

    it('an allowance for another transaction does not help', async () => {
      const bg = await bootWallet();
      WalletStore.setListedListings([ownListing(LISTING_REF, ownerHash())], '2000000');
      const { txCbor, utxos, keys } = marketTx(bg, { spend: LISTING_REF });
      grantMarketSignAllowance(bg.id, 'cd'.repeat(32), [`spends-listing:${LISTING_REF}`]);
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);
    });

    it('stops guarding a listing once the store no longer holds it', async () => {
      const bg = await bootWallet();
      WalletStore.setListedListings([ownListing(LISTING_REF, ownerHash())], '2000000');
      WalletStore.setListedListings([], '0');
      const { txCbor, utxos, keys } = marketTx(bg, { spend: LISTING_REF });
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toBeTruthy();
    });

    it('does not guard the spend of a listing that is not the wallet\'s own', async () => {
      const bg = await bootWallet();
      WalletStore.setListedListings([ownListing(LISTING_REF, ownerHash())], '2000000');
      // Someone else's listing, bought through a dApp: previewed there, not refused here.
      const { txCbor, utxos, keys } = marketTx(bg, { spend: `${OTHER_LISTING_TX}#0` });
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toBeTruthy();
    });
  });

  describe('everything else', () => {
    it('an unrelated transaction is signed with no allowance, and leaves a grant alone', async () => {
      const bg = await bootWallet();
      WalletStore.setListedListings([ownListing(LISTING_REF, ownerHash())], '2000000');
      const { txCbor, utxos, keys } = marketTx(bg);
      const other = marketTx(bg, { create: true });
      grantMarketSignAllowance(bg.id, other.txId, ['creates-listing:1']);

      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toBeTruthy();
      // The grant belongs to a different transaction and is still there for it.
      expect(hasMarketSignAllowance(bg.id, other.txId, ['creates-listing:1'])).toBe(true);
    });

    it('guards nothing on a network without a deployment', async () => {
      const bg = await bootWallet(Network.PREVIEW);
      const { txCbor, utxos, keys } = marketTx(bg, { create: true });
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toBeTruthy();
    });

    it('the CIP-113 refusal still comes first, and a market allowance does not lift it', async () => {
      const bg = await bootWallet();
      const { txCbor, txId, core, utxos, keys } = marketTx(bg, { create: true, programmable: true });
      grantMarketSignAllowance(bg.id, txId, findMarketTouch(core, NFT_MARKET_DEPLOYMENTS_PREPROD, new Set()));
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
    });

    it('a CIP-113 allowance does not lift the market refusal', async () => {
      const bg = await bootWallet();
      const { txCbor, txId, utxos, keys } = marketTx(bg, { create: true, programmable: true });
      grantCip113SignAllowance(bg.id, txId, [`${PROGRAMMABLE_TX}#0`]);
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);
    });

    it('a transaction under both guards signs with both allowances', async () => {
      const bg = await bootWallet();
      const { txCbor, txId, core, utxos, keys } = marketTx(bg, { create: true, programmable: true });
      grantMarketSignAllowance(bg.id, txId, findMarketTouch(core, NFT_MARKET_DEPLOYMENTS_PREPROD, new Set()));
      grantCip113SignAllowance(bg.id, txId, [`${PROGRAMMABLE_TX}#0`]);
      await expect(bg.signTx(txCbor, '', utxos, keys, rootKeyBytes)).resolves.toBeTruthy();
    });
  });
});

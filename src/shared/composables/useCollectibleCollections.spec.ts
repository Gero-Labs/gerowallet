// The wallet's NFT collections as the collectibles views show them. The NFTs the wallet has listed
// are locked at the market contract, so the sync keeps them out of `walletStore.collections` (the
// store is built from spendable UTxOs only). Without them a seller would lose sight of an NFT the
// moment it is listed, and with it the only place to change its price or take it back. This adds
// them back for display, where the market is available, and nowhere else: the store is untouched.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Blockchain, Network, WalletType } from '@/models/types';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import {
  listedUnitsNow,
  mergeListedCollectibles,
  useCollectibleCollections,
  type CollectibleCollection,
  type CollectibleItem,
} from './useCollectibleCollections';

const POLICY_A = 'aa'.repeat(28);
const POLICY_B = 'bb'.repeat(28);
// asset names "Cool #1", "Cool #2", "Other"
const COOL_1 = `${POLICY_A}436f6f6c202331`;
const COOL_2 = `${POLICY_A}436f6f6c202332`;
const OTHER = `${POLICY_B}4f74686572`;

const item = (unit: string, name: string): CollectibleItem => ({
  unit,
  name,
  img: `https://img.example/${name}`,
  policy_id: unit.slice(0, 56),
  asset_name: unit.slice(56),
  fingerprint: `asset1${name}`,
  onchain_metadata: null,
  metadata: null,
  quantity: '1',
  isScam: false,
});

const listing = (unit: string, price = 120_000_000n): OwnListing => ({
  ref: `${unit.slice(0, 8)}${'11'.repeat(28)}#0`,
  unit,
  datum: { owner: 'aa'.repeat(28), sellerAddress: 'addr_test1seller', price, royalties: [], buyer: null },
  depositLovelace: '1500000',
  deploymentVersion: 1,
});

const resolve = (unit: string): CollectibleItem => item(unit, { [COOL_1]: 'Cool #1', [COOL_2]: 'Cool #2', [OTHER]: 'Other' }[unit] ?? 'Unknown');

describe('mergeListedCollectibles', () => {
  const held: Record<string, CollectibleCollection> = {
    [POLICY_A]: { name: 'Cool', img: 'https://img.example/cool', quantity: 1, isScam: false, items: [item(COOL_1, 'Cool #1')] },
  };

  it('is the collections as they are when nothing is listed', () => {
    expect(mergeListedCollectibles(held, [], resolve)).toEqual(held);
  });

  it('adds a listed NFT to the collection of its policy, and counts it', () => {
    const merged = mergeListedCollectibles(held, [listing(COOL_2)], resolve);
    expect(merged[POLICY_A].items.map((i) => i.unit)).toEqual([COOL_1, COOL_2]);
    expect(merged[POLICY_A].quantity).toBe(2);
    expect(merged[POLICY_A].name).toBe('Cool');
  });

  it('makes a collection of its own for a policy the wallet holds nothing else of', () => {
    const merged = mergeListedCollectibles(held, [listing(OTHER)], resolve);
    expect(Object.keys(merged)).toEqual([POLICY_A, POLICY_B]);
    expect(merged[POLICY_B]).toMatchObject({ name: 'Other', quantity: 1, isScam: false });
    expect(merged[POLICY_B].img).toBe('https://img.example/Other');
    expect(merged[POLICY_B].items.map((i) => i.unit)).toEqual([OTHER]);
  });

  it('names a new collection from what its listed NFTs have in common', () => {
    const merged = mergeListedCollectibles({}, [listing(COOL_1), listing(COOL_2)], resolve);
    expect(merged[POLICY_A].name).toBe('Cool');
    expect(merged[POLICY_A].quantity).toBe(2);
  });

  it('never changes the collections it is given', () => {
    const before = JSON.stringify(held);
    mergeListedCollectibles(held, [listing(COOL_2), listing(OTHER)], resolve);
    expect(JSON.stringify(held)).toBe(before);
  });

  it('does not show an NFT twice if the store somehow still holds a listed one', () => {
    const merged = mergeListedCollectibles(held, [listing(COOL_1)], resolve);
    expect(merged[POLICY_A].items).toHaveLength(1);
    expect(merged[POLICY_A].quantity).toBe(1);
  });

  it('flags a collection as a scam if its listed NFT is one', () => {
    const merged = mergeListedCollectibles({}, [listing(OTHER)], (unit) => ({ ...item(unit, 'Other'), isScam: true }));
    expect(merged[POLICY_B].isScam).toBe(true);
  });
});

describe('useCollectibleCollections', () => {
  const wallet = (fields: Record<string, unknown> = {}) =>
    ({ id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, ...fields }) as never;
  const storeListing = (unit: string) => ({ ...listing(unit), datum: { ...listing(unit).datum, price: '120000000' } }) as unknown as OwnListing;

  beforeEach(() => {
    walletStore.loggedWallet = wallet();
    featureFlagsStore.state.flags.isNftMarketEnabled = true;
    walletStore.collections = {
      [POLICY_A]: { name: 'Cool', img: 'x', quantity: 1, isScam: false, items: [item(COOL_1, 'Cool #1')] },
    };
    walletStore.listedListings = [storeListing(COOL_2)];
  });

  afterEach(() => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    walletStore.loggedWallet = null;
    walletStore.collections = {};
    walletStore.listedListings = [];
  });

  it('shows the wallet\'s listed NFTs beside the ones it holds, resolved the way every asset is', () => {
    const collections = useCollectibleCollections();
    const cool = collections.value[POLICY_A];
    expect(cool.items.map((i) => i.unit)).toEqual([COOL_1, COOL_2]);
    // The name comes from the asset name, as for any asset the store has no metadata for.
    expect(cool.items[1]).toMatchObject({ unit: COOL_2, name: 'Cool #2' });
    expect(cool.quantity).toBe(2);
  });

  it('follows the store: a listing that goes away takes its NFT with it', () => {
    const collections = useCollectibleCollections();
    expect(collections.value[POLICY_A].items).toHaveLength(2);
    walletStore.listedListings = [];
    expect(collections.value[POLICY_A].items).toHaveLength(1);
  });

  it('still shows them with the market switched off: a listing locks the NFT, so it is never hidden (Ruling P41)', () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    const collections = useCollectibleCollections();
    expect(collections.value[POLICY_A].items.map((i) => i.unit)).toEqual([COOL_1, COOL_2]);
    expect(collections.value[POLICY_A].quantity).toBe(2);
  });

  it('is exactly the store\'s collections on a network with no market', () => {
    walletStore.loggedWallet = wallet({ network: Network.MAINNET });
    const collections = useCollectibleCollections();
    expect(collections.value).toBe(walletStore.collections);
  });

  it('names the listed units that are shown, and none where the network has no market', () => {
    expect([...listedUnitsNow()]).toEqual([COOL_2]);
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    expect([...listedUnitsNow()]).toEqual([COOL_2]);
    walletStore.loggedWallet = wallet({ network: Network.MAINNET });
    expect([...listedUnitsNow()]).toEqual([]);
  });

  it('leaves the store itself alone', () => {
    const collections = useCollectibleCollections();
    void collections.value;
    expect((walletStore.collections as Record<string, CollectibleCollection>)[POLICY_A].items).toHaveLength(1);
  });
});

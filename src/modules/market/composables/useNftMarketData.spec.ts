// The collectibles table's rows. They start from the wallet's own collections, which leave out
// the NFTs it has listed (locked at the market contract), so where Gero's market is available the
// listed ones are added back: a seller who lists their only NFT of a collection must not see the
// collection vanish from the table, and with it the way to edit the price or take it down.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { Blockchain, Network, WalletType } from '@/models/types';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';

const getNftCollections = vi.hoisted(() => vi.fn(() => Promise.resolve([] as unknown[])));
vi.mock('@/api/market-api', () => ({ default: { getNftCollections } }));

import { useNftMarketData } from './useNftMarketData';
import { loadTopNftCollections, resetTopNftCollections } from './useTopNftCollections';

const POLICY_CATS = 'cd'.repeat(28);
const POLICY_APES = 'ef'.repeat(28);
const CAT_1 = `${POLICY_CATS}43617431`; // "Cat1"
const APE_1 = `${POLICY_APES}41706531`; // "Ape1"

const item = (unit: string, name: string) => ({
  unit, name, img: `https://img.example/${name}`, policy_id: unit.slice(0, 56), asset_name: unit.slice(56),
  fingerprint: `asset1${name}`, quantity: '1', metadata: null, onchain_metadata: null,
});
const storeListing = (unit: string): OwnListing =>
  ({
    ref: `${unit.slice(56)}${'11'.repeat(30)}#0`,
    unit,
    datum: { owner: 'aa'.repeat(28), sellerAddress: 'addr_test1seller', price: '120000000', royalties: [], buyer: null },
    depositLovelace: '1550000',
    deploymentVersion: 1,
  }) as unknown as OwnListing;

beforeEach(() => {
  resetTopNftCollections();
  getNftCollections.mockClear();
  walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal } as never;
  featureFlagsStore.state.flags.isNftMarketEnabled = true;
  walletStore.collections = { [POLICY_CATS]: { name: 'Cats', img: 'x', quantity: 1, isScam: false, items: [item(CAT_1, 'Cat1')] } };
  walletStore.listedListings = [];
});
afterEach(() => {
  featureFlagsStore.state.flags.isNftMarketEnabled = false;
  walletStore.loggedWallet = null;
  walletStore.collections = {};
  walletStore.listedListings = [];
});

describe('useNftMarketData: the wallet\'s own rows', () => {
  it('lists the wallet\'s collections', async () => {
    const { collections, fetchUserNftCollections } = useNftMarketData();
    await fetchUserNftCollections();
    expect(collections.value.map((c) => c.policyId)).toEqual([POLICY_CATS]);
  });

  it('adds a collection made only of listed NFTs, counted as held', async () => {
    walletStore.listedListings = [storeListing(APE_1)];
    const { collections, fetchUserNftCollections } = useNftMarketData();
    await fetchUserNftCollections();

    expect(collections.value.map((c) => c.policyId).sort()).toEqual([POLICY_CATS, POLICY_APES].sort());
    expect(collections.value.find((c) => c.policyId === POLICY_APES)).toMatchObject({ name: 'Ape1', quantity: 1, isScam: false });
  });

  it('does not add them while the market is off', async () => {
    walletStore.listedListings = [storeListing(APE_1)];
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    const { collections, fetchUserNftCollections } = useNftMarketData();
    await fetchUserNftCollections();
    expect(collections.value.map((c) => c.policyId)).toEqual([POLICY_CATS]);
  });
});

describe('useNftMarketData: the top collections', () => {
  it('reads them through the shared loader, so the lookalike check is served by the same request', async () => {
    // A policy no earlier test cached an answer for: the table remembers "no data" per policy.
    const FRESH = 'ab'.repeat(28);
    const top = [{ policyId: FRESH, name: 'Cool Cats', floorPriceLovelace: 25_000_000 }];
    walletStore.collections = { [FRESH]: { name: 'Cats', img: 'x', quantity: 1, isScam: false, items: [item(`${FRESH}43617431`, 'Cat1')] } };
    getNftCollections.mockResolvedValueOnce(top);
    const { collections, fetchUserNftCollections } = useNftMarketData();
    await fetchUserNftCollections();

    expect(collections.value[0]).toMatchObject({ policyId: FRESH, name: 'Cool Cats', floorPriceLovelace: 25_000_000 });
    expect(await loadTopNftCollections()).toEqual(top);
    expect(getNftCollections).toHaveBeenCalledTimes(1);
    expect(getNftCollections).toHaveBeenCalledWith('volume', 200);
  });
});

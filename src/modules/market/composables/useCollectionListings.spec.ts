// A collection's open listings, paged. The cursor Nexus returns is passed back to it unchanged;
// a page that reports dropped rows is said to have dropped them and is never an empty
// collection; a page whose rows were all dropped still has a next page; and an answer for a
// collection, sort or wallet the user has since left is never shown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import type { ListingDto, ListingsPage } from '@/api/nft-market-api';
import { Blockchain, Network, WalletType } from '@/models/types';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import { listingRow, refOf } from '../utils/__fixtures__/listingFixtures';

const listings = vi.hoisted(() => vi.fn());
vi.mock('@/api/nft-market-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/nft-market-api')>();
  return { ...actual, nftMarketApi: { ...actual.nftMarketApi, listings } };
});

import { LISTINGS_PAGE_SIZE, useCollectionListings } from './useCollectionListings';

const POLICY = 'cd'.repeat(28);
const OTHER_POLICY = 'ef'.repeat(28);

const page = (items: ListingDto[], nextCursor: string | null = null, dropped = 0): ListingsPage => ({ items, nextCursor, dropped });
const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => listingRow({ index: from + i }));

/** A request the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let scope: EffectScope;
const policy = ref(POLICY);

function mountComposable() {
  scope = effectScope();
  return scope.run(() => useCollectionListings(() => policy.value))!;
}

const settle = async () => {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
};

beforeEach(() => {
  listings.mockReset();
  policy.value = POLICY;
  walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal } as never;
  featureFlagsStore.state.flags.isNftMarketEnabled = true;
});
afterEach(() => {
  scope?.stop();
  featureFlagsStore.state.flags.isNftMarketEnabled = false;
  walletStore.loggedWallet = null;
});

describe('the first page', () => {
  it('is asked for by the collection, cheapest first, one page at a time, on the wallet\'s network', async () => {
    listings.mockResolvedValue(page(rows(0, 3)));
    const c = mountComposable();
    await settle();
    expect(listings).toHaveBeenCalledExactlyOnceWith(POLICY, { sort: 'price', limit: LISTINGS_PAGE_SIZE }, Network.PREPROD);
    expect(c.items.value).toHaveLength(3);
    expect(c.loading.value).toBe(false);
  });

  it('has no cursor to send before there is one', async () => {
    listings.mockResolvedValue(page([]));
    mountComposable();
    await settle();
    expect(Object.keys(listings.mock.calls[0][1])).not.toContain('cursor');
  });

  it('is loading until it answers', async () => {
    const d = deferred<ListingsPage>();
    listings.mockReturnValue(d.promise);
    const c = mountComposable();
    await settle();
    expect(c.loading.value).toBe(true);
    d.resolve(page(rows(0, 1)));
    await settle();
    expect(c.loading.value).toBe(false);
  });

  it('asks nothing where the market is not available to browse: flag off, no wallet, a network with no deployment', async () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    mountComposable();
    await settle();
    scope.stop();

    featureFlagsStore.state.flags.isNftMarketEnabled = true;
    walletStore.loggedWallet = null;
    mountComposable();
    await settle();
    scope.stop();

    walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal } as never;
    mountComposable();
    await settle();
    expect(listings).not.toHaveBeenCalled();
  });
});

describe('loaded: a read that can be taken for the collection as it stands', () => {
  it('is false until a page has been read, true after one (even an empty one), and false again while the list starts over', async () => {
    const d = deferred<ListingsPage>();
    const second = deferred<ListingsPage>();
    listings.mockReturnValueOnce(d.promise).mockReturnValueOnce(second.promise);
    const c = mountComposable();
    await settle();
    expect(c.loaded.value).toBe(false);
    d.resolve(page(rows(0, 2)));
    await settle();
    expect(c.loaded.value).toBe(true);

    c.setSort('recent');
    await settle();
    expect(c.loaded.value).toBe(false);
    second.resolve(page([]));
    await settle();
    expect(c.loaded.value).toBe(true);
  });

  it('stays false when the first page cannot be read, and stays true when only a next page cannot', async () => {
    listings.mockRejectedValueOnce(new Error('502'));
    const failed = mountComposable();
    await settle();
    expect(failed.loaded.value).toBe(false);
    scope.stop();

    listings.mockResolvedValueOnce(page(rows(0, 1), 'c1')).mockRejectedValueOnce(new Error('timeout'));
    const partial = mountComposable();
    await settle();
    await partial.loadMore();
    expect(partial.loaded.value).toBe(true);
    expect(partial.hasMore.value).toBe(true);
  });
});

describe('paging', () => {
  it('passes the cursor of a page back to Nexus unchanged', async () => {
    const cursor = 'eyJwIjoxMjAwMDAwMDAsInQiOiJhYiJ9_-Zz';
    listings.mockResolvedValueOnce(page(rows(0, 20), cursor)).mockResolvedValueOnce(page(rows(20, 5)));
    const c = mountComposable();
    await settle();
    expect(c.hasMore.value).toBe(true);

    await c.loadMore();
    expect(listings).toHaveBeenCalledTimes(2);
    expect(listings.mock.calls[1]).toEqual([POLICY, { sort: 'price', cursor, limit: LISTINGS_PAGE_SIZE }, Network.PREPROD]);
    expect(c.items.value).toHaveLength(25);
    expect(c.hasMore.value).toBe(false);
  });

  it('keeps the order Nexus gave and shows a listing that appears on two pages once', async () => {
    const first = rows(0, 3);
    listings.mockResolvedValueOnce(page(first, 'c1')).mockResolvedValueOnce(page([first[2], ...rows(3, 2)]));
    const c = mountComposable();
    await settle();
    await c.loadMore();
    expect(c.items.value.map(refOf)).toEqual(rows(0, 5).map(refOf));
  });

  it('has nothing more after the last page, and loadMore then asks for nothing', async () => {
    listings.mockResolvedValueOnce(page(rows(0, 2), null));
    const c = mountComposable();
    await settle();
    expect(c.hasMore.value).toBe(false);
    await c.loadMore();
    expect(listings).toHaveBeenCalledTimes(1);
  });

  it('does not ask for a page twice at once', async () => {
    const d = deferred<ListingsPage>();
    listings.mockResolvedValueOnce(page(rows(0, 2), 'c1')).mockReturnValueOnce(d.promise);
    const c = mountComposable();
    await settle();
    const a = c.loadMore();
    const b = c.loadMore();
    expect(c.loadingMore.value).toBe(true);
    d.resolve(page(rows(2, 1)));
    await Promise.all([a, b]);
    expect(listings).toHaveBeenCalledTimes(2);
  });

  it('keeps paging when a page came back empty after drops: the cursor still leads on', async () => {
    listings.mockResolvedValueOnce(page([], 'c1', 3)).mockResolvedValueOnce(page(rows(0, 2), null, 0));
    const c = mountComposable();
    await settle();
    expect(c.items.value).toEqual([]);
    expect(c.dropped.value).toBe(3);
    expect(c.hasMore.value).toBe(true);

    await c.loadMore();
    expect(listings.mock.calls[1][1]).toMatchObject({ cursor: 'c1' });
    expect(c.items.value).toHaveLength(2);
  });

  it('counts what every page dropped', async () => {
    listings.mockResolvedValueOnce(page(rows(0, 2), 'c1', 1)).mockResolvedValueOnce(page(rows(2, 2), null, 2));
    const c = mountComposable();
    await settle();
    await c.loadMore();
    expect(c.dropped.value).toBe(3);
  });
});

describe('sort', () => {
  it('starts over from the first page, with no cursor, when the sort changes', async () => {
    listings.mockResolvedValueOnce(page(rows(0, 20), 'c1')).mockResolvedValueOnce(page(rows(30, 2)));
    const c = mountComposable();
    await settle();

    c.setSort('recent');
    await settle();
    expect(listings.mock.calls[1]).toEqual([POLICY, { sort: 'recent', limit: LISTINGS_PAGE_SIZE }, Network.PREPROD]);
    expect(c.sort.value).toBe('recent');
    expect(c.items.value.map(refOf)).toEqual(rows(30, 2).map(refOf));
    expect(c.dropped.value).toBe(0);
  });

  it('does nothing when asked for the sort it already has', async () => {
    listings.mockResolvedValue(page(rows(0, 1)));
    const c = mountComposable();
    await settle();
    c.setSort('price');
    await settle();
    expect(listings).toHaveBeenCalledTimes(1);
  });
});

describe('answers that arrive too late', () => {
  it('drops the answer for a sort the user has left', async () => {
    const slow = deferred<ListingsPage>();
    listings.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page(rows(10, 1)));
    const c = mountComposable();
    await settle();
    c.setSort('recent');
    await settle();
    slow.resolve(page(rows(0, 4), 'stale-cursor'));
    await settle();

    expect(c.items.value.map(refOf)).toEqual(rows(10, 1).map(refOf));
    expect(c.hasMore.value).toBe(false);
  });

  it('drops the answer for a collection the user has left, and shows the new collection from its first page', async () => {
    const slow = deferred<ListingsPage>();
    listings.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page(rows(10, 2)));
    const c = mountComposable();
    await settle();
    policy.value = OTHER_POLICY;
    await settle();
    slow.resolve(page(rows(0, 4), 'stale-cursor'));
    await settle();

    expect(listings.mock.calls[1][0]).toBe(OTHER_POLICY);
    expect(c.items.value).toHaveLength(2);
  });

  it('drops a next page that arrives after the list was restarted', async () => {
    const slow = deferred<ListingsPage>();
    listings
      .mockResolvedValueOnce(page(rows(0, 2), 'c1'))
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(page(rows(20, 1)));
    const c = mountComposable();
    await settle();
    const more = c.loadMore();
    await c.refresh();
    slow.resolve(page(rows(2, 5), 'c2'));
    await more;

    expect(c.items.value.map(refOf)).toEqual(rows(20, 1).map(refOf));
    expect(c.loadingMore.value).toBe(false);
  });

  it('shows nothing of one wallet\'s market under another', async () => {
    const slow = deferred<ListingsPage>();
    listings.mockReturnValueOnce(slow.promise);
    const c = mountComposable();
    await settle();
    walletStore.loggedWallet = { id: 2, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal } as never;
    await settle();
    slow.resolve(page(rows(0, 2)));
    await settle();
    expect(c.items.value).toEqual([]);
  });
});

describe('failures', () => {
  it('a first page that cannot be read leaves an empty list and a failure to retry', async () => {
    listings.mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce(page(rows(0, 2)));
    const c = mountComposable();
    await settle();
    expect(c.items.value).toEqual([]);
    expect(c.error.value).toBe('first');
    expect(c.loading.value).toBe(false);

    await c.refresh();
    expect(c.error.value).toBeNull();
    expect(c.items.value).toHaveLength(2);
  });

  it('a next page that cannot be read keeps what was shown, and trying again asks for the same cursor', async () => {
    listings
      .mockResolvedValueOnce(page(rows(0, 3), 'c1'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(page(rows(3, 1)));
    const c = mountComposable();
    await settle();
    await c.loadMore();
    expect(c.error.value).toBe('more');
    expect(c.items.value).toHaveLength(3);
    expect(c.hasMore.value).toBe(true);

    await c.loadMore();
    expect(listings.mock.calls[2][1]).toMatchObject({ cursor: 'c1' });
    expect(c.error.value).toBeNull();
    expect(c.items.value).toHaveLength(4);
  });
});

describe('refresh', () => {
  it('reads the first page again and replaces the list', async () => {
    listings.mockResolvedValueOnce(page(rows(0, 3), 'c1')).mockResolvedValueOnce(page(rows(0, 2)));
    const c = mountComposable();
    await settle();
    await c.refresh();
    expect(listings.mock.calls[1][1]).not.toHaveProperty('cursor');
    expect(c.items.value).toHaveLength(2);
    expect(c.hasMore.value).toBe(false);
  });
});

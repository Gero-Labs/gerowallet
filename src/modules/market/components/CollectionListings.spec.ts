// A collection's open listings on Gero's market, as the collection page shows them: image, name,
// price and the policy ID on every row, a lookalike warning when the collection has the name of a
// popular one under another policy, paging on Nexus's cursor, and Buy only where it can work. The
// copy is the real English table, so a mistyped key shows up as a raw key in the assertions. Nexus
// (the market API), the metadata lookup and the top collections are stubbed; the datums are real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import filters from '@/shared/utils/filters';
import type { ListingDto, ListingsPage } from '@/api/nft-market-api';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { Blockchain, Network, WalletType } from '@/models/types';
import { i18nPlugin } from '@/plugins/i18n';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import { listingRow, preprodAddress, refOf, STRANGER_KEY, STRANGER_STAKE } from '../utils/__fixtures__/listingFixtures';
import { isPendingBuy, PENDING_BUY_TTL_MS, resetPendingBuys } from '../composables/usePendingBuys';

const listings = vi.hoisted(() => vi.fn());
vi.mock('@/api/nft-market-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/nft-market-api')>();
  return { ...actual, nftMarketApi: { ...actual.nftMarketApi, listings } };
});

const topCollections = vi.hoisted(() => vi.fn());
vi.mock('@/modules/market/composables/useTopNftCollections', () => ({ loadTopNftCollections: topCollections }));

const metaState = vi.hoisted(() => ({ meta: undefined as unknown as { value: Map<string, unknown> } }));
vi.mock('@/modules/market/composables/useListingNftMeta', async () => {
  const { ref: vueRef } = await import('vue');
  metaState.meta = vueRef(new Map<string, unknown>());
  return { useListingNftMeta: () => ({ meta: metaState.meta }) };
});

const heldCollections = vi.hoisted(() => ({ value: {} as Record<string, { name: string }> }));
vi.mock('@/shared/composables/useCollectibleCollections', () => ({
  collectibleCollectionsNow: () => heldCollections.value,
}));

// The purchase sheet has its own spec; here it is a stub that shows what it was given.
vi.mock('@/modules/market/dialogs/BuyNftDialog.vue', () => ({
  default: {
    props: ['isOpen', 'listing', 'lookalike', 'name', 'image'],
    emits: ['close', 'sent', 'refresh'],
    template: `<div data-testid="buy-dialog" :data-ref="listing.txHash + '#' + listing.outputIndex" :data-name="name" :data-lookalike="lookalike ? lookalike.policyId : ''">
      <button data-testid="buy-dialog-sent" @click="$emit('sent', listing.txHash + '#' + listing.outputIndex)" />
      <button data-testid="buy-dialog-refresh" @click="$emit('refresh')" />
      <button data-testid="buy-dialog-close" @click="$emit('close')" />
    </div>`,
  },
}));

import CollectionListings from './CollectionListings.vue';

enableAutoUnmount(afterEach);

const POLICY = 'cd'.repeat(28);
const REAL_POLICY = 'aa'.repeat(28);
const MY_PAYMENT = 'a1'.repeat(28);
const MY_CHANGE = 'a2'.repeat(28);
const MY_STAKE = 'a3'.repeat(28);
const MY_ADDRESS = preprodAddress(MY_PAYMENT, MY_STAKE);

const page = (items: ListingDto[], nextCursor: string | null = null, dropped = 0): ListingsPage => ({ items, nextCursor, dropped });
const rows = (from: number, count: number, over: Parameters<typeof listingRow>[0] = {}) =>
  Array.from({ length: count }, (_, i) => listingRow({ index: from + i, ...over }));

function render(props: { policyId?: string } = {}) {
  return mount(CollectionListings, {
    attachTo: document.body,
    props: { policyId: POLICY, ...props },
    global: { plugins: [createTestVuetify(), i18nPlugin], stubs: { CopyButton: true, ExplorerLink: true } },
  });
}
type Wrapper = ReturnType<typeof render>;
const rowEls = (w: Wrapper) => w.findAll('[data-testid="listing-row"]');
const byId = (w: Wrapper, id: string) => w.get(`[data-testid="${id}"]`);
const has = (w: Wrapper, id: string) => w.find(`[data-testid="${id}"]`).exists();

const login = (fields: Record<string, unknown> = {}) => {
  walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, ...fields } as never;
};

beforeEach(() => {
  resetPendingBuys();
  listings.mockReset();
  topCollections.mockReset();
  topCollections.mockResolvedValue([]);
  metaState.meta.value = new Map();
  heldCollections.value = {};
  login();
  walletStore.keys = {
    payment: [{ cred: MY_PAYMENT, address: MY_ADDRESS, path: 'p' }],
    change: [{ cred: MY_CHANGE, address: preprodAddress(MY_CHANGE, MY_STAKE), path: 'c' }],
    stake: [{ cred: MY_STAKE, path: 's' }],
  } as never;
  walletStore.listedListings = [];
  featureFlagsStore.state.flags.isNftMarketEnabled = true;
});
afterEach(() => {
  featureFlagsStore.state.flags.isNftMarketEnabled = false;
  walletStore.loggedWallet = null;
  walletStore.keys = null;
  walletStore.listedListings = [];
  document.body.replaceChildren();
});

describe('the rows', () => {
  it('shows each listing\'s picture, name and price, and the policy ID on every one', async () => {
    const a = listingRow({ index: 0 });
    const b = listingRow({ index: 1, priceLovelace: '1234567891' });
    listings.mockResolvedValue(page([a, b]));
    metaState.meta.value = new Map([
      [a.unit, { name: 'Cool Cat #0', image: 'https://img.example/0.png' }],
      [b.unit, { name: 'Cool Cat #1' }],
    ]);
    const wrapper = render();
    await flushPromises();

    expect(listings).toHaveBeenCalledExactlyOnceWith(POLICY, { sort: 'price', limit: 20 }, Network.PREPROD);
    const els = rowEls(wrapper);
    expect(els).toHaveLength(2);
    expect(els[0].get('[data-testid="listing-name"]').text()).toBe('Cool Cat #0');
    expect(els[0].get('[data-testid="listing-price"]').text()).toBe('120 tADA');
    expect(els[0].findComponent({ name: 'VImg' }).props('src')).toBe('https://img.example/0.png');
    expect(els[1].get('[data-testid="listing-price"]').text()).toBe('1,234.567891 tADA');
    for (const el of els) {
      expect(el.get('[data-testid="listing-policy"]').text()).toContain(filters.truncate(POLICY));
    }
  });

  it('names an NFT from its asset name until its metadata is in', async () => {
    const [a] = rows(0, 1, { assetName: 'Cat0' });
    listings.mockResolvedValue(page([a]));
    const wrapper = render();
    await flushPromises();
    expect(rowEls(wrapper)[0].get('[data-testid="listing-name"]').text()).toBe('Cat0');
  });

  it('shows a loading state while the first page is read', async () => {
    listings.mockReturnValue(new Promise(() => {}));
    const wrapper = render();
    await flushPromises();
    expect(has(wrapper, 'collection-loading')).toBe(true);
    expect(has(wrapper, 'collection-empty')).toBe(false);
  });

  it('shows nothing at all where the market cannot be browsed: flag off', async () => {
    featureFlagsStore.state.flags.isNftMarketEnabled = false;
    const wrapper = render();
    await flushPromises();
    expect(has(wrapper, 'collection-listings')).toBe(false);
    expect(listings).not.toHaveBeenCalled();
  });
});

describe('an empty collection and a page that left rows out', () => {
  it('says there is nothing for sale only when the last page was empty and nothing was left out', async () => {
    listings.mockResolvedValue(page([], null, 0));
    const wrapper = render();
    await flushPromises();
    expect(byId(wrapper, 'collection-empty').text()).toBe('No NFTs of this collection are for sale right now.');
    expect(has(wrapper, 'collection-dropped')).toBe(false);
  });

  it('never says a page whose rows were all dropped is an empty collection: it says some listings could not be shown', async () => {
    listings.mockResolvedValue(page([], null, 3));
    const wrapper = render();
    await flushPromises();
    expect(has(wrapper, 'collection-empty')).toBe(false);
    expect(byId(wrapper, 'collection-dropped').text()).toBe('3 listings could not be shown.');
  });

  it('says so beside the rows that were shown', async () => {
    listings.mockResolvedValue(page(rows(0, 2), null, 1));
    const wrapper = render();
    await flushPromises();
    expect(rowEls(wrapper)).toHaveLength(2);
    expect(byId(wrapper, 'collection-dropped').text()).toBe('1 listing could not be shown.');
  });

  it('keeps offering the next page when every row of a page was dropped, and passes the cursor on unchanged', async () => {
    listings.mockResolvedValueOnce(page([], 'Zm9v-_9', 2)).mockResolvedValueOnce(page(rows(0, 1), null, 0));
    const wrapper = render();
    await flushPromises();

    expect(has(wrapper, 'collection-empty')).toBe(false);
    expect(byId(wrapper, 'collection-dropped').text()).toBe('2 listings could not be shown.');
    await byId(wrapper, 'collection-load-more').trigger('click');
    await flushPromises();

    expect(listings.mock.calls[1]).toEqual([POLICY, { sort: 'price', cursor: 'Zm9v-_9', limit: 20 }, Network.PREPROD]);
    expect(rowEls(wrapper)).toHaveLength(1);
    expect(has(wrapper, 'collection-load-more')).toBe(false);
    expect(byId(wrapper, 'collection-dropped').text()).toBe('2 listings could not be shown.');
  });

  it('does not call a page with nothing on it an empty collection while Nexus has another page', async () => {
    listings.mockResolvedValueOnce(page([], 'c1', 0)).mockResolvedValueOnce(page(rows(0, 1)));
    const wrapper = render();
    await flushPromises();

    expect(has(wrapper, 'collection-empty')).toBe(false);
    expect(has(wrapper, 'collection-dropped')).toBe(false);
    await byId(wrapper, 'collection-load-more').trigger('click');
    await flushPromises();
    expect(rowEls(wrapper)).toHaveLength(1);
  });

  it('counts a listing whose datum is not a Gero listing among the ones it could not show, and does not show it', async () => {
    const bad = listingRow({ index: 5, datumCbor: '182a' });
    listings.mockResolvedValue(page([...rows(0, 1), bad], null, 1));
    const wrapper = render();
    await flushPromises();
    expect(rowEls(wrapper)).toHaveLength(1);
    expect(byId(wrapper, 'collection-dropped').text()).toBe('2 listings could not be shown.');
  });
});

describe('paging and sort', () => {
  it('offers Load more while Nexus has another page, and passes its cursor back unchanged', async () => {
    const cursor = 'eyJwIjoxMjAwMDAwMDAsInQiOiJhYiJ9_-Zz';
    listings.mockResolvedValueOnce(page(rows(0, 20), cursor)).mockResolvedValueOnce(page(rows(20, 3)));
    const wrapper = render();
    await flushPromises();
    expect(byId(wrapper, 'collection-load-more').text()).toBe('Load More');

    await byId(wrapper, 'collection-load-more').trigger('click');
    await flushPromises();
    expect(listings.mock.calls[1]).toEqual([POLICY, { sort: 'price', cursor, limit: 20 }, Network.PREPROD]);
    expect(rowEls(wrapper)).toHaveLength(23);
    expect(has(wrapper, 'collection-load-more')).toBe(false);
  });

  it('starts over from the first page, with no cursor, when the sort changes', async () => {
    listings.mockResolvedValueOnce(page(rows(0, 20), 'c1')).mockResolvedValueOnce(page(rows(40, 2)));
    const wrapper = render();
    await flushPromises();
    expect(byId(wrapper, 'collection-sort-price').text()).toBe('Price: low to high');

    await byId(wrapper, 'collection-sort-recent').trigger('click');
    await flushPromises();
    expect(byId(wrapper, 'collection-sort-recent').text()).toBe('Recently listed');
    expect(listings.mock.calls[1]).toEqual([POLICY, { sort: 'recent', limit: 20 }, Network.PREPROD]);
    expect(rowEls(wrapper)).toHaveLength(2);
  });

  it('a first page that cannot be read says so and offers to try again', async () => {
    listings.mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce(page(rows(0, 1)));
    const wrapper = render();
    await flushPromises();
    expect(byId(wrapper, 'collection-error').text()).toContain('We could not load the listings. Try again.');
    expect(has(wrapper, 'collection-empty')).toBe(false);

    await byId(wrapper, 'collection-retry').trigger('click');
    await flushPromises();
    expect(rowEls(wrapper)).toHaveLength(1);
    expect(has(wrapper, 'collection-error')).toBe(false);
  });

  it('a next page that cannot be read keeps the rows and says so', async () => {
    listings.mockResolvedValueOnce(page(rows(0, 3), 'c1')).mockRejectedValueOnce(new Error('timeout'));
    const wrapper = render();
    await flushPromises();
    await byId(wrapper, 'collection-load-more').trigger('click');
    await flushPromises();

    expect(rowEls(wrapper)).toHaveLength(3);
    expect(byId(wrapper, 'collection-error').text()).toContain('We could not load the listings. Try again.');
    expect(has(wrapper, 'collection-load-more')).toBe(true);
  });
});

describe('who may buy what', () => {
  it('offers Buy on a public listing that is somebody else\'s', async () => {
    listings.mockResolvedValue(page(rows(0, 2)));
    const wrapper = render();
    await flushPromises();
    expect(rowEls(wrapper).map((el) => el.find('[data-testid="listing-buy"]').exists())).toEqual([true, true]);
    expect(rowEls(wrapper)[0].get('[data-testid="listing-buy"]').text()).toBe('Buy');
    expect(has(wrapper, 'collection-view-only')).toBe(false);
  });

  describe('the wallet\'s own listing is marked as its own and never offered for buy', () => {
    it('by a datum that names the account as owner AND as seller', async () => {
      const own = listingRow({ index: 1, owner: MY_PAYMENT, stake: MY_STAKE });
      listings.mockResolvedValue(page([listingRow({ index: 0 }), own]));
      const wrapper = render();
      await flushPromises();

      const [other, mine] = rowEls(wrapper);
      expect(other.find('[data-testid="listing-buy"]').exists()).toBe(true);
      expect(other.find('[data-testid="listing-own"]').exists()).toBe(false);
      expect(mine.find('[data-testid="listing-buy"]').exists()).toBe(false);
      expect(mine.get('[data-testid="listing-own"]').text()).toBe('Your listing');
    });

    it('by the wallet\'s own verified listings (useMyListings)', async () => {
      const row = listingRow({ index: 2 });
      walletStore.listedListings = [
        { ref: refOf(row), unit: row.unit, datum: { owner: 'ee'.repeat(28), sellerAddress: 'addr_test1x', price: '120000000', royalties: [], buyer: null }, depositLovelace: '1550000', deploymentVersion: 1 } as unknown as OwnListing,
      ];
      listings.mockResolvedValue(page([row]));
      const wrapper = render();
      await flushPromises();
      expect(has(wrapper, 'listing-buy')).toBe(false);
      expect(has(wrapper, 'listing-own')).toBe(true);
    });
  });

  describe('a listing that names the account on one side only gets no "Your listing" mark and no Buy', () => {
    it('the owner is the account\'s and the seller is an attacker\'s', async () => {
      const bait = listingRow({ index: 3, owner: MY_PAYMENT, sellerAddress: preprodAddress(STRANGER_KEY, STRANGER_STAKE) });
      listings.mockResolvedValue(page([bait]));
      const wrapper = render();
      await flushPromises();
      expect(rowEls(wrapper)).toHaveLength(1);
      expect(has(wrapper, 'listing-own')).toBe(false);
      expect(has(wrapper, 'listing-buy')).toBe(false);
    });

    it('the seller address is the account\'s and the owner is somebody else\'s', async () => {
      listings.mockResolvedValue(page([listingRow({ index: 3, owner: STRANGER_KEY, sellerAddress: MY_ADDRESS })]));
      const wrapper = render();
      await flushPromises();
      expect(rowEls(wrapper)).toHaveLength(1);
      expect(has(wrapper, 'listing-own')).toBe(false);
      expect(has(wrapper, 'listing-buy')).toBe(false);
    });
  });

  describe('a row that contradicts its datum is not shown and not offered, and is counted among the listings that could not be shown', () => {
    it('a bait price: the list says 10 tADA and the datum 120', async () => {
      const bait = { ...listingRow({ index: 4 }), priceLovelace: (10n * 1_000_000n).toString() };
      listings.mockResolvedValue(page([listingRow({ index: 0 }), bait]));
      const wrapper = render();
      await flushPromises();
      expect(rowEls(wrapper)).toHaveLength(1);
      expect(rowEls(wrapper)[0].attributes('data-ref')).toBe(refOf(listingRow({ index: 0 })));
      expect(byId(wrapper, 'collection-dropped').text()).toBe('1 listing could not be shown.');
    });
  });

  describe('a private listing (buyer set) is never shown, so never offered', () => {
    it('whoever the buyer is, the account\'s own keys included', async () => {
      listings.mockResolvedValue(page([
        listingRow({ index: 0 }),
        listingRow({ index: 1, buyer: STRANGER_KEY }),
        listingRow({ index: 2, buyer: MY_PAYMENT }),
        listingRow({ index: 3, buyer: MY_CHANGE }),
      ]));
      const wrapper = render();
      await flushPromises();

      expect(rowEls(wrapper)).toHaveLength(1);
      expect(rowEls(wrapper)[0].attributes('data-ref')).toBe(refOf(listingRow({ index: 0 })));
    });

    it('the account\'s own private listing is hidden too', async () => {
      const own = listingRow({ index: 5, owner: MY_PAYMENT, stake: MY_STAKE, buyer: STRANGER_KEY });
      walletStore.listedListings = [
        { ref: refOf(own), unit: own.unit, datum: { owner: MY_PAYMENT, sellerAddress: MY_ADDRESS, price: '120000000', royalties: [], buyer: STRANGER_KEY }, depositLovelace: '1550000', deploymentVersion: 1 } as unknown as OwnListing,
      ];
      listings.mockResolvedValue(page([own, listingRow({ index: 0 })]));
      const wrapper = render();
      await flushPromises();
      expect(rowEls(wrapper)).toHaveLength(1);
      expect(has(wrapper, 'listing-own')).toBe(false);
    });

    it('and is not counted among the listings that could not be shown: it is hidden on purpose', async () => {
      listings.mockResolvedValue(page([listingRow({ index: 1, buyer: STRANGER_KEY })]));
      const wrapper = render();
      await flushPromises();
      expect(has(wrapper, 'collection-dropped')).toBe(false);
      expect(has(wrapper, 'listing-row')).toBe(false);
      expect(has(wrapper, 'collection-empty')).toBe(true);
    });
  });

  describe('where the wallet cannot buy at all, it can still browse', () => {
    it('a watch wallet is told it can only look', async () => {
      login({ type: WalletType.Watch });
      listings.mockResolvedValue(page(rows(0, 2)));
      const wrapper = render();
      await flushPromises();

      expect(rowEls(wrapper)).toHaveLength(2);
      expect(has(wrapper, 'listing-buy')).toBe(false);
      expect(byId(wrapper, 'collection-view-only').text()).toBe('This wallet can only look at listings. To buy, use a wallet that can sign.');
      expect(has(wrapper, 'collection-hardware-soon')).toBe(false);
    });

    for (const [what, type] of [
      ['a Ledger', WalletType.Ledger],
      ['a Trezor', WalletType.Trezor],
      ['a Keystone', WalletType.Keystone],
    ] as const) {
      it(`${what}, while no device has signed a market transaction, is told it is coming and not that it can only look`, async () => {
        login({ type });
        listings.mockResolvedValue(page(rows(0, 2)));
        const wrapper = render();
        await flushPromises();

        expect(rowEls(wrapper)).toHaveLength(2);
        expect(has(wrapper, 'listing-buy')).toBe(false);
        expect(byId(wrapper, 'collection-hardware-soon').text()).toBe('Coming soon for hardware wallets');
        expect(has(wrapper, 'collection-view-only')).toBe(false);
      });
    }

    it('says nothing about buying while there is nothing to buy', async () => {
      for (const type of [WalletType.Watch, WalletType.Ledger]) {
        login({ type });
        listings.mockResolvedValue(page([]));
        const wrapper = render();
        await flushPromises();
        expect(has(wrapper, 'collection-view-only'), type).toBe(false);
        expect(has(wrapper, 'collection-hardware-soon'), type).toBe(false);
        wrapper.unmount();
      }
    });
  });
});

describe('buying', () => {
  async function opened() {
    const items = rows(0, 2);
    listings.mockResolvedValue(page(items));
    metaState.meta.value = new Map([[items[1].unit, { name: 'Cool Cat #1', image: 'https://img.example/1.png' }]]);
    const wrapper = render();
    await flushPromises();
    await rowEls(wrapper)[1].get('[data-testid="listing-buy"]').trigger('click');
    await flushPromises();
    return { wrapper, items };
  }

  it('opens the purchase sheet for that listing, with the name the page resolved', async () => {
    const { wrapper, items } = await opened();
    expect(byId(wrapper, 'buy-dialog').attributes('data-ref')).toBe(refOf(items[1]));
    expect(byId(wrapper, 'buy-dialog').attributes('data-name')).toBe('Cool Cat #1');
  });

  it('takes the sheet away when it closes', async () => {
    const { wrapper } = await opened();
    await byId(wrapper, 'buy-dialog-close').trigger('click');
    expect(has(wrapper, 'buy-dialog')).toBe(false);
  });

  it('stops offering Buy for a listing once a purchase of it went out or may have, and keeps offering it for the others', async () => {
    const { wrapper } = await opened();
    await byId(wrapper, 'buy-dialog-sent').trigger('click');
    await byId(wrapper, 'buy-dialog-close').trigger('click');

    const [first, second] = rowEls(wrapper);
    expect(first.find('[data-testid="listing-buy"]').exists()).toBe(true);
    expect(second.find('[data-testid="listing-buy"]').exists()).toBe(false);
    expect(second.get('[data-testid="listing-pending"]').text()).toBe('Purchase sent');
  });

  describe('the lock on a listing whose purchase went out survives leaving the collection page', () => {
    async function sentOn(second: number) {
      const items = rows(0, 2);
      listings.mockResolvedValue(page(items));
      const wrapper = render();
      await flushPromises();
      await rowEls(wrapper)[second].get('[data-testid="listing-buy"]').trigger('click');
      await byId(wrapper, 'buy-dialog-sent').trigger('click');
      await byId(wrapper, 'buy-dialog-close').trigger('click');
      return { wrapper, items };
    }

    it('the toggle to "In your wallet" and back unmounts the page and mounts it again: the Buy stays gone', async () => {
      const { wrapper, items } = await sentOn(1);
      wrapper.unmount();

      const again = render();
      await flushPromises();
      const [first, second] = rowEls(again);
      expect(first.find('[data-testid="listing-buy"]').exists()).toBe(true);
      expect(second.find('[data-testid="listing-buy"]').exists()).toBe(false);
      expect(second.get('[data-testid="listing-pending"]').text()).toBe('Purchase sent');
      expect(isPendingBuy(1, refOf(items[1]))).toBe(true);
    });

    it('is not another wallet\'s: the same listing is offered to it', async () => {
      await sentOn(1);
      login({ id: 2 });
      const other = render();
      await flushPromises();
      expect(rowEls(other).every((el) => el.find('[data-testid="listing-buy"]').exists())).toBe(true);
    });

    it('lets go after ten minutes', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const { wrapper } = await sentOn(1);
        wrapper.unmount();
        vi.setSystemTime(Date.now() + PENDING_BUY_TTL_MS + 1000);
        const again = render();
        await flushPromises();
        expect(rowEls(again).every((el) => el.find('[data-testid="listing-buy"]').exists())).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('is forgotten once the listing is gone from a read of the whole collection', async () => {
      const { wrapper, items } = await sentOn(1);
      // The purchase landed: Nexus no longer lists it, and the page reads the collection again.
      listings.mockResolvedValue(page([items[0]]));
      await wrapper.unmount();
      const again = render();
      await flushPromises();
      expect(rowEls(again)).toHaveLength(1);
      expect(isPendingBuy(1, refOf(items[1]))).toBe(false);
    });

    it('is kept while the collection is only partly read: the listing may be on a page not loaded yet', async () => {
      const { wrapper, items } = await sentOn(1);
      wrapper.unmount();
      listings.mockResolvedValue(page([items[0]], 'c1'));
      render();
      await flushPromises();
      expect(isPendingBuy(1, refOf(items[1]))).toBe(true);
    });

    it('is kept while the list is read again and still holds the listing', async () => {
      const { wrapper, items } = await sentOn(1);
      listings.mockResolvedValue(page(items));
      await byId(wrapper, 'collection-sort-recent').trigger('click');
      await flushPromises();
      expect(isPendingBuy(1, refOf(items[1]))).toBe(true);
      expect(rowEls(wrapper)[1].find('[data-testid="listing-buy"]').exists()).toBe(false);
    });
  });

  it('reads the list again when the sheet says the listing changed', async () => {
    const { wrapper } = await opened();
    listings.mockResolvedValue(page(rows(0, 1)));
    await byId(wrapper, 'buy-dialog-refresh').trigger('click');
    await flushPromises();

    expect(listings).toHaveBeenCalledTimes(2);
    expect(listings.mock.calls[1][1]).not.toHaveProperty('cursor');
    expect(rowEls(wrapper)).toHaveLength(1);
  });
});

describe('the lookalike warning', () => {
  const TOP = [
    { policyId: REAL_POLICY, name: 'SpaceBudz' },
    { policyId: 'bb'.repeat(28), name: 'Clay Nation' },
  ];

  it('is shown when an NFT\'s name is that of a top collection under another policy, with the real policy ID, and on every row', async () => {
    topCollections.mockResolvedValue(TOP);
    const items = rows(0, 2);
    listings.mockResolvedValue(page(items));
    metaState.meta.value = new Map(items.map((l, i) => [l.unit, { name: `SpaceBudz #${i + 1}` }]));
    const wrapper = render();
    await flushPromises();

    expect(byId(wrapper, 'collection-lookalike').text()).toBe(
      `This collection has the same name as SpaceBudz, a popular collection under a different policy ID (${REAL_POLICY}). Check the policy ID before you buy.`,
    );
    expect(rowEls(wrapper).map((el) => el.find('[data-testid="listing-lookalike"]').text())).toEqual(['Possible lookalike', 'Possible lookalike']);
    // The policy ID is still on every row.
    expect(rowEls(wrapper).every((el) => el.get('[data-testid="listing-policy"]').text().includes(filters.truncate(POLICY)))).toBe(true);
  });

  it('compares the names without regard to case or the spaces around them', async () => {
    topCollections.mockResolvedValue([{ policyId: REAL_POLICY, name: '  SPACEBUDZ ' }]);
    const items = rows(0, 1);
    listings.mockResolvedValue(page(items));
    metaState.meta.value = new Map([[items[0].unit, { name: 'spacebudz #9' }]]);
    const wrapper = render();
    await flushPromises();
    expect(has(wrapper, 'collection-lookalike')).toBe(true);
  });

  it('reads the collection field an NFT\'s metadata names, and the name the wallet holds the collection under', async () => {
    topCollections.mockResolvedValue(TOP);
    const items = rows(0, 1);
    listings.mockResolvedValue(page(items));
    metaState.meta.value = new Map([[items[0].unit, { name: 'Token 1', collection: 'Clay Nation' }]]);
    const viaMetadata = render();
    await flushPromises();
    expect(byId(viaMetadata, 'collection-lookalike').text()).toContain('Clay Nation');
    viaMetadata.unmount();

    metaState.meta.value = new Map([[items[0].unit, { name: 'Token 1' }]]);
    heldCollections.value = { [POLICY]: { name: 'spacebudz' } };
    const viaHeld = render();
    await flushPromises();
    expect(byId(viaHeld, 'collection-lookalike').text()).toContain('SpaceBudz');
  });

  it('is not shown for a collection that is not called like a popular one', async () => {
    topCollections.mockResolvedValue(TOP);
    const items = rows(0, 2);
    listings.mockResolvedValue(page(items));
    metaState.meta.value = new Map(items.map((l, i) => [l.unit, { name: `Cool Cat #${i + 1}` }]));
    const wrapper = render();
    await flushPromises();
    expect(has(wrapper, 'collection-lookalike')).toBe(false);
    expect(has(wrapper, 'listing-lookalike')).toBe(false);
    expect(has(wrapper, 'collection-lookalike-unchecked')).toBe(false);
  });

  it('is not shown for the popular collection itself', async () => {
    topCollections.mockResolvedValue(TOP);
    const items = rows(0, 1, { policyId: REAL_POLICY });
    listings.mockResolvedValue(page(items));
    metaState.meta.value = new Map([[items[0].unit, { name: 'SpaceBudz #1' }]]);
    const wrapper = render({ policyId: REAL_POLICY });
    await flushPromises();
    expect(has(wrapper, 'collection-lookalike')).toBe(false);
  });

  it('is passed to the purchase sheet, so the warning is there where the decision is made', async () => {
    topCollections.mockResolvedValue(TOP);
    const items = rows(0, 1);
    listings.mockResolvedValue(page(items));
    metaState.meta.value = new Map([[items[0].unit, { name: 'SpaceBudz #1' }]]);
    const wrapper = render();
    await flushPromises();
    await byId(wrapper, 'listing-buy').trigger('click');
    expect(byId(wrapper, 'buy-dialog').attributes('data-lookalike')).toBe(REAL_POLICY);
  });

  it('says it could not check when the top collections cannot be read, and the rows still show their policy ID', async () => {
    topCollections.mockResolvedValue(null);
    listings.mockResolvedValue(page(rows(0, 1)));
    const wrapper = render();
    await flushPromises();
    expect(byId(wrapper, 'collection-lookalike-unchecked').text()).toBe(
      'We could not check this collection against popular ones. Compare the policy ID yourself before you buy.',
    );
    expect(has(wrapper, 'collection-lookalike')).toBe(false);
    expect(has(wrapper, 'listing-policy')).toBe(true);
  });

  it('does not wait for the top collections to show the listings', async () => {
    topCollections.mockReturnValue(new Promise(() => {}));
    listings.mockResolvedValue(page(rows(0, 2)));
    const wrapper = render();
    await flushPromises();
    expect(rowEls(wrapper)).toHaveLength(2);
    expect(has(wrapper, 'collection-lookalike-unchecked')).toBe(false);
  });
});

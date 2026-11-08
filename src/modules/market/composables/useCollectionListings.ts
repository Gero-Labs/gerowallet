import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue';
import { nftMarketApi, type ListingDto, type ListingSort, type ListingsPage } from '@/api/nft-market-api';
import { nftMarketBrowseAvailable } from '@/shared/utils/nftMarketAvailability';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';

/** Listings asked for per page. */
export const LISTINGS_PAGE_SIZE = 20;

const refOf = (row: ListingDto): string => `${row.txHash}#${row.outputIndex}`;

/**
 * The open listings of one collection on Gero's market, paged by Nexus's keyset cursor
 * (`GET /api/nft-market/listings`), for the collection page.
 *
 *  - The cursor of a page is passed back exactly as Nexus gave it. It is Nexus's; this never
 *    builds, edits or reuses one across a sort or a collection.
 *  - A page can report rows the wallet refused as malformed (`dropped`). They are counted, so the
 *    page can say some listings could not be shown, and a page whose rows were ALL dropped is not
 *    an empty collection: `hasMore` stays true while a cursor leads on.
 *  - Changing the sort, the collection or the wallet starts again from the first page; an answer
 *    for a state the user has left (it was in flight) is dropped, never shown.
 *  - Nothing is asked where browsing is not available (flag off, no wallet, a network with no
 *    deployment): the list simply stays empty.
 *
 * Reads only. Buying goes through the worker (`useNftMarketFlow('buy')`), which asks Nexus for the
 * listing again and verifies it on chain; what this list shows is never what a purchase is built from.
 */
export function useCollectionListings(policyId: () => string): {
  /** The listings shown so far, in Nexus's order, each once. */
  items: Ref<ListingDto[]>;
  sort: Ref<ListingSort>;
  /** The first page is being read. */
  loading: Ref<boolean>;
  /** A next page is being read. */
  loadingMore: Ref<boolean>;
  /** The first page could not be read (nothing is shown), or a next page could not (what was shown stays). */
  error: Ref<'first' | 'more' | null>;
  /** Rows of the pages read so far that the wallet left out as malformed. */
  dropped: Ref<number>;
  /**
   * A first page has been read for the collection as it stands now (even an empty one): false before
   * that, while the list starts over and after a first page that could not be read. With `hasMore`
   * false it means the whole collection is in `items`.
   */
  loaded: Ref<boolean>;
  /** Nexus has another page after the last one read. */
  hasMore: ComputedRef<boolean>;
  setSort: (next: ListingSort) => void;
  loadMore: () => Promise<void>;
  /** Read the first page again. */
  refresh: () => Promise<void>;
} {
  const items = ref<ListingDto[]>([]);
  const sort = ref<ListingSort>('price');
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<'first' | 'more' | null>(null);
  const dropped = ref(0);
  const loaded = ref(false);
  const nextCursor = ref<string | null>(null);
  const hasMore = computed(() => nextCursor.value !== null);

  /** Bumped whenever the list is emptied, so an answer that started before it is not applied after it. */
  let generation = 0;

  /** What a read depends on, or null where nothing is to be read. Two reads with the same `key` ask the same thing. */
  const target = computed(() => {
    if (!nftMarketBrowseAvailable()) return null;
    const wallet = walletStore.loggedWallet;
    if (!wallet) return null;
    const policy = policyId();
    return { policy, sort: sort.value, network: wallet.network, key: `${wallet.id}|${wallet.network}|${policy}|${sort.value}` };
  });

  function reset(): void {
    generation += 1;
    items.value = [];
    loaded.value = false;
    nextCursor.value = null;
    dropped.value = 0;
    error.value = null;
    loading.value = false;
    loadingMore.value = false;
  }

  function apply(page: ListingsPage): void {
    const seen = new Set(items.value.map(refOf));
    const added: ListingDto[] = [];
    for (const row of page.items) {
      const ref = refOf(row);
      if (seen.has(ref)) continue;
      seen.add(ref);
      added.push(row);
    }
    if (added.length > 0) items.value = [...items.value, ...added];
    dropped.value += page.dropped;
    nextCursor.value = page.nextCursor;
    loaded.value = true;
  }

  async function refresh(): Promise<void> {
    reset();
    const t = target.value;
    if (!t) return;
    const mine = generation;
    loading.value = true;
    try {
      const page = await nftMarketApi.listings(t.policy, { sort: t.sort, limit: LISTINGS_PAGE_SIZE }, t.network);
      if (mine === generation) apply(page);
    } catch (e) {
      debugLog('NFT market: the collection\'s listings could not be read', e);
      if (mine === generation) error.value = 'first';
    } finally {
      if (mine === generation) loading.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    const t = target.value;
    const cursor = nextCursor.value;
    if (!t || cursor === null || loading.value || loadingMore.value) return;
    const mine = generation;
    loadingMore.value = true;
    error.value = null;
    try {
      const page = await nftMarketApi.listings(t.policy, { sort: t.sort, cursor, limit: LISTINGS_PAGE_SIZE }, t.network);
      if (mine === generation) apply(page);
    } catch (e) {
      debugLog('NFT market: the next page of listings could not be read', e);
      if (mine === generation) error.value = 'more';
    } finally {
      if (mine === generation) loadingMore.value = false;
    }
  }

  function setSort(next: ListingSort): void {
    sort.value = next;
  }

  // The collection, the sort, the wallet or its network changed, or browsing just became possible.
  watch(() => target.value?.key ?? null, () => { void refresh(); }, { immediate: true });
  if (getCurrentScope()) onScopeDispose(() => { generation += 1; });

  return { items, sort, loading, loadingMore, error, dropped, loaded, hasMore, setSort, loadMore, refresh };
}

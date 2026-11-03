import { ref, computed, watch, onUnmounted, getCurrentInstance, type WatchStopHandle } from 'vue';
import type { NftCollectionStats } from '@/api/market-api';
import { loadTopNftCollections } from '@/modules/market/composables/useTopNftCollections';
import { collectibleCollectionsNow, listedUnitsNow } from '@/shared/composables/useCollectibleCollections';

export interface NftCollectionDisplay {
  policyId: string;
  policyIdShort: string;
  name: string;
  img: string;
  /** NFTs of the collection IN the wallet. The ones it has listed on Gero's market are not held: see `listedCount`. */
  quantity: number;
  /** NFTs of the collection the wallet has listed (locked at the market contract until sold or unlisted). */
  listedCount: number;
  isScam: boolean;
  description: string;
  // Market data (optional — may not be available from backend)
  floorPriceLovelace: number | null;
  lastSalePriceLovelace: number | null;
  totalVolumeLovelace: number | null;
  saleCount: number | null;
  // Computed
  /**
   * Floor price times every NFT the wallet owns of the collection, the listed ones INCLUDED: a
   * listed NFT is still the user's (it comes back if it is unlisted, and its sale is theirs), the
   * way the ADA locked in listings stays in the portfolio total. The table shows them as listed.
   */
  floorValueLovelace: number | null;
}

/** Every NFT of the collection the wallet owns: held plus listed. */
const ownedCount = (c: Pick<NftCollectionDisplay, 'quantity' | 'listedCount'>): number => (c.quantity || 0) + (c.listedCount || 0);

const collections = ref<NftCollectionDisplay[]>([]);
const loading = ref(false);
let nftWatcherRegistered = false;
let nftWatcherStop: WatchStopHandle | null = null;
let consumerCount = 0;

// Per-collection market-data cache, shared across consumers and re-fetches.
// A `null` entry = a collection Nexus has no data for (404); caching it stops
// the per-sync-tick 404/429 storm by never re-requesting known-missing policies.
const statsCache = new Map<string, NftCollectionStats | null>();
let fetchInFlight = false;
let fetchDebounce: ReturnType<typeof setTimeout> | null = null;

function cleanup(): void {
  if (nftWatcherStop) {
    nftWatcherStop();
    nftWatcherStop = null;
  }
  if (fetchDebounce) {
    clearTimeout(fetchDebounce);
    fetchDebounce = null;
  }
  nftWatcherRegistered = false;
}

export function useNftMarketData() {
  // Merge whatever is currently in statsCache onto a base list.
  function applyCachedStats(base: NftCollectionDisplay[]): void {
    collections.value = base.map(col => {
      const s = statsCache.get(col.policyId);
      if (s) {
        const floor = s.floorPriceLovelace ?? null;
        const qty = ownedCount(col);
        return {
          ...col,
          name: s.name || col.name,
          img: s.imageUrl || col.img,
          description: s.description || col.description || '',
          floorPriceLovelace: floor,
          lastSalePriceLovelace: s.lastSalePriceLovelace ?? null,
          totalVolumeLovelace: s.totalVolumeLovelace ?? null,
          saleCount: s.saleCount ?? null,
          floorValueLovelace: floor != null && qty > 0 ? floor * qty : null,
        };
      }
      return col;
    });
  }

  async function fetchUserNftCollections() {
    if (fetchInFlight) return; // a run is already in progress — don't pile on
    fetchInFlight = true;
    loading.value = true;
    try {
      // Start from walletStore.collections (populated by chain sync — always available), with
      // the NFTs the wallet has listed on Gero's market added back where it is available.
      const walletCollections = collectibleCollectionsNow();
      const entries = Object.entries(walletCollections);

      if (entries.length === 0) {
        collections.value = [];
        return;
      }

      // Build base list from wallet data (walletStore.collections already contains only NFTs).
      // `collectibleCollectionsNow` counts a listed NFT in its collection's quantity: the table's
      // "Held" must not, so those are taken out of it and counted as listed.
      const listedUnits = listedUnitsNow();
      const baseCollections: NftCollectionDisplay[] = entries
        .map(([policyId, col]) => {
          const listedCount = (col.items ?? []).filter((entry) => listedUnits.has(String(entry.unit).toLowerCase())).length;
          return {
            policyId,
            policyIdShort: policyId.slice(0, 12) + '...',
            name: col.name || policyId.slice(0, 8) + '...',
            img: col.img || '',
            quantity: Math.max(0, (col.quantity || col.items?.length || 0) - listedCount),
            listedCount,
            isScam: col.isScam || false,
            description: '',
            floorPriceLovelace: null,
            lastSalePriceLovelace: null,
            totalVolumeLovelace: null,
            saleCount: null,
            floorValueLovelace: null,
          };
        });

      // Show immediately, merging anything already cached.
      applyCachedStats(baseCollections);

      // Only do work for collections we have no cached answer for.
      const uncached = baseCollections.filter(c => !statsCache.has(c.policyId));
      if (uncached.length === 0) return;

      // Enrich ONLY from the bulk top-collections endpoint — a single request that
      // covers popular collections. We deliberately do NOT make per-collection
      // /api/nft/collection/{policy} calls: Nexus 404s collections it doesn't track
      // and 429-rate-limits the burst, and those collections have no market data to
      // show anyway. That per-collection loop was the source of the console spam.
      const uncachedIds = new Set(uncached.map(c => c.policyId));
      let bulkOk = false;
      // The same list the market page's lookalike warning compares names against: one shared
      // request. null = the bulk endpoint is unavailable — leave collections un-enriched and
      // retry next round.
      const topCollections = await loadTopNftCollections();
      if (topCollections) {
        bulkOk = true;
        for (const tc of topCollections) {
          if (tc.policyId && uncachedIds.has(tc.policyId)) statsCache.set(tc.policyId, tc);
        }
      }

      // After a successful bulk pass, cache everything else as "no data" so we never
      // re-request it on subsequent sync ticks. (If the bulk call failed we leave it
      // uncached so a later run can retry — no permanent blanking.)
      if (bulkOk) {
        for (const c of uncached) {
          if (!statsCache.has(c.policyId)) statsCache.set(c.policyId, null);
        }
      }

      // Re-apply now that the cache is populated.
      applyCachedStats(baseCollections);
    } catch (e) {
      console.warn('Failed to fetch NFT collection data:', e);
    } finally {
      loading.value = false;
      fetchInFlight = false;
    }
  }

  const hasNfts = computed(() => collections.value.length > 0);

  const totalFloorValue = computed(() => {
    return collections.value.reduce((sum, c) => {
      if (!c.floorPriceLovelace) return sum;
      return sum + (c.floorPriceLovelace * ownedCount(c)) / 1_000_000;
    }, 0);
  });

  // Re-fetch when wallet collections change (e.g. wallet switch) — register only once
  if (!nftWatcherRegistered) {
    nftWatcherRegistered = true;
    nftWatcherStop = watch(() => collectibleCollectionsNow(), () => {
      // Coalesce bursts of sync updates (which fire on every tip) into one fetch.
      if (fetchDebounce) clearTimeout(fetchDebounce);
      fetchDebounce = setTimeout(() => { fetchDebounce = null; fetchUserNftCollections(); }, 600);
    });
  }

  // Consumer counting for cleanup
  consumerCount++;
  if (getCurrentInstance()) {
    onUnmounted(() => {
      consumerCount--;
      if (consumerCount <= 0) {
        cleanup();
      }
    });
  }

  return {
    collections,
    loading,
    hasNfts,
    totalFloorValue,
    fetchUserNftCollections,
  };
}
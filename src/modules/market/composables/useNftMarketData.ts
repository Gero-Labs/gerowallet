import { ref, computed, watch, onUnmounted, getCurrentInstance, type WatchStopHandle } from 'vue';
import marketApi, { type NftCollectionStats } from '@/api/market-api';
import { walletStore } from '@/stores/walletStore';

export interface NftCollectionDisplay {
  policyId: string;
  policyIdShort: string;
  name: string;
  img: string;
  quantity: number;
  isScam: boolean;
  description: string;
  // Market data (optional — may not be available from backend)
  floorPriceLovelace: number | null;
  lastSalePriceLovelace: number | null;
  totalVolumeLovelace: number | null;
  saleCount: number | null;
  // Computed
  floorValueLovelace: number | null;
}

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
        const qty = col.quantity || 0;
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
      // Start from walletStore.collections (populated by chain sync — always available)
      const walletCollections = walletStore.collections || {};
      const entries = Object.entries(walletCollections) as [string, any][];

      if (entries.length === 0) {
        collections.value = [];
        return;
      }

      // Build base list from wallet data (walletStore.collections already contains only NFTs)
      const baseCollections: NftCollectionDisplay[] = entries
        .map(([policyId, col]) => ({
          policyId,
          policyIdShort: policyId.slice(0, 12) + '...',
          name: col.name || policyId.slice(0, 8) + '...',
          img: col.img || '',
          quantity: col.quantity || col.items?.length || 0,
          isScam: col.isScam || false,
          description: '',
          floorPriceLovelace: null,
          lastSalePriceLovelace: null,
          totalVolumeLovelace: null,
          saleCount: null,
          floorValueLovelace: null,
        }));

      // Show immediately, merging anything already cached.
      applyCachedStats(baseCollections);

      // Only hit the network for collections we have no cached answer for. The
      // cache stores `null` for collections Nexus has no data for (404), so we
      // never re-request them — this is what stops the per-sync 404/429 spam.
      const uncached = baseCollections.filter(c => !statsCache.has(c.policyId));
      if (uncached.length === 0) return;

      // Source 1: bulk top-collections endpoint (covers popular ones in one call).
      const uncachedIds = new Set(uncached.map(c => c.policyId));
      try {
        const topCollections = await marketApi.getNftCollections('volume', 200);
        if (Array.isArray(topCollections)) {
          for (const tc of topCollections) {
            if (tc.policyId && uncachedIds.has(tc.policyId)) statsCache.set(tc.policyId, tc);
          }
        }
      } catch {
        // Bulk endpoint not available — fall through to individual calls.
      }

      // Source 2: individual calls for whatever's still uncached (capped + paced
      // to avoid Nexus 429s). Cache EVERY attempt — stats on success, null on
      // 404/error — so each collection is a one-time cost, not per sync tick.
      const MAX_INDIVIDUAL = 20;
      const missing = uncached.filter(c => !statsCache.has(c.policyId)).slice(0, MAX_INDIVIDUAL);
      const BATCH_SIZE = 4;
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = missing.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (col) => ({ policyId: col.policyId, stats: await marketApi.getNftCollectionStats(col.policyId) })),
        );
        results.forEach((r, j) => {
          statsCache.set(batch[j].policyId, r.status === 'fulfilled' ? (r.value.stats ?? null) : null);
        });
        // Gentle pacing between batches to stay under Nexus rate limits.
        if (i + BATCH_SIZE < missing.length) {
          await new Promise(res => setTimeout(res, 250));
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
      return sum + (c.floorPriceLovelace * (c.quantity || 0)) / 1_000_000;
    }, 0);
  });

  // Re-fetch when wallet collections change (e.g. wallet switch) — register only once
  if (!nftWatcherRegistered) {
    nftWatcherRegistered = true;
    nftWatcherStop = watch(() => walletStore.collections, () => {
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
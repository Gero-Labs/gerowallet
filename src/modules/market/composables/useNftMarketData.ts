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

function cleanup(): void {
  if (nftWatcherStop) {
    nftWatcherStop();
    nftWatcherStop = null;
  }
  nftWatcherRegistered = false;
}

export function useNftMarketData() {
  async function fetchUserNftCollections() {
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

      // Set immediately so the user sees their collections
      collections.value = baseCollections;

      // Enrich with market data from two sources:
      // 1. Bulk top collections endpoint (covers popular collections)
      // 2. Individual per-collection calls (fills gaps)
      const statsMap = new Map<string, NftCollectionStats>();
      const userPolicyIds = new Set(baseCollections.map(c => c.policyId));

      // Source 1: Try bulk endpoint for top collections
      try {
        const topCollections = await marketApi.getNftCollections('volume', 200);
        if (Array.isArray(topCollections)) {
          for (const tc of topCollections) {
            if (tc.policyId && userPolicyIds.has(tc.policyId)) {
              statsMap.set(tc.policyId, tc);
            }
          }
        }
      } catch {
        // Bulk endpoint not available — continue with individual calls
      }

      // Source 2: Fetch individually for collections not covered by bulk (capped + batched to avoid API spam)
      const MAX_INDIVIDUAL = 20;
      const missing = baseCollections.filter(c => !statsMap.has(c.policyId)).slice(0, MAX_INDIVIDUAL);
      const BATCH_SIZE = 5;
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = missing.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (col) => {
            const stats = await marketApi.getNftCollectionStats(col.policyId);
            return { policyId: col.policyId, stats };
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.stats) {
            statsMap.set(r.value.policyId, r.value.stats);
          }
        }
      }

      // Apply market data to collections
      if (statsMap.size > 0) {
        collections.value = baseCollections.map(col => {
          const s = statsMap.get(col.policyId);
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
    } catch (e) {
      console.warn('Failed to fetch NFT collection data:', e);
    } finally {
      loading.value = false;
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
      fetchUserNftCollections();
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
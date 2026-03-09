import { ref, computed } from 'vue';
import marketApi, { type NftCollectionStats } from '@/api/market-api';
import { walletStore } from '@/stores/walletStore';

const collections = ref<(NftCollectionStats & { name?: string; image?: string; quantity?: number })[]>([]);
const loading = ref(false);

export function useNftMarketData() {
  async function fetchUserNftCollections() {
    loading.value = true;
    try {
      const tokens = walletStore.tokens || {};
      // Group NFTs by policyId
      const policyIds = new Set<string>();
      Object.entries(tokens).forEach(([unit, token]: [string, any]) => {
        if (unit !== 'lovelace' && token.quantity && Number(token.quantity) > 0) {
          // NFTs typically have quantity=1 and no decimals
          if ((!token.decimals || token.decimals === 0) && Number(token.quantity) <= 10) {
            const policyId = unit.substring(0, 56);
            policyIds.add(policyId);
          }
        }
      });

      if (policyIds.size === 0) {
        collections.value = [];
        return;
      }

      // Fetch stats for each collection
      const results = await Promise.allSettled(
        Array.from(policyIds).map(async (policyId) => {
          const stats = await marketApi.getNftCollectionStats(policyId);
          // Count how many NFTs user holds from this collection
          let quantity = 0;
          Object.entries(tokens).forEach(([unit, token]: [string, any]) => {
            if (unit.startsWith(policyId) && Number(token.quantity) > 0) {
              quantity += Number(token.quantity);
            }
          });
          return { ...stats, quantity };
        })
      );

      collections.value = results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter(c => c.floorPriceLovelace > 0 || c.saleCount > 0);
    } catch (e) {
      console.warn('Failed to fetch NFT collection data:', e);
    } finally {
      loading.value = false;
    }
  }

  const hasNfts = computed(() => collections.value.length > 0);

  const totalFloorValue = computed(() => {
    return collections.value.reduce((sum, c) => {
      return sum + (c.floorPriceLovelace * (c.quantity || 0)) / 1_000_000;
    }, 0);
  });

  return {
    collections,
    loading,
    hasNfts,
    totalFloorValue,
    fetchUserNftCollections,
  };
}

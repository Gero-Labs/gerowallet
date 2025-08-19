import Vue from 'vue';
import blockchainApi from '@/api/blockchain-api';
import { PaginatedResponse, PaginationParams, PaginationMeta } from '@/models/types';

export interface StakingStore {
  pools: any[];
  currentPool: any | null;
  paginationMeta: PaginationMeta | null;
  loading: boolean;
  poolLoading: boolean;
  error: string | null;
  poolError: string | null;
  filters: {
    search: string;
    hideSaturated: boolean;
    pledgeMet: boolean;
  };
}

export const stakingStore = Vue.observable<StakingStore>({
  pools: [],
  currentPool: null,
  paginationMeta: null,
  loading: false,
  poolLoading: false,
  error: null,
  poolError: null,
  filters: {
    search: '',
    hideSaturated: true,
    pledgeMet: true,
  },
});

const stakingStoreActions = {
  async loadPoolsPaginated(wallet: any, params: PaginationParams = {}) {
    stakingStore.loading = true;
    stakingStore.error = null;

    try {
      // Merge current filters with params
      const requestParams: PaginationParams = {
        page: params.page || 1,
        per_page: params.per_page || 8,
        search: params.search !== undefined ? params.search : stakingStore.filters.search,
        hide_saturated:
          params.hide_saturated !== undefined ? params.hide_saturated : stakingStore.filters.hideSaturated,
        pledge_met: params.pledge_met !== undefined ? params.pledge_met : stakingStore.filters.pledgeMet,
        sort_by: params.sort_by,
        sort_direction: params.sort_direction,
      };

      const response: PaginatedResponse<any> = await blockchainApi.getPoolsPaginated(
        requestParams,
        wallet.chain,
        wallet.network
      );

      // For server-side pagination, always replace pools with current page data
      stakingStore.pools = response.items || [];

      stakingStore.paginationMeta = response.meta;
    } catch (error: any) {
      stakingStore.error = error?.message || 'Failed to load pools';
      console.error('Error loading paginated pools:', error);
    } finally {
      stakingStore.loading = false;
    }
  },

  async loadPoolById(wallet: any, poolId: string) {
    stakingStore.poolLoading = true;
    stakingStore.poolError = null;

    try {
      const pool = await blockchainApi.getPoolById(poolId, wallet.chain, wallet.network);

      if (pool) {
        stakingStore.currentPool = pool;
      } else {
        stakingStore.poolError = 'Pool not found';
      }
    } catch (error: any) {
      stakingStore.poolError = error?.message || 'Failed to load pool';
      console.error('Error loading pool by ID:', error);
    } finally {
      stakingStore.poolLoading = false;
    }
  },

  updateFilters(filters: Partial<StakingStore['filters']>) {
    Object.assign(stakingStore.filters, filters);
  },

  resetPools() {
    stakingStore.pools = [];
    stakingStore.paginationMeta = null;
    stakingStore.error = null;
  },

  setPools(pools: any[]) {
    stakingStore.pools = pools;
  },

  setPaginationMeta(meta: PaginationMeta) {
    stakingStore.paginationMeta = meta;
  },

  setLoading(loading: boolean) {
    stakingStore.loading = loading;
  },

  setError(error: string | null) {
    stakingStore.error = error;
  },

  setCurrentPool(pool: any | null) {
    stakingStore.currentPool = pool;
  },

  setPoolLoading(loading: boolean) {
    stakingStore.poolLoading = loading;
  },

  setPoolError(error: string | null) {
    stakingStore.poolError = error;
  },

  clearCurrentPool() {
    stakingStore.currentPool = null;
    stakingStore.poolError = null;
  },

  state: stakingStore,
};

export default stakingStoreActions;

import { reactive } from 'vue';
import { PaginatedResponse, PaginationParams, PaginationMeta } from '@/models/types';
import blockchainApi from '@/api/blockchain-api';
import type { Wallet } from '@/models/types';
import type { DRepRecord } from '@/shared/utils/drepStats';

export interface GovernanceStore {
  dreps: DRepRecord[];
  currentDRep: DRepRecord | null;
  paginationMeta: PaginationMeta | null;
  loading: boolean;
  drepLoading: boolean;
  error: string | null;
  drepError: string | null;
  filters: {
    search: string;
  };
  /** CIP-0149: Active compensation basis points (null = no compensation) */
  currentCompensationBps: number | null;
}

export const governanceStore = reactive<GovernanceStore>({
  dreps: [],
  currentDRep: null,
  paginationMeta: null,
  loading: false,
  drepLoading: false,
  error: null,
  drepError: null,
  filters: {
    search: '',
  },
  currentCompensationBps: null,
});

const governanceStoreActions = {
  async loadDRepsPaginated(wallet: Pick<Wallet, 'chain' | 'network'>, params: PaginationParams = {}) {
    governanceStore.loading = true;
    governanceStore.error = null;

    try {
      // Merge current filters with params
      const requestParams: PaginationParams = {
        page: params.page || 1,
        per_page: params.per_page || 25,
        search: params.search !== undefined ? params.search : governanceStore.filters.search,
        sort_by: params.sort_by,
        sort_direction: params.sort_direction,
      };

      const response: PaginatedResponse<DRepRecord> = await blockchainApi.getDRepsPaginated(requestParams, wallet.chain, wallet.network);

      // For server-side pagination, always replace dreps with current page data
      governanceStore.dreps = response.items || [];

      governanceStore.paginationMeta = response.meta;
    } catch (error) {
      governanceStore.error = error instanceof Error ? error.message : 'Failed to load DReps';
      console.error('❌ Error loading paginated DReps:', error);
    } finally {
      governanceStore.loading = false;
    }
  },

  async loadDRepById(wallet: Pick<Wallet, 'chain' | 'network'>, drepId: string) {
    governanceStore.drepLoading = true;
    governanceStore.drepError = null;

    try {
      let drep;
      if (drepId == 'drep_always_abstain' || drepId == 'drep_always_no_confidence') {
        drep = {
          drep_id: drepId
        }
      } else {
        drep = await blockchainApi.getDRepById(drepId, wallet.chain, wallet.network);
      }

      if (drep) {
        governanceStore.currentDRep = drep;
      } else {
        governanceStore.drepError = 'DRep not found';
      }
    } catch (error) {
      governanceStore.drepError = error instanceof Error ? error.message : 'Failed to load DRep';
      console.error('Error loading DRep by ID:', error);
    } finally {
      governanceStore.drepLoading = false;
    }
  },

  updateFilters(filters: Partial<GovernanceStore['filters']>) {
    Object.assign(governanceStore.filters, filters);
  },

  resetDReps() {
    governanceStore.dreps = [];
    governanceStore.paginationMeta = null;
    governanceStore.error = null;
  },

  setDReps(dreps: DRepRecord[]) {
    governanceStore.dreps = dreps;
  },

  setPaginationMeta(meta: PaginationMeta) {
    governanceStore.paginationMeta = meta;
  },

  setLoading(loading: boolean) {
    governanceStore.loading = loading;
  },

  setError(error: string | null) {
    governanceStore.error = error;
  },

  setCurrentDRep(drep: DRepRecord | null) {
    governanceStore.currentDRep = drep;
  },

  setDRepLoading(loading: boolean) {
    governanceStore.drepLoading = loading;
  },

  setDRepError(error: string | null) {
    governanceStore.drepError = error;
  },

  clearCurrentDRep() {
    governanceStore.currentDRep = null;
    governanceStore.drepError = null;
  },

  /** CIP-0149: Set the current compensation basis points from delegation TX metadata */
  setCompensationBps(bps: number | null) {
    governanceStore.currentCompensationBps = bps;
  },

  state: governanceStore,
};

export default governanceStoreActions;

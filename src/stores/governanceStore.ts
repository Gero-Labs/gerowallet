import Vue from 'vue';
import { Api } from '@/api/api';
import { PaginatedResponse, PaginationParams, PaginationMeta } from '@/models/types';

export interface GovernanceStore {
  dreps: any[];
  currentDRep: any | null;
  paginationMeta: PaginationMeta | null;
  loading: boolean;
  drepLoading: boolean;
  error: string | null;
  drepError: string | null;
  filters: {
    search: string;
  };
}

export const governanceStore = Vue.observable<GovernanceStore>({
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
});

const governanceStoreActions = {
  async loadDRepsPaginated(wallet: any, provider: any, params: PaginationParams = {}) {
    governanceStore.loading = true;
    governanceStore.error = null;
    
    try {
      const api = new Api(wallet, provider);
      
      // Merge current filters with params
      const requestParams: PaginationParams = {
        page: params.page || 1,
        per_page: params.per_page || 25,
        search: params.search !== undefined ? params.search : governanceStore.filters.search,
        sort_by: params.sort_by,
        sort_desc: params.sort_desc,
      };
      
      console.log('🚀 Loading DReps with params:', requestParams);
      
      const response: PaginatedResponse<any> = await api.getDRepsPaginated(requestParams);
      
      // For server-side pagination, always replace dreps with current page data
      governanceStore.dreps = response.items || [];
      
      governanceStore.paginationMeta = response.meta;
      
      console.log('✅ DReps loaded successfully:', {
        drepsCount: governanceStore.dreps.length,
        meta: governanceStore.paginationMeta
      });
      
    } catch (error: any) {
      governanceStore.error = error?.message || 'Failed to load DReps';
      console.error('❌ Error loading paginated DReps:', error);
    } finally {
      governanceStore.loading = false;
    }
  },

  async loadDRepById(wallet: any, provider: any, drepId: string) {
    governanceStore.drepLoading = true;
    governanceStore.drepError = null;
    
    try {
      const api = new Api(wallet, provider);
      
      // Поиск DRep по ID в текущих данных
      const drep = governanceStore.dreps.find(d => d.drep_id === drepId);
      
      if (drep) {
        governanceStore.currentDRep = drep;
      } else {
        governanceStore.drepError = 'DRep not found';
      }
      
    } catch (error: any) {
      governanceStore.drepError = error?.message || 'Failed to load DRep';
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

  setDReps(dreps: any[]) {
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

  setCurrentDRep(drep: any | null) {
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

  state: governanceStore
};

export default governanceStoreActions;

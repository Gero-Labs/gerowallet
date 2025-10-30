import axios, { AxiosError } from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { Blockchain, Network, PaginationParams, PaginatedResponse, Tip } from '@/models/types';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async getPoolById(poolId: string, chain: string, network: string) {
    const chainEnum: string = Object.keys(Blockchain).find(key => Blockchain[key] === chain) || '';
    const networkEnum: string = Object.keys(Network).find(key => Network[key] === network) || '';
    try {
      const { data, status } = await axiosInstance.get(
        `/api/pools/${poolId}?chain=${chainEnum}&network=${networkEnum}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error: any | AxiosError) {
      if (error.response?.status === 404) {
        return null;
      }
      throw parseHttpError(error);
    }
  },

  async getPoolsPaginated(
    params: PaginationParams = {},
    chain: string,
    network: string
  ): Promise<PaginatedResponse<any>> {
    const chainEnum: string = Object.keys(Blockchain).find(key => Blockchain[key] === chain).toUpperCase() || '';
    const networkEnum: string = Object.keys(Network).find(key => Network[key] === network).toUpperCase() || '';
    try {
      // Build query parameters for server-side filtering and pagination
      const queryParams = new URLSearchParams({
        chain: chainEnum,
        network: networkEnum,
        page: (params.page || 1).toString(),
        per_page: (params.per_page || 20).toString(),
      });

      // Add optional filter parameters
      if (params.search) {
        queryParams.append('search', params.search);
      }
      if (params.hide_saturated !== undefined) {
        queryParams.append('hide_saturated', params.hide_saturated.toString());
      }
      if (params.pledge_met !== undefined) {
        queryParams.append('pledge_met', params.pledge_met.toString());
      }
      if (params.sort_by) {
        queryParams.append('sort_by', params.sort_by);
      }
      if (params.sort_direction !== undefined) {
        queryParams.append('sort_direction', params.sort_direction.toString());
      }

      const { data, status } = await axiosInstance.get(`/api/pools?${queryParams.toString()}`);

      if (status === 200) {
        // If server returns paginated response format, use it directly
        if (data && typeof data === 'object' && data.items && data.meta) {
          return data;
        }

        // Otherwise, wrap raw array in pagination format (fallback)
        const pools = data || [];
        return {
          items: pools,
          meta: {
            page: params.page || 1,
            total_items: pools.length,
            per_page: params.per_page || 20,
            total_pages: Math.ceil(pools.length / (params.per_page || 20)),
          },
        };
      }
      throw parseHttpError(data);
    } catch (error: any | AxiosError) {
      if (error.response?.status === 404) {
        return {
          items: [],
          meta: {
            page: params.page || 1,
            total_items: 0,
            per_page: params.per_page || 20,
            total_pages: 0,
          },
        };
      }
      throw parseHttpError(error);
    }
  },

  async getDRepsPaginated(
    params: PaginationParams = {},
    chain: string,
    network: string
  ): Promise<PaginatedResponse<any>> {
    const chainEnum: string = Object.keys(Blockchain).find(key => Blockchain[key] === chain) || '';
    const networkEnum: string = Object.keys(Network).find(key => Network[key] === network) || '';
    try {
      // Build query parameters for server-side filtering and pagination
      const queryParams = new URLSearchParams({
        chain: chainEnum,
        network: networkEnum,
        page: (params.page || 1).toString(),
        per_page: (params.per_page || 25).toString(),
      });

      // Add optional filter parameters
      if (params.search) {
        queryParams.append('search', params.search);
      }

      // Add sorting parameters
      if (params.sort_by) {
        queryParams.append('sort_by', params.sort_by);
      }
      if (params.sort_direction !== undefined) {
        queryParams.append('sort_direction', params.sort_direction.toString());
      }

      const { data, status } = await axiosInstance.get(`/api/dreps?${queryParams.toString()}`);

      if (status === 200) {
        // If server returns paginated response format, use it directly
        if (data && typeof data === 'object' && data.items && data.meta) {
          return data;
        }

        // Otherwise, wrap raw array in pagination format (fallback with client-side pagination)
        const allDReps = data || [];

        // Client-side filtering if search is provided
        let filteredDReps = allDReps;
        if (params.search && params.search.trim()) {
          const searchTerm = params.search.toLowerCase();
          filteredDReps = allDReps.filter((drep: any) => {
            const name =
              drep.metadata?.meta_json?.body?.givenName?.['@value'] ||
              drep.metadata?.meta_json?.body?.givenName ||
              'N/A';
            const id = drep.drep_id || '';

            return name.toLowerCase().includes(searchTerm) || id.toLowerCase().includes(searchTerm);
          });
        }

        // Client-side pagination
        const page = params.page || 1;
        const per_page = params.per_page || 25;
        const total_items = filteredDReps.length;
        const total_pages = Math.ceil(total_items / per_page);
        const start_index = (page - 1) * per_page;
        const end_index = start_index + per_page;
        const paginatedDReps = filteredDReps.slice(start_index, end_index);

        return {
          items: paginatedDReps,
          meta: {
            page,
            total_items,
            per_page,
            total_pages,
          },
        };
      }
      throw parseHttpError(data);
    } catch (error: any | AxiosError) {
      if (error.response?.status === 404) {
        return {
          items: [],
          meta: {
            page: params.page || 1,
            total_items: 0,
            per_page: params.per_page || 25,
            total_pages: 0,
          },
        };
      }
      throw parseHttpError(error);
    }
  },

  async getDRepById(drepId: string, chain: string, network: string) {
    const chainEnum: string = Object.keys(Blockchain).find(key => Blockchain[key] === chain) || '';
    const networkEnum: string = Object.keys(Network).find(key => Network[key] === network) || '';
    try {
      const { data, status } = await axiosInstance.get(
        `/api/dreps/${drepId}?chain=${chainEnum}&network=${networkEnum}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error: any | AxiosError) {
      if (error.response?.status === 404) {
        return null;
      }
      throw parseHttpError(error);
    }
  },

  /**
   * Perform a REST sync for a wallet to get latest blockchain data
   * @param syncRequest - Sync request parameters
   * @returns Sync response with account info, transactions, assets, tip
   */
  async syncRest(syncRequest: {
    chain: string;
    network: string;
    provider: string;
    from: number;
    to: Tip;
    address: string;
    rewards_sum: string;
    controlled_amount: string;
    withdrawable_amount: string;
    epoch?: number;
  }) {
    try {
      const { data, status } = await axiosInstance.post('/api/sync', syncRequest);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error: any | AxiosError) {
      console.error('REST sync failed:', error);
      throw parseHttpError(error);
    }
  },
};

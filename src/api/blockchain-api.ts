import axios, { AxiosError } from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { Blockchain, Network } from '@/models/types';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  /**
   * Get all staking pools for a given chain and network
   * Used by alarm-based refresh mechanism
   */
  async getAllStakingPools(chain: string, network: string): Promise<any[]> {
    try {
      const chainEnum: string = Object.keys(Blockchain).find(key => Blockchain[key] === chain);
      const networkEnum: string = Object.keys(Network).find(key => Network[key] === network);
      const { data, status } = await axiosInstance.get(
        `/api/pools/all?chain=${chainEnum}&network=${networkEnum}`
      );

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error: any | AxiosError) {
      if (error.response?.status === 404) {
        return []
      }
      throw parseHttpError(error);
    }
  },

  /**
   * Get all DReps (Delegated Representatives) for a given chain and network
   * Used by alarm-based refresh mechanism
   */
  async getAllDReps(chain: string, network: string): Promise<any[]> {
    try {
      const { data, status } = await axiosInstance.get(
        `/api/dreps/all?chain=${chain}&network=${network}`
      );

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error: any | AxiosError) {
      if (error.response?.status === 404) {
        return []
      }
      throw parseHttpError(error);
    }
  }
};

import axios from 'axios';
import { parseHttpError } from '@/shared/utils/parser';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async getSwapTokens(query?: string) {
    return axiosInstance.get(`/api/v2/swap/tokens${query ? '?query='+query : ''}`);
  },
  async getAssetData(tokenId: string) {
    try {
      const { data, status } = await axiosInstance.get(`https://analytics-snekfun.splash.trade/ws-http/v1/snekfun/asset-info/?asset=${tokenId}&quote=`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async getAllBlacklistPolicies() {
    return axiosInstance.get(`/api/assets/blacklist`);
  },
  async mCap(unit: string) {
    return axiosInstance.get(`/api/v2/mcap/${unit}`);
  },
}

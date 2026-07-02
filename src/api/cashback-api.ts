import axios from 'axios';
import { parseHttpError } from '@/shared/utils/parser';

export interface CashbackPortalBootstrap {
  portalUrl: string;
  token: string;
}

export interface CashbackResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async retailers(category: string, search?: string, page?: number): Promise<CashbackResponse> {
    try {
      const requestBody = {
        type: 'all',
        page: page ? page : 0,
        pageSize: 28
      }
      if (category) {
        requestBody['category'] = category;
      }
      if (search) {
        requestBody['search'] = search;
      }
      const { data, status } = await axiosInstance.post(`/api/bring/retailers`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async portal(walletAddress: string | null, theme: 'dark' | 'light' = 'dark'): Promise<CashbackPortalBootstrap> {
    try {
      // Bring's portal bootstrap expects the Chrome extension id.
      const extensionId = (typeof chrome !== 'undefined' && chrome.runtime?.id) ? chrome.runtime.id : undefined;
      const { data, status } = await axiosInstance.post('/api/bring/portal', { walletAddress, theme, extensionId });
      if (status === 200 && data?.portalUrl) return { portalUrl: data.portalUrl, token: data.token };
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
}

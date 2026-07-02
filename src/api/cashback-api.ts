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
  async checkAvailability(): Promise<boolean> {
    try {
      const { data, status } = await axiosInstance.get("/api/bring/check-availability");
      if (status === 200) return data?.isAvailable;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async categories(): Promise<CashbackResponse> {
    try {
      const { data, status } = await axiosInstance.get("/api/bring/categories");
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async categoriesSearch(): Promise<CashbackResponse> {
    try {
      const { data, status } = await axiosInstance.get("/api/bring/categories-search");
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async searchTerms(): Promise<CashbackResponse> {
    try {
      const { data, status } = await axiosInstance.get("/api/bring/search-terms");
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
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
  async cache(walletAddress: string): Promise<CashbackResponse> {
    try {
      const requestBody = {
        walletAddress,
      }
      const { data, status } = await axiosInstance.post(`/api/bring/cache`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async activate(itemId: string, walletAddress: string, tokenSymbol: string, search: string): Promise<CashbackResponse> {
    try {
      const requestBody = {
        itemId,
        walletAddress,
        tokenSymbol,
        search
      }
      const { data, status } = await axiosInstance.post(`/api/bring/activate`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async claimInit(walletAddress: string, targetWalletAddress: string, tokenSymbol: string, tokenAmount: number): Promise<CashbackResponse> {
    try {
      const requestBody = {
        walletAddress,
        targetWalletAddress,
        tokenSymbol,
        tokenAmount
      }
      const { data, status } = await axiosInstance.post(`/api/bring/claim-init`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async claimSubmit(walletAddress: string, targetWalletAddress: string, tokenSymbol: string, tokenAmount: number, message: string, signature: string, key: string): Promise<CashbackResponse | number> {
    try {
      const requestBody = {
        walletAddress,
        targetWalletAddress,
        tokenSymbol,
        tokenAmount,
        message,
        signature,
        key
      }
      const { data, status } = await axiosInstance.post(`/api/bring/claim-submit`, requestBody);
      if (status === 202) return status;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async analytics(itemId: string, itemName: string, walletAddress: string, tokenSymbol: string, search: string): Promise<CashbackResponse> {
    try {
      const requestBody = {
        type: 'retailer_shop',
        itemId,
        itemName,
        walletAddress,
        tokenSymbol,
        search,
      }
      const { data, status } = await axiosInstance.post(`/api/bring/analytics`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async portal(walletAddress: string | null, theme: 'dark' | 'light' = 'dark'): Promise<CashbackPortalBootstrap> {
    try {
      const { data, status } = await axiosInstance.post('/api/bring/portal', { walletAddress, theme });
      if (status === 200 && data?.portalUrl) return { portalUrl: data.portalUrl, token: data.token };
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
}

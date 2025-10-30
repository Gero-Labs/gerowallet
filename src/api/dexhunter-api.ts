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
  async getAveragePrice(tokenIn: string, tokenOut: string): Promise<any> {
    try {
      const { data, status } = await axiosInstance.get(`/api/v2/swap/averagePrice/${tokenIn}/${tokenOut}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async estimate(amount_in: number, token_in: string, token_out: string, slippage: number, blacklisted_dexes: string[], referrer: string = 'DEXHUNTER'): Promise<any> {
    if (token_in === 'lovelace') {
      token_in = ''
    }
    if (token_out === 'lovelace') {
      token_out = ''
    }
    const requestBody = {
      amount_in,
      referrer,
      slippage,
      token_in,
      token_out,
      blacklisted_dexes,
    }
    return axiosInstance.post(`/api/v2/swap/estimate`, requestBody);
  },
  async reverseEstimate(amount_out: number, token_in: string, token_out: string, slippage: number, blacklisted_dexes: string[], referrer: string = 'DEXHUNTER'): Promise<any> {
    if (token_in === 'lovelace') {
      token_in = ''
    }
    if (token_out === 'lovelace') {
      token_out = ''
    }
    const requestBody = {
      amount_out,
      referrer,
      slippage,
      token_in,
      token_out,
      blacklisted_dexes
    }
    await axiosInstance.post(`/api/v2/swap/reverseEstimate`, requestBody);
  },
  async swap(amount_in: number, buyer_address: string, token_in: string, token_out: string, slippage: number, referrer: string = 'DEXHUNTER'): Promise<any> {
    token_in = token_in === "lovelace" ? '' : token_in;
    token_out = token_out === "lovelace" ? '' : token_out;
    const requestBody = {
      amount_in,
      buyer_address,
      slippage,
      token_in,
      token_out,
      referrer,
      blacklisted_dexes: [],
      tx_optimization: true
    }
    const { data } = await axiosInstance.post(`/api/v2/swap`, requestBody);
    return data
  },
  async swapLimitBuild(amount_in: number, buyer_address: string, token_in: string, token_out: string, referrer: string = 'GEROWALLET', multiples: number, to_split: boolean, wanted_price: number): Promise<any> {
    const requestBody = {
      amount_in,
      blacklisted_dexes: [],
      buyer_address,
      multiples,
      referrer,
      to_split,
      token_in,
      token_out,
      wanted_price
    }
    const { data } = await axiosInstance.post(`/api/v2/swap/limit/build`, requestBody);
    return data
  },
  async swapSign(Signatures: number, txCbor: string): Promise<any> {
    const requestBody = {
      Signatures,
      txCbor,
    }
    const { data } = await axiosInstance.post(`/api/v2/swap/sign`, requestBody);
    return data
  },
  async getAllBlacklistPolicies(): Promise<any> {
    return axiosInstance.get(`/api/assets/blacklist`);
  },
  async mCap(unit: string): Promise<any> {
    return axiosInstance.get(`/api/v2/mcap/${unit}`);
  },
  async walletBalance(addresses: string[]): Promise<any> {
    const requestBody = {
      addresses
    };
    return axiosInstance.post(`/api/v2/swap/wallet`, requestBody);
  }
}

import axios, { type AxiosResponse } from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async dailyPriceChange(unit: string): Promise<AxiosResponse<unknown>> {
    return axiosInstance.get(`/api/token/prices/chg?unit=${unit}`);
  },
  async getPortfolio(stakeAddress: string): Promise<AxiosResponse<Record<string, unknown>>> {
    return axiosInstance.get(`/api/wallet/portfolio/positions?address=${stakeAddress}`);
  },
  async getPortfolioTrendedValue(
    stakeAddress: string,
    currency: string = 'USD',
    timeframe: string = 'all'
  ): Promise<AxiosResponse<{ time: number; value: number }[]>> {
    return axiosInstance.get(
      `/api/wallet/value/trended?address=${stakeAddress}&timeframe=${timeframe}&quote=${currency}`
    );
  },
};

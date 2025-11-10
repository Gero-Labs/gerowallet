import { createHttpClient } from '@/api/httpClient';

const axiosInstance = createHttpClient();

export default {
  async dailyPriceChange(unit: string): Promise<any> {
    return axiosInstance.get(`/api/token/prices/chg?unit=${unit}`);
  },
  async getPortfolio(stakeAddress: string): Promise<any> {
    return axiosInstance.get(`/api/wallet/portfolio/positions?address=${stakeAddress}`);
  },
  async getPortfolioTrendedValue(
    stakeAddress: string,
    currency: string = 'USD',
    timeframe: string = 'all'
  ): Promise<any> {
    return axiosInstance.get(
      `/api/wallet/value/trended?address=${stakeAddress}&timeframe=${timeframe}&quote=${currency}`
    );
  },
};

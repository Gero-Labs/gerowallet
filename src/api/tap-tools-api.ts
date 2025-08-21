import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async dailyPriceChange(unit: string): Promise<any> {
    return axiosInstance.get(`/api/token/prices/chg?unit=${unit}`);
  },
  async getPortfolio(stakeAddress: string): Promise<any> {
    return axiosInstance.get(`/api/wallet/portfolio/positions?address=${stakeAddress}`);
  },
  async getPortfolioTrendedValue(stakeAddress: string, currency: string = 'USD'): Promise<any> {
    return axiosInstance.get(`/api/wallet/value/trended?address=${stakeAddress}&timeframe=1y&quote=${currency}`);
  },
};

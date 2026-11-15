import axios, { type AxiosResponse } from 'axios';

/** CoinGecko `simple/price` quote per coin id. */
export interface CoinGeckoQuote { usd?: number; usd_24h_change?: number; usd_market_cap?: number; usd_24h_vol?: number }

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async getSimplePrice(): Promise<AxiosResponse<Record<string, CoinGeckoQuote>>> {
    return axiosInstance.get(`https://api.coingecko.com/api/v3/simple/price?ids=cardano,apex-4&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&precision=6`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}

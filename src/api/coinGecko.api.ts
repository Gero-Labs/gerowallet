import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async getSimplePrice(): Promise<any> {
    return axiosInstance.get(`https://api.coingecko.com/api/v3/simple/price?ids=cardano,apex-4&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&precision=6`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}

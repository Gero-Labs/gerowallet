import { createHttpClient } from '@/api/httpClient';

const axiosInstance = createHttpClient();

export default {
  async getSimplePrice(): Promise<any> {
    return axiosInstance.get(`https://api.coingecko.com/api/v3/simple/price?ids=cardano,apex-2&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&precision=6`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}

import { createHttpClient } from '@/api/httpClient';

const axiosInstance = createHttpClient({ timeout: 10000 });
export default {
  async historicalCandles(unit: string): Promise<any> {
    return axiosInstance.get(`/api/prices/historical/candles?symbol=${unit}&resolution=1h&from=${parseInt(String((Date.now() - 86400000) / 1000))}`);
  },
}

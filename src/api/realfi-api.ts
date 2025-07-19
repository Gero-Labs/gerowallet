import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});
export default {
  async historicalCandles(unit: string): Promise<any> {
    return await axiosInstance.get(`/api/prices/historical/candles?symbol=${unit}&resolution=1h&from=${parseInt(String((Date.now() - 86400000) / 1000))}`);
  },
}

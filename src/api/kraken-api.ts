import axios from 'axios';

const axiosInstance = axios.create({
  // @ts-ignore
  baseURL: import.meta.env.VITE_KRAKEN_API_URL || 'https://api.kraken.com',
  timeout: 15000,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

export default {
  /**
   * Get OHLC (candlestick) data for ADA/USD
   * Used by TradingViewChart component
   */
  async getOHLC(pair: string = 'ADAUSD', interval: number = 5) {
    try {
      const { data } = await axiosInstance.get(`/0/public/OHLC?pair=${pair}&interval=${interval}`);
      
      if (data.error && data.error.length > 0) {
        throw new Error(`Kraken API error: ${data.error.join(', ')}`);
      }

      // Find the pair key in the result
      const pairKey = Object.keys(data.result).find(
        key => key !== 'last' && key.toUpperCase().includes(pair.toUpperCase())
      );

      if (!pairKey || !data.result[pairKey]) {
        console.warn(`🦑 Kraken API: No OHLC data found for ${pair}`);
        return [];
      }

      const krakenData = data.result[pairKey];
      
      // Type guard to ensure we have array data
      if (!Array.isArray(krakenData)) {
        console.warn(`🦑 Kraken API: Invalid OHLC data format for ${pair}`);
        return [];
      }

      // Convert Kraken format [timestamp, open, high, low, close, vwap, volume, count] to chart format
      return krakenData.map((candle: any[]) => ({
        time: candle[0],
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[6])
      })).sort((a: any, b: any) => a.time - b.time);

    } catch (error) {
      console.error(`🦑 Kraken API: Failed to fetch OHLC data for ${pair}:`, error);
      return [];
    }
  },

  /**
   * Get current ticker/price information for a trading pair
   * Used for real-time price updates
   */
  async getTicker(pair: string = 'ADAUSD') {
    try {
      const { data } = await axiosInstance.get(`/0/public/Ticker?pair=${pair}`);

      if (data.error && data.error.length > 0) {
        throw new Error(`Kraken API error: ${data.error.join(', ')}`);
      }

      // Find the pair key in the result
      const pairKey = Object.keys(data.result).find(
        key => key.toUpperCase().includes(pair.toUpperCase())
      );

      if (!pairKey || !data.result[pairKey]) {
        console.warn(`🦑 Kraken API: No ticker data found for ${pair}`);
        return null;
      }

      const tickerData = data.result[pairKey];
      
      const lastPrice = parseFloat(tickerData.c[0]);
      const volume24h = parseFloat(tickerData.v[1]);
      const high24h = parseFloat(tickerData.h[1]);
      const low24h = parseFloat(tickerData.l[1]);
      const open24h = parseFloat(tickerData.o[1]);
      const bid = parseFloat(tickerData.b[0]);
      const ask = parseFloat(tickerData.a[0]);

      // Calculate price change
      const priceChange = lastPrice - open24h;
      const priceChangePercentage = open24h !== 0 ? (priceChange / open24h) * 100 : 0;

      return {
        lastPrice,
        volume24h,
        high24h,
        low24h,
        open24h,
        priceChange,
        priceChangePercentage,
        bid,
        ask,
        timestamp: Date.now(),
        source: 'kraken'
      };

    } catch (error) {
      console.error(`🦑 Kraken API: Failed to fetch ticker for ${pair}:`, error);
      return null;
    }
  }
}
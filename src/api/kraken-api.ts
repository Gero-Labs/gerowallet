/**
 * Kraken REST API Client
 *
 * Provides access to Kraken's public REST endpoints for price data.
 * For real-time ticker data use krakenWebSocket.service.ts instead.
 */
import axios from 'axios';

const krakenAxios = axios.create({
  baseURL: 'https://api.kraken.com/0/public',
  timeout: 10000,
});

export interface KrakenTickerSnapshot {
  lastPrice: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  priceChange: number;
  priceChangePercentage: number;
}

export interface CandlestickDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export default {
  /**
   * Fetch BTC/USD OHLC candlestick data from Kraken.
   * Returns candles sorted by time ascending (oldest first).
   *
   * @param interval  Candle interval in minutes (default 60 = 1 h candles)
   * @param count     Max number of candles to return (default 168 = 7 days at 1 h)
   */
  async fetchBtcOhlc(interval = 60, count = 168): Promise<CandlestickDataPoint[]> {
    const response = await krakenAxios.get('/OHLC', {
      params: { pair: 'XBTUSD', interval },
    });
    if (response.data.error?.length > 0) {
      throw new Error(response.data.error[0]);
    }
    const candles: any[][] = response.data.result['XXBTZUSD'];
    if (!candles) throw new Error('No BTC OHLC data returned by Kraken');
    // Kraken format: [time, open, high, low, close, vwap, volume, count]
    return candles
      .slice(-count)
      .map((c) => ({
        time: c[0] as number,
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
      }))
      .sort((a, b) => a.time - b.time);
  },

  /**
   * Fetch the current BTC/USD ticker snapshot from Kraken REST API.
   * Use this when a single up-to-date price is needed without a WebSocket.
   */
  async fetchBtcTicker(): Promise<KrakenTickerSnapshot> {
    const response = await krakenAxios.get('/Ticker', {
      params: { pair: 'XBTUSD' },
    });
    if (response.data.error?.length > 0) {
      throw new Error(response.data.error[0]);
    }
    const t = response.data.result['XXBTZUSD'];
    if (!t) throw new Error('No BTC ticker data returned by Kraken');

    const lastPrice = parseFloat(t.c[0]);       // last trade price
    const open24h  = parseFloat(t.o);           // today's opening price
    const high24h  = parseFloat(t.h[1]);        // 24-hour high
    const low24h   = parseFloat(t.l[1]);        // 24-hour low
    const volume24h = parseFloat(t.v[1]);       // 24-hour volume
    const priceChange = lastPrice - open24h;
    const priceChangePercentage = open24h !== 0 ? (priceChange / open24h) * 100 : 0;

    return { lastPrice, open24h, high24h, low24h, volume24h, priceChange, priceChangePercentage };
  },
};
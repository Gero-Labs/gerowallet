// Strike Finance v2 API — Market Data (public, no auth)

import { strikeClient, strikeMarketClient } from './strike-v2.client';
import type {
  ExchangeInfo,
  OrderBookResponse,
  TradeResponse,
  PremiumIndexResponse,
  Ticker24hrResponse,
  TickerPriceResponse,
  BookTickerResponse,
  OpenInterestResponse,
  StrikeKline,
  StrikeMarketsResponse,
} from './strike-v2.types';

export const strikeMarketApi = {
  async getExchangeInfo(): Promise<ExchangeInfo> {
    const { data } = await strikeMarketClient.get('/v2/exchangeInfo');
    return data;
  },

  async getOrderBook(symbol: string, limit = 20): Promise<OrderBookResponse> {
    const { data } = await strikeMarketClient.get('/v2/depth', { params: { symbol, limit } });
    return data;
  },

  async getRecentTrades(symbol: string, limit = 100): Promise<TradeResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/trades', { params: { symbol, limit } });
    return data;
  },

  async getPremiumIndex(symbol?: string): Promise<PremiumIndexResponse | PremiumIndexResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/premiumIndex', { params: symbol ? { symbol } : undefined });
    return data;
  },

  async getMarkPrice(symbol?: string): Promise<unknown> {
    const { data } = await strikeMarketClient.get('/v2/markPrice', { params: symbol ? { symbol } : undefined });
    return data;
  },

  async getIndexPrice(symbol?: string): Promise<unknown> {
    const { data } = await strikeMarketClient.get('/v2/indexPrice', { params: symbol ? { symbol } : undefined });
    return data;
  },

  async get24hrTicker(symbol?: string): Promise<Ticker24hrResponse | Ticker24hrResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/ticker/24hr', { params: symbol ? { symbol } : undefined });
    return data;
  },

  async getTickerPrice(symbol?: string): Promise<TickerPriceResponse | TickerPriceResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/ticker/price', { params: symbol ? { symbol } : undefined });
    return data;
  },

  async getBookTicker(symbol?: string): Promise<BookTickerResponse | BookTickerResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/ticker/bookTicker', { params: symbol ? { symbol } : undefined });
    return data;
  },

  async getOpenInterest(symbol?: string): Promise<OpenInterestResponse | OpenInterestResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/openInterest', { params: symbol ? { symbol } : undefined });
    return data;
  },

  async getKlines(params: {
    symbol: string;
    interval: string;
    priceType?: 'mark' | 'index' | 'last';
    limit?: number;
    startTime?: number;
    endTime?: number;
  }): Promise<StrikeKline[]> {
    const { data } = await strikeMarketClient.get('/v2/klines', { params });
    return data;
  },

  /** Fetch market configuration (tick sizes, margin tiers, min/max sizes). No auth required. */
  async getMarkets(): Promise<StrikeMarketsResponse> {
    const { data } = await strikeClient.get('/v2/markets');
    return data;
  },
};

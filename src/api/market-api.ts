import axios from 'axios';

// Market data is routed through gero-backend's Nexus proxy
// (VITE_NEXUS_URL → <backend>/api/nexus), which injects the Nexus API key
// server-side. No client-side auth.
const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export { axiosInstance as marketAxiosInstance };

// ── Interfaces ──────────────────────────────────────────────────────────────────

export interface TokenPriceResponse {
  assetId: string;
  dex: string | null;
  source?: string | null;
  assetNameAscii: string;
  priceAda: number;
  priceUsd: number;
  priceEur: number;
  priceChange1h: number | null;
  priceChange24h: number | null;
  priceChange7d: number | null;
  priceChange30d: number | null;
  tvl: number;
  volume24h: number;
  volume7d: number | null;
  organicVolume24h: number;
  txnCount24h: number | null;
  makerCount24h: number | null;
  totalSupply: number | null;
  marketCap: number | null;
  liquidity: number | null;
  holders: number | null;
  // Metadata fields (from token_metadata join — may not be present yet)
  name: string | null;
  ticker: string | null;
  logo: string | null;
  fingerprint: string | null;
  decimals: number | null;
  verified: boolean | null;
  isNew: boolean | null;
  updatedAt: string;
}

export interface AdaPriceResponse {
  priceUsd: number;
  priceEur: number;
  priceChange24h: number;
  marketCap: number;
  volume24h: number;
  updatedAt: string;
}

export interface PriceHistoryResponse {
  id: number;
  assetId: string;
  dex: string;
  priceAda: number;
  priceUsd: number;
  volume: number;
  tvl: number;
  timestamp: string;
  slot: number;
}

export interface CandleResponse {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  currency?: string;
}

export interface SparklineResponse {
  /** Window the series covers, e.g. '24h' | '7d' | '30d'. */
  window: string;
  /** Number of points per series. */
  points: number;
  /** Per-token close-price series keyed by assetId (backend shape: { window, points, data }). */
  data: Record<string, number[]>;
}

export interface WalletPnlToken {
  unit: string;
  displayName: string;
  currentQuantity: number;
  avgCostBasisAda: number | null;
  currentPriceAda: number;
  realizedPnlAda: number;
  unrealizedPnlAda: number;
  unknownCostQuantity?: number | null;
  costBasisComplete?: boolean;
}

export interface WalletPnlSummary {
  stakeAddress: string;
  totalPnlAda: number;
  totalRealizedPnlAda: number;
  totalUnrealizedPnlAda: number;
  tokens: WalletPnlToken[];
  truncated?: boolean;
  totalTransactions?: number;
  processedTransactions?: number;
}

export interface WalletSnapshot {
  timestamp: number;
  totalValueAda: number;
  totalValueUsd: number;
  totalValueEur: number;
  adaBalance: number;
  tokenValueAda: number;
  nftValueAda: number;
}

export interface LiquidityPool {
  poolId: string;
  dex: string;
  tokenAPolicyId: string;
  tokenAAssetName: string;
  tokenAReserve: number;
  tokenBPolicyId: string;
  tokenBAssetName: string;
  tokenBReserve: number;
  price: number;
  tvlAda: number;
  feePercent: number;
  updatedAt: string;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  depthPercent: number;
}

export interface OrderBook {
  poolId: string;
  dex: string;
  tokenA: string;
  tokenB: string;
  currentPrice: number;
  tvlAda: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface AssetPrice {
  asset: string;
  name: string;
  priceAda: number;
  priceUsd: number;
  updatedAt: string;
}

export interface LatestPricesResponse {
  date: string;
  assets: AssetPrice[];
}

export interface NftCollectionStats {
  policyId: string;
  floorPriceLovelace: number;
  lastSalePriceLovelace: number;
  totalVolumeLovelace: number;
  saleCount: number;
  updatedAt: string;
  // Metadata (from bulk endpoint)
  name?: string;
  imageUrl?: string;
  description?: string;
}

export interface NftSale {
  policyId: string;
  assetName: string;
  priceLovelace: number;
  sellerAddress: string;
  buyerAddress: string;
  marketplace: string;
  txHash: string;
  outputIndex: number;
  slot: number;
  blockTime: string;
}

export interface SwapHistory {
  txHash: string;
  type: 'BUY' | 'SELL';
  priceAda: number;
  volumeAda: number;
  dex: string;
  blockTime: string;
}

// ── API Methods ─────────────────────────────────────────────────────────────────

export default {

  // ── Market Service ──────────────────────────────────────────────────────────

  async getAllPrices(): Promise<TokenPriceResponse[]> {
    const { data } = await axiosInstance.get('/api/market/prices');
    return data;
  },

  async getTokenPrice(assetId: string): Promise<TokenPriceResponse> {
    const { data } = await axiosInstance.get(`/api/market/prices/${assetId}`);
    return data;
  },

  async getTokenPricesAcrossDexes(assetId: string): Promise<TokenPriceResponse[]> {
    const { data } = await axiosInstance.get(`/api/market/prices/${assetId}/all`);
    return data;
  },

  async getTopByVolume(limit: number = 20): Promise<TokenPriceResponse[]> {
    const { data } = await axiosInstance.get('/api/market/prices/top-volume', { params: { limit } });
    return data;
  },

  async getTopByTvl(limit: number = 20): Promise<TokenPriceResponse[]> {
    const { data } = await axiosInstance.get('/api/market/prices/top-tvl', { params: { limit } });
    return data;
  },

  async getAdaPrice(): Promise<AdaPriceResponse> {
    const { data } = await axiosInstance.get('/api/market/ada');
    return data;
  },

  async getPriceHistory(assetId: string, from: string, to: string): Promise<PriceHistoryResponse[]> {
    const { data } = await axiosInstance.get(`/api/market/history/${assetId}`, { params: { from, to } });
    return data;
  },

  async getPriceAtTime(assetId: string, time: string): Promise<PriceHistoryResponse> {
    const { data } = await axiosInstance.get(`/api/market/history/${assetId}/at`, { params: { time } });
    return data;
  },

  async getAllTokenIds(): Promise<string[]> {
    const { data } = await axiosInstance.get('/api/market/tokens');
    return data;
  },

  // ── Price Service ───────────────────────────────────────────────────────────

  async getCandles(assetId: string, resolution: string = '1h', from?: string, to?: string, currency?: string): Promise<CandleResponse[]> {
    // ADA uses a dedicated endpoint (the generic one returns [] for lovelace)
    if (assetId === 'lovelace' || assetId === 'ada') {
      const { data } = await axiosInstance.get('/api/prices/ada/candles', { params: { currency, resolution, from, to } });
      return data;
    }
    const { data } = await axiosInstance.get('/api/prices/historical/candles', { params: { assetId, resolution, from, to, currency } });
    return data;
  },

  async getLatestPrices(symbols?: string[]): Promise<LatestPricesResponse> {
    const { data } = await axiosInstance.get('/api/prices/latest', { params: { symbols: symbols?.join(',') } });
    return data;
  },

  /**
   * Inline sparkline price series for every token over the given window (e.g. '7d').
   * Backend shape: { window, points, data: { [assetId]: number[] } } (PriceController#getSparklines).
   * NOTE: may 404 until prod deploys /api/prices/sparklines — callers must treat it as best-effort.
   */
  async getSparklines(window: string = '7d'): Promise<SparklineResponse> {
    // The Nexus proxy does not forward /sparklines, but the public market backend
    // serves it (same source the market-data website uses). Hit it directly —
    // CSP/host_permissions already allow *.gerowallet.io.
    const base = (import.meta.env['VITE_MARKET_API_URL'] as string | undefined) || 'https://market.gerowallet.io';
    const { data } = await axios.get(`${base}/api/v1/prices/sparklines`, { params: { window }, timeout: 15000 });
    return data;
  },

  /**
   * snek.fun bonding-curve tokens — a separate off-chain feed (source: "SNEKFUN").
   * Not forwarded by the Nexus proxy, so hit the public market backend directly
   * (same pattern as getSparklines).
   */
  async getSnekFunTokens(): Promise<TokenPriceResponse[]> {
    const base = (import.meta.env['VITE_MARKET_API_URL'] as string | undefined) || 'https://market.gerowallet.io';
    const { data } = await axios.get(`${base}/api/v1/market/snekfun`, { timeout: 15000 });
    return data;
  },

  // ── Wallet Service ──────────────────────────────────────────────────────────

  async getWalletPnl(stakeAddress: string): Promise<WalletPnlSummary> {
    const { data } = await axiosInstance.get(`/api/wallet/${stakeAddress}/pnl`, { timeout: 60000 });
    return data;
  },

  async getWalletHistory(stakeAddress: string, resolution: string = '1D', adaOnly: boolean = true): Promise<WalletSnapshot[]> {
    const { data } = await axiosInstance.get(`/api/wallet/${stakeAddress}/history`, { params: { resolution, adaOnly } });
    return data;
  },

  async getWalletHoldings(stakeAddress: string): Promise<any> {
    const { data } = await axiosInstance.get(`/api/wallet/${stakeAddress}/holdings`);
    return data;
  },

  // ── DEX Service ─────────────────────────────────────────────────────────────

  async getPoolsByToken(policyId: string, assetName: string): Promise<LiquidityPool[]> {
    const { data } = await axiosInstance.get(`/api/dex/pools/token/${policyId}/${assetName}`);
    return data;
  },

  async getOrderBook(poolId: string, levels: number = 20): Promise<OrderBook> {
    const { data } = await axiosInstance.get(`/api/dex/orderbook/${poolId}`, { params: { levels } });
    return data;
  },

  async getSimulatedOrderBook(poolId: string, levels: number = 20): Promise<OrderBook> {
    const { data } = await axiosInstance.get(`/api/dex/orderbook/${poolId}/simulated`, { params: { levels } });
    return data;
  },

  async getTopPoolsByTvl(limit: number = 20): Promise<LiquidityPool[]> {
    const { data } = await axiosInstance.get('/api/dex/pools/top-tvl', { params: { limit } });
    return data;
  },

  // ── NFT Service ──────────────────────────────────────────────────────────────

  async getNftCollections(sort: string = 'volume', limit: number = 50): Promise<NftCollectionStats[]> {
    const { data } = await axiosInstance.get('/api/nft/collections', { params: { sort, limit } });
    return data;
  },

  async getNftCollectionStats(policyId: string): Promise<NftCollectionStats> {
    const { data } = await axiosInstance.get(`/api/nft/collection/${policyId}`);
    return data;
  },

  async getNftCollectionSales(policyId: string, limit: number = 20): Promise<NftSale[]> {
    const { data } = await axiosInstance.get(`/api/nft/collection/${policyId}/sales`, { params: { limit } });
    return data;
  },

  async getNftFloorPrice(policyId: string): Promise<{ floorPriceLovelace: number }> {
    const { data } = await axiosInstance.get(`/api/nft/collection/${policyId}/floor`);
    return data;
  },

  async getNftAssetPrice(policyId: string, assetName: string): Promise<{ priceLovelace: number }> {
    const { data } = await axiosInstance.get(`/api/nft/asset/${policyId}/${assetName}/price`);
    return data;
  },

  // ── Swap History ──────────────────────────────────────────────────────────
  async getTokenSwaps(policyId: string, assetName: string, limit: number = 20): Promise<SwapHistory[]> {
    const { data } = await axiosInstance.get(`/api/dex/swaps/token/${policyId}/${assetName}`, { params: { limit } });
    return data;
  },
};

# Market Data Live Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all mock market data with live API data from `market.gerowallet.io`, add P&L tracking to the market table and detail panel, add Order Book and Cross-DEX sub-tabs to the detail panel, and add a P&L summary row to the dashboard portfolio card.

**Architecture:** New `market-api.ts` service calls the market data backend. A `useMarketData.ts` composable is refactored to fetch from this API instead of returning mock data. A new `useWalletPnl.ts` composable fetches P&L data. Existing stores (`dexHunterStore`, `xerberusStore`) enrich tokens with images, verified status, and risk ratings. The TokenDetailPanel gains two sub-tabs (Overview, Trading). The dashboard PortfolioChart card gains a P&L summary row.

**Tech Stack:** Vue 2.7, TypeScript, Axios, Vuetify 2.7, lightweight-charts

---

## Task 1: Create Market API Service

**Files:**
- Create: `src/api/market-api.ts`
- Modify: `.env.example` (add new env var)

**Context:** All existing API files (e.g., `src/api/dexhunter-api.ts`) follow the same pattern: create an axios instance with a base URL from `import.meta.env`, export an object with async methods. The new market API lives at `https://market.gerowallet.io`.

**Step 1: Add environment variable**

Add to `.env.example` (and `.env.development`, `.env.production`, `.env.beta`):
```
# Market Data API URL
VITE_MARKET_API_URL=https://market.gerowallet.io
```

**Step 2: Create `src/api/market-api.ts`**

```typescript
import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_MARKET_API_URL'] || 'https://market.gerowallet.io',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

export interface TokenPriceResponse {
  assetId: string;
  dex: string;
  assetNameAscii: string;
  priceAda: number;
  priceUsd: number;
  tvl: number;
  volume24h: number;
  organicVolume24h: number;
  updatedAt: string;
}

export interface AdaPriceResponse {
  priceUsd: number;
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
}

export interface WalletPnlToken {
  unit: string;
  displayName: string;
  currentQuantity: number;
  avgCostBasisAda: number;
  currentPriceAda: number;
  realizedPnlAda: number;
  unrealizedPnlAda: number;
}

export interface WalletPnlSummary {
  stakeAddress: string;
  totalRealizedPnlAda: number;
  totalUnrealizedPnlAda: number;
  tokens: WalletPnlToken[];
}

export interface WalletSnapshot {
  timestamp: number;
  totalValueAda: number;
  totalValueUsd: number;
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

export default {
  // --- Market Service ---

  async getAllPrices(): Promise<TokenPriceResponse[]> {
    const { data } = await axiosInstance.get('/api/v1/market/prices');
    return data;
  },

  async getTokenPrice(assetId: string): Promise<TokenPriceResponse> {
    const { data } = await axiosInstance.get(`/api/v1/market/prices/${assetId}`);
    return data;
  },

  async getTokenPricesAcrossDexes(assetId: string): Promise<TokenPriceResponse[]> {
    const { data } = await axiosInstance.get(`/api/v1/market/prices/${assetId}/all`);
    return data;
  },

  async getTopByVolume(limit = 20): Promise<TokenPriceResponse[]> {
    const { data } = await axiosInstance.get('/api/v1/market/prices/top-volume', { params: { limit } });
    return data;
  },

  async getTopByTvl(limit = 20): Promise<TokenPriceResponse[]> {
    const { data } = await axiosInstance.get('/api/v1/market/prices/top-tvl', { params: { limit } });
    return data;
  },

  async getAdaPrice(): Promise<AdaPriceResponse> {
    const { data } = await axiosInstance.get('/api/v1/market/ada');
    return data;
  },

  async getPriceHistory(assetId: string, from: string, to: string): Promise<PriceHistoryResponse[]> {
    const { data } = await axiosInstance.get(`/api/v1/market/history/${assetId}`, { params: { from, to } });
    return data;
  },

  async getPriceAtTime(assetId: string, time: string): Promise<PriceHistoryResponse> {
    const { data } = await axiosInstance.get(`/api/v1/market/history/${assetId}/at`, { params: { time } });
    return data;
  },

  async getAllTokenIds(): Promise<string[]> {
    const { data } = await axiosInstance.get('/api/v1/market/tokens');
    return data;
  },

  // --- Price Service (OHLCV) ---

  async getCandles(assetId: string, resolution = '1h', from?: number, to?: number): Promise<CandleResponse[]> {
    const params: any = { assetId, resolution };
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await axiosInstance.get('/api/v1/prices/historical/candles', { params });
    return data;
  },

  async getLatestPrices(symbols?: string[]): Promise<LatestPricesResponse> {
    const params: any = {};
    if (symbols?.length) params.symbols = symbols.join(',');
    const { data } = await axiosInstance.get('/api/v1/prices/latest', { params });
    return data;
  },

  // --- Wallet Service ---

  async getWalletPnl(stakeAddress: string): Promise<WalletPnlSummary> {
    const { data } = await axiosInstance.get(`/api/v1/wallet/${stakeAddress}/pnl`);
    return data;
  },

  async getWalletHistory(stakeAddress: string, resolution = '1D', adaOnly = true): Promise<WalletSnapshot[]> {
    const { data } = await axiosInstance.get(`/api/v1/wallet/${stakeAddress}/history`, {
      params: { resolution, adaOnly },
    });
    return data;
  },

  async getWalletHoldings(stakeAddress: string): Promise<any> {
    const { data } = await axiosInstance.get(`/api/v1/wallet/${stakeAddress}/holdings`);
    return data;
  },

  // --- DEX Service ---

  async getPoolsByToken(policyId: string, assetName: string): Promise<LiquidityPool[]> {
    const { data } = await axiosInstance.get(`/api/v1/dex/pools/token/${policyId}/${assetName}`);
    return data;
  },

  async getOrderBook(poolId: string, levels = 20): Promise<OrderBook> {
    const { data } = await axiosInstance.get(`/api/v1/dex/orderbook/${poolId}`, { params: { levels } });
    return data;
  },

  async getSimulatedOrderBook(poolId: string, levels = 20): Promise<OrderBook> {
    const { data } = await axiosInstance.get(`/api/v1/dex/orderbook/${poolId}/simulated`, { params: { levels } });
    return data;
  },

  async getTopPoolsByTvl(limit = 20): Promise<LiquidityPool[]> {
    const { data } = await axiosInstance.get('/api/v1/dex/pools/top-tvl', { params: { limit } });
    return data;
  },
};
```

**Step 3: Verify**

Run: `npm run typecheck`
Expected: No new errors from `market-api.ts`.

**Step 4: Commit**

```bash
git add src/api/market-api.ts .env.example
git commit -m "feat(market): add market data API service"
```

---

## Task 2: Refactor useMarketData Composable to Use Live API

**Files:**
- Modify: `src/modules/market/composables/useMarketData.ts`

**Context:** Currently this file exports 30 hardcoded `MOCK_TOKENS` and a `generateCandles()` function. Replace with live API calls. The `MarketToken` interface stays the same but some fields get populated from existing stores (`dexHunterStore` for images/verified, `xerberusStore` for risk ratings).

**Step 1: Rewrite `useMarketData.ts`**

Replace the entire file. Key changes:
- Remove `MOCK_TOKENS` array and `generateCandles()` function
- Add `fetchAllTokens()` that calls `marketApi.getAllPrices()` + `marketApi.getLatestPrices()` and merges with `dexHunterStore` and `xerberusStore`
- Add `fetchTokenCandles()` that calls `marketApi.getCandles()`
- Compute `change1h/24h/7d` via `marketApi.getPriceAtTime()` with caching
- Keep all existing computed properties (`trendingTokens`, `topGainers`, `topLosers`, `newTokens`)
- Add `fetchAdaPrice()` for ADA market data
- Add auto-refresh on interval (every 60 seconds)

```typescript
import { ref, computed, onBeforeUnmount, type Ref, type ComputedRef } from 'vue';
import marketApi, { type TokenPriceResponse, type CandleResponse } from '@/api/market-api';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { xerberusStore } from '@/stores/xerberusStore';

export interface MarketToken {
  unit: string;
  name: string;
  ticker: string;
  img: string;
  verified: boolean;
  price: number;
  priceAda: number;
  change1h: number;
  change24h: number;
  change7d: number;
  volume24h: number;
  mcap: number;
  tvl: number | null;
  liquidity: number;
  holders: number;
  riskRating: string | null;
  isNew: boolean;
  policyLocked: boolean;
  fingerprint: string;
  description?: string;
  organicVolume24h?: number;
  dex?: string;
  // Populated when cross-referencing with wallet holdings
  balance?: number;
  value?: number;
  // P&L fields (populated in My Holdings)
  avgCostBasis?: number | null;
  totalPnl?: number | null;
  realizedPnl?: number | null;
  unrealizedPnl?: number | null;
}

export interface CandlestickDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface AdaMarketData {
  priceUsd: number;
  priceChange24h: number;
  marketCap: number;
  volume24h: number;
}

// Cache for price-at-time requests to avoid repeated calls
const changeCache = new Map<string, { value: number; expiry: number }>();
const CHANGE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function computeChange(assetId: string, hoursAgo: number): Promise<number> {
  const cacheKey = `${assetId}_${hoursAgo}`;
  const cached = changeCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.value;

  try {
    const pastTime = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
    const pastPrice = await marketApi.getPriceAtTime(assetId, pastTime);
    // Change will be computed against current price in the caller
    const value = pastPrice?.priceUsd ?? 0;
    changeCache.set(cacheKey, { value, expiry: Date.now() + CHANGE_CACHE_TTL });
    return value;
  } catch {
    return 0;
  }
}

function enrichWithStores(assetId: string, apiToken: TokenPriceResponse, nameFromLatest?: string): MarketToken {
  const dexToken = dexHunterStore.dexHunterTokens?.[assetId];
  const fingerprint = dexToken?.fingerprint || '';
  const riskData = xerberusStore.risks?.[fingerprint];

  return {
    unit: assetId,
    name: nameFromLatest || dexToken?.name || apiToken.assetNameAscii || assetId,
    ticker: dexToken?.ticker || apiToken.assetNameAscii || '',
    img: dexToken?.img || '',
    verified: dexToken?.verified ?? false,
    price: apiToken.priceUsd ?? 0,
    priceAda: apiToken.priceAda ?? 0,
    change1h: 0,  // computed async below
    change24h: 0,
    change7d: 0,
    volume24h: apiToken.volume24h ?? 0,
    mcap: dexToken?.mcap ?? 0,
    tvl: apiToken.tvl || null,
    liquidity: 0,
    holders: dexToken?.holders ?? 0,
    riskRating: riskData?.risk ?? null,
    isNew: false,
    policyLocked: true,
    fingerprint,
    organicVolume24h: apiToken.organicVolume24h ?? 0,
    dex: apiToken.dex,
  };
}

// Singleton state so multiple components share the same data
const allTokens: Ref<MarketToken[]> = ref([]);
const adaData: Ref<AdaMarketData | null> = ref(null);
const loading = ref(false);
const error: Ref<string | null> = ref(null);
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;

async function fetchAllTokens() {
  loading.value = true;
  error.value = null;

  try {
    const [pricesResponse, latestResponse, adaResponse] = await Promise.all([
      marketApi.getAllPrices(),
      marketApi.getLatestPrices(),
      marketApi.getAdaPrice(),
    ]);

    // Build name lookup from /prices/latest
    const nameMap = new Map<string, string>();
    if (latestResponse?.assets) {
      for (const a of latestResponse.assets) {
        nameMap.set(a.asset, a.name);
      }
    }

    // Build token list
    const tokens: MarketToken[] = pricesResponse.map(tp =>
      enrichWithStores(tp.assetId, tp, nameMap.get(tp.assetId))
    );

    // Add ADA as first token
    if (adaResponse) {
      adaData.value = {
        priceUsd: adaResponse.priceUsd,
        priceChange24h: adaResponse.priceChange24h,
        marketCap: adaResponse.marketCap,
        volume24h: adaResponse.volume24h,
      };

      const adaToken: MarketToken = {
        unit: 'lovelace',
        name: 'Cardano',
        ticker: 'ADA',
        img: '',
        verified: true,
        price: adaResponse.priceUsd,
        priceAda: 1,
        change1h: 0,
        change24h: adaResponse.priceChange24h ?? 0,
        change7d: 0,
        volume24h: adaResponse.volume24h ?? 0,
        mcap: adaResponse.marketCap ?? 0,
        tvl: null,
        liquidity: 0,
        holders: 0,
        riskRating: 'AAA',
        isNew: false,
        policyLocked: true,
        fingerprint: '',
      };

      // Check if ADA already in list, if not prepend
      const adaIdx = tokens.findIndex(t => t.unit === 'lovelace');
      if (adaIdx >= 0) {
        tokens[adaIdx] = { ...tokens[adaIdx], ...adaToken };
      } else {
        tokens.unshift(adaToken);
      }
    }

    allTokens.value = tokens;

    // Compute change% in background (non-blocking)
    computeAllChanges(tokens);
  } catch (err: any) {
    console.error('Market data fetch error:', err);
    error.value = err?.message || 'Failed to load market data';
  } finally {
    loading.value = false;
  }
}

async function computeAllChanges(tokens: MarketToken[]) {
  // Batch compute change% for top 50 tokens by volume to avoid hammering the API
  const topTokens = [...tokens]
    .filter(t => t.unit !== 'lovelace')
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 50);

  for (const token of topTokens) {
    if (token.price <= 0) continue;
    try {
      const [price1h, price24h, price7d] = await Promise.all([
        computeChange(token.unit, 1),
        computeChange(token.unit, 24),
        computeChange(token.unit, 168),
      ]);

      const idx = allTokens.value.findIndex(t => t.unit === token.unit);
      if (idx >= 0) {
        if (price1h > 0) allTokens.value[idx].change1h = ((token.price - price1h) / price1h) * 100;
        if (price24h > 0) allTokens.value[idx].change24h = ((token.price - price24h) / price24h) * 100;
        if (price7d > 0) allTokens.value[idx].change7d = ((token.price - price7d) / price7d) * 100;
      }
    } catch {
      // Silent — change% stays 0 for this token
    }
  }
}

export function useMarketData() {
  // Initialize on first use
  if (!initialized) {
    initialized = true;
    fetchAllTokens();
    refreshInterval = setInterval(fetchAllTokens, 60_000);
  }

  const trendingTokens: ComputedRef<MarketToken[]> = computed(() =>
    [...allTokens.value].sort((a, b) => b.volume24h - a.volume24h).slice(0, 20)
  );

  const topGainers: ComputedRef<MarketToken[]> = computed(() =>
    [...allTokens.value]
      .filter(tok => tok.change24h > 0)
      .sort((a, b) => b.change24h - a.change24h)
      .slice(0, 20)
  );

  const topLosers: ComputedRef<MarketToken[]> = computed(() =>
    [...allTokens.value]
      .filter(tok => tok.change24h < 0)
      .sort((a, b) => a.change24h - b.change24h)
      .slice(0, 20)
  );

  const newTokens: ComputedRef<MarketToken[]> = computed(() =>
    allTokens.value.filter(t => t.isNew)
  );

  function searchTokens(query: string): MarketToken[] {
    if (!query.trim()) return allTokens.value;
    const q = query.toLowerCase().trim();
    return allTokens.value.filter(
      t => t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q)
    );
  }

  function getTokenByUnit(unit: string): MarketToken | undefined {
    return allTokens.value.find(t => t.unit === unit);
  }

  async function getTokenCandles(unit: string, timeframe: string): Promise<CandlestickDataPoint[]> {
    try {
      const candles = await marketApi.getCandles(unit, timeframe);
      return candles.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
    } catch {
      return [];
    }
  }

  function cleanup() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    initialized = false;
  }

  return {
    allTokens,
    adaData,
    trendingTokens,
    topGainers,
    topLosers,
    newTokens,
    loading,
    error,
    searchTokens,
    getTokenByUnit,
    getTokenCandles,
    fetchAllTokens,
    cleanup,
  };
}
```

**Key changes from mock version:**
- `getTokenCandles` is now `async` (returns Promise) — callers in `TokenDetailPanel.vue` must be updated
- `allTokens` is singleton state (shared across components, not re-created per composable call)
- 60-second auto-refresh interval
- Change% computed in background after initial load (non-blocking)
- `cleanup()` exposed for component unmount

**Step 2: Update TokenDetailPanel to handle async candles**

In `src/modules/market/components/TokenDetailPanel.vue`, the `candles` computed (line 189-191) currently calls `getTokenCandles()` synchronously. Change to:

```typescript
const candles = ref<CandlestickDataPoint[]>([]);

async function loadCandles() {
  candles.value = await getTokenCandles(props.token.unit, selectedTimeframe.value);
}

watch(() => props.token, () => {
  selectedTimeframe.value = '1h';
  loadCandles();
});

watch(selectedTimeframe, () => loadCandles());

// Initial load
loadCandles();
```

**Step 3: Update timeframe options**

In `TokenDetailPanel.vue` line 154, reduce to the 4 API-supported timeframes:

```typescript
const timeframeOptions = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
];
```

**Step 4: Verify**

Run: `npm run typecheck`

**Step 5: Commit**

```bash
git add src/modules/market/composables/useMarketData.ts src/modules/market/components/TokenDetailPanel.vue
git commit -m "feat(market): replace mock data with live market API"
```

---

## Task 3: Create useWalletPnl Composable

**Files:**
- Create: `src/modules/market/composables/useWalletPnl.ts`

**Context:** This composable fetches P&L data from `/wallet/{stakeAddress}/pnl` using the logged wallet's stake address from `walletStore.loggedWallet.stakeAddress`. Data is used in the My Holdings table columns and the TokenDetailPanel P&L section.

**Step 1: Create the composable**

```typescript
import { ref, type Ref } from 'vue';
import marketApi, { type WalletPnlSummary, type WalletPnlToken } from '@/api/market-api';
import { walletStore } from '@/stores/walletStore';

const pnlSummary: Ref<WalletPnlSummary | null> = ref(null);
const pnlByUnit = ref<Record<string, WalletPnlToken>>({});
const pnlLoading = ref(false);
const pnlError: Ref<string | null> = ref(null);

async function fetchPnl() {
  const stakeAddress = walletStore.loggedWallet?.stakeAddress;
  if (!stakeAddress) return;

  pnlLoading.value = true;
  pnlError.value = null;

  try {
    const data = await marketApi.getWalletPnl(stakeAddress);
    pnlSummary.value = data;

    // Build lookup by unit for fast access in table
    const lookup: Record<string, WalletPnlToken> = {};
    if (data?.tokens) {
      for (const t of data.tokens) {
        lookup[t.unit] = t;
      }
    }
    pnlByUnit.value = lookup;
  } catch (err: any) {
    console.error('Wallet P&L fetch error:', err);
    pnlError.value = err?.message || 'Failed to load P&L data';
  } finally {
    pnlLoading.value = false;
  }
}

export function useWalletPnl() {
  function getTokenPnl(unit: string): WalletPnlToken | null {
    return pnlByUnit.value[unit] ?? null;
  }

  function getTotalPnl(unit: string): number | null {
    const t = pnlByUnit.value[unit];
    if (!t) return null;
    return t.realizedPnlAda + t.unrealizedPnlAda;
  }

  return {
    pnlSummary,
    pnlByUnit,
    pnlLoading,
    pnlError,
    fetchPnl,
    getTokenPnl,
    getTotalPnl,
  };
}
```

**Step 2: Verify**

Run: `npm run typecheck`

**Step 3: Commit**

```bash
git add src/modules/market/composables/useWalletPnl.ts
git commit -m "feat(market): add wallet P&L composable"
```

---

## Task 4: Add P&L Columns to Market Token Table

**Files:**
- Modify: `src/modules/market/components/MarketTokenTable.vue`
- Modify: `src/modules/market/Market.vue`
- Modify: `src/plugins/i18n/us.ts` (add new i18n keys)
- Modify: `src/plugins/i18n/de.ts` (add German translations)

**Context:** When `showHoldingsColumns` is true (My Holdings tab, tab index 5), add two new columns after Value: `Avg Cost` and `Total P&L`. The P&L data comes from `useWalletPnl` composable. The `myHoldings` computed in `Market.vue` must merge P&L data into each token.

**Step 1: Add i18n keys**

In `src/plugins/i18n/us.ts`, add within the market section:
```typescript
'market.avgCost': 'Avg Cost',
'market.totalPnl': 'P&L',
'market.avgCostTooltip': 'Average cost basis in ADA',
'market.totalPnlTooltip': 'Total profit & loss (realized + unrealized)',
'market.unrealizedPnl': 'Unrealized',
'market.realizedPnl': 'Realized',
'market.overview': 'Overview',
'market.trading': 'Trading',
'market.orderBook': 'Order Book',
'market.crossDex': 'Cross-DEX Prices',
'market.depthChart': 'Depth',
'market.bestPrice': 'Best Price',
'market.pnl': 'P&L',
'market.avgCostBasis': 'Avg Cost Basis',
'market.currentPrice': 'Current Price',
'market.unrealizedPnlDetail': 'Unrealized P&L',
'market.realizedPnlDetail': 'Realized P&L',
'market.totalPnlDetail': 'Total P&L',
'market.portfolioSummary': 'Portfolio Summary',
```

In `src/plugins/i18n/de.ts`, add matching German keys:
```typescript
'market.avgCost': 'Durchschn. Kosten',
'market.totalPnl': 'G&V',
'market.avgCostTooltip': 'Durchschnittliche Kostenbasis in ADA',
'market.totalPnlTooltip': 'Gesamtgewinn/-verlust (realisiert + unrealisiert)',
'market.unrealizedPnl': 'Unrealisiert',
'market.realizedPnl': 'Realisiert',
'market.overview': 'Ubersicht',
'market.trading': 'Handel',
'market.orderBook': 'Orderbuch',
'market.crossDex': 'DEX-Preisvergleich',
'market.depthChart': 'Tiefe',
'market.bestPrice': 'Bester Preis',
'market.pnl': 'G&V',
'market.avgCostBasis': 'Durchschn. Kostenbasis',
'market.currentPrice': 'Aktueller Preis',
'market.unrealizedPnlDetail': 'Unrealisierter G&V',
'market.realizedPnlDetail': 'Realisierter G&V',
'market.totalPnlDetail': 'Gesamt G&V',
'market.portfolioSummary': 'Portfolio-Ubersicht',
```

**Step 2: Update Market.vue to merge P&L data into myHoldings**

In `src/modules/market/Market.vue`, import and use the P&L composable:

```typescript
import { useWalletPnl } from '@/modules/market/composables/useWalletPnl';

const { fetchPnl, getTokenPnl, getTotalPnl } = useWalletPnl();
```

Call `fetchPnl()` on mount:
```typescript
onMounted(() => {
  document.addEventListener('click', handleOutsideClick);
  fetchPnl();
});
```

Update the `myHoldings` computed to include P&L fields:
```typescript
const myHoldings = computed(() => {
  const holdings = userTokens.value || {};
  return allTokens.value
    .filter(tok => {
      const unit = tok.unit;
      if (unit === 'lovelace') return true;
      return !!holdings[unit];
    })
    .map(tok => {
      const unit = tok.unit;
      const held = holdings[unit];
      const pnl = getTokenPnl(unit);
      const result: MarketToken = { ...tok };

      if (held) {
        result.balance = held.quantity ? Number(held.quantity) / Math.pow(10, held.decimals || 0) : 0;
        result.value = result.balance ? result.balance * tok.price : 0;
      }

      if (pnl) {
        result.avgCostBasis = pnl.avgCostBasisAda;
        result.totalPnl = pnl.realizedPnlAda + pnl.unrealizedPnlAda;
        result.realizedPnl = pnl.realizedPnlAda;
        result.unrealizedPnl = pnl.unrealizedPnlAda;
      }

      return result;
    });
});
```

**Step 3: Add columns to MarketTokenTable.vue**

In the `baseHeaders` computed, add after the `value` column (inside the `if (props.showHoldingsColumns)` block):

```typescript
if (props.showHoldingsColumns) {
  headers.push(
    { text: t('market.balance'), value: 'balance', sortable: true, width: '80px' },
    { text: t('market.value'), value: 'value', sortable: true, width: '80px' },
    { text: t('market.avgCost'), value: 'avgCostBasis', sortable: true, width: '80px', class: 'hidden-md-and-down' },
    { text: t('market.totalPnl'), value: 'totalPnl', sortable: true, width: '90px' },
  );
}
```

Add column templates:

```vue
<!-- Avg Cost column -->
<template v-slot:[`item.avgCostBasis`]="{ item }">
  <span style="font-size: 12px">
    {{ item.avgCostBasis != null ? item.avgCostBasis.toFixed(item.avgCostBasis < 1 ? 4 : 2) + ' A' : '-' }}
  </span>
</template>

<!-- Total P&L column -->
<template v-slot:[`item.totalPnl`]="{ item }">
  <v-tooltip top :open-delay="300" content-class="custom-tooltip" v-if="item.totalPnl != null">
    <template v-slot:activator="{ on, attrs }">
      <span
        v-bind="attrs"
        v-on="on"
        :style="{ color: pnlColor(item.totalPnl), fontSize: '12px', fontWeight: '500' }"
      >
        <v-avatar tile size="10" class="mr-1">
          <v-img :src="changeIcon(item.totalPnl)" alt="pnl" />
        </v-avatar>
        {{ item.totalPnl >= 0 ? '+' : '' }}{{ formatCompact(item.totalPnl) }} A
      </span>
    </template>
    <div>
      <div>{{ $t('market.unrealizedPnl') }}: {{ item.unrealizedPnl != null ? (item.unrealizedPnl >= 0 ? '+' : '') + item.unrealizedPnl.toFixed(2) + ' A' : '-' }}</div>
      <div>{{ $t('market.realizedPnl') }}: {{ item.realizedPnl != null ? (item.realizedPnl >= 0 ? '+' : '') + item.realizedPnl.toFixed(2) + ' A' : '-' }}</div>
    </div>
  </v-tooltip>
  <span v-else style="font-size: 12px">-</span>
</template>

<!-- Header tooltip for Avg Cost -->
<template v-slot:[`header.avgCostBasis`]="{ header }">
  <v-tooltip top :open-delay="300" content-class="custom-tooltip">
    <template v-slot:activator="{ on, attrs }">
      <span v-bind="attrs" v-on="on">{{ header.text }}</span>
    </template>
    {{ $t('market.avgCostTooltip') }}
  </v-tooltip>
</template>

<!-- Header tooltip for Total P&L -->
<template v-slot:[`header.totalPnl`]="{ header }">
  <v-tooltip top :open-delay="300" content-class="custom-tooltip">
    <template v-slot:activator="{ on, attrs }">
      <span v-bind="attrs" v-on="on">{{ header.text }}</span>
    </template>
    {{ $t('market.totalPnlTooltip') }}
  </v-tooltip>
</template>
```

Add the `pnlColor` helper in the script:

```typescript
function pnlColor(pnl: number): string {
  if (pnl === 0) return '#A3A3A3';
  return pnl > 0 ? '#47CD89' : '#F97066';
}
```

**Step 4: Verify**

Run: `npm run typecheck`

**Step 5: Commit**

```bash
git add src/modules/market/components/MarketTokenTable.vue src/modules/market/Market.vue src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(market): add P&L columns to My Holdings table"
```

---

## Task 5: Add Sub-Tabs to TokenDetailPanel (Overview + Trading)

**Files:**
- Modify: `src/modules/market/components/TokenDetailPanel.vue`
- Create: `src/modules/market/components/DepthChart.vue`
- Create: `src/modules/market/components/CrossDexPrices.vue`

**Context:** The chart + timeframes + indicators stay pinned at the top. Below the chart, add two sub-tabs: "Overview" (current stats table + P&L detail) and "Trading" (Depth chart + Cross-DEX prices). The current stats table moves into the Overview tab.

**Step 1: Create DepthChart component**

Create `src/modules/market/components/DepthChart.vue`:

```vue
<template>
  <div class="depth-chart-container">
    <div class="d-flex align-center justify-space-between mb-2">
      <span class="text-caption text--secondary">{{ $t('market.depthChart') }}</span>
      <v-btn-toggle v-model="depthSource" dense mandatory class="depth-toggle">
        <v-btn x-small value="simulated">AMM</v-btn>
        <v-btn x-small value="real">Orders</v-btn>
      </v-btn-toggle>
    </div>
    <div v-if="loading" class="d-flex justify-center py-6">
      <v-progress-circular indeterminate size="24" color="primary" />
    </div>
    <div v-else-if="!orderBook" class="text-center py-6 text--secondary text-caption">
      {{ $t('market.na') }}
    </div>
    <div v-else ref="chartEl" class="depth-area" style="height: 180px"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { createChart, AreaSeries, type IChartApi, type SolidColor } from 'lightweight-charts';
import marketApi, { type OrderBook } from '@/api/market-api';

const props = defineProps<{
  policyId: string;
  assetName: string;
}>();

const depthSource = ref('simulated');
const orderBook = ref<OrderBook | null>(null);
const loading = ref(false);
const chartEl = ref<HTMLElement>();
let chart: IChartApi | null = null;

async function loadOrderBook() {
  loading.value = true;
  try {
    // First get pools for this token
    const pools = await marketApi.getPoolsByToken(props.policyId, props.assetName);
    if (!pools.length) { orderBook.value = null; return; }

    // Use the highest TVL pool
    const topPool = pools.sort((a, b) => (b.tvlAda || 0) - (a.tvlAda || 0))[0];

    const fetcher = depthSource.value === 'real'
      ? marketApi.getOrderBook
      : marketApi.getSimulatedOrderBook;
    orderBook.value = await fetcher(topPool.poolId, 20);

    await nextTick();
    renderChart();
  } catch {
    orderBook.value = null;
  } finally {
    loading.value = false;
  }
}

function renderChart() {
  if (!chartEl.value || !orderBook.value) return;
  if (chart) { try { chart.remove(); } catch { /* */ } chart = null; }

  const ob = orderBook.value;
  chart = createChart(chartEl.value, {
    width: chartEl.value.clientWidth,
    height: 180,
    layout: { attributionLogo: false, background: { type: 'solid', color: 'transparent' } as SolidColor, textColor: '#D1D4DC' },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(197,203,206,0.07)' } },
    rightPriceScale: { borderColor: 'rgba(197,203,206,0.2)' },
    timeScale: { visible: false },
    crosshair: { mode: 0 },
  });

  // Bids (green, left side)
  const bidSeries = chart.addSeries(AreaSeries, {
    lineColor: '#26FAB0',
    topColor: 'rgba(38,250,176,0.3)',
    bottomColor: 'rgba(38,250,176,0.02)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  // Asks (red, right side)
  const askSeries = chart.addSeries(AreaSeries, {
    lineColor: '#FF5252',
    topColor: 'rgba(255,82,82,0.3)',
    bottomColor: 'rgba(255,82,82,0.02)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  // Convert to cumulative depth
  const bids = [...ob.bids].sort((a, b) => b.price - a.price);
  const asks = [...ob.asks].sort((a, b) => a.price - b.price);

  let cumBid = 0;
  const bidData = bids.map((b, i) => { cumBid += b.size; return { time: i as any, value: cumBid }; });

  let cumAsk = 0;
  const askData = asks.map((a, i) => { cumAsk += a.size; return { time: (bids.length + i) as any, value: cumAsk }; });

  bidSeries.setData(bidData);
  askSeries.setData(askData);
}

watch([() => props.policyId, () => props.assetName], () => loadOrderBook());
watch(depthSource, () => loadOrderBook());

onMounted(() => loadOrderBook());
onBeforeUnmount(() => { if (chart) { try { chart.remove(); } catch { /* */ } } });
</script>

<style scoped>
.depth-chart-container {
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 12px;
}
.depth-area { border-radius: 6px; overflow: hidden; }
.depth-toggle { background: rgba(255,255,255,0.04) !important; }
.depth-toggle >>> .v-btn { font-size: 10px !important; text-transform: none !important; letter-spacing: 0; }
</style>
```

**Step 2: Create CrossDexPrices component**

Create `src/modules/market/components/CrossDexPrices.vue`:

```vue
<template>
  <div class="cross-dex-container">
    <span class="text-caption text--secondary mb-2 d-block">{{ $t('market.crossDex') }}</span>
    <div v-if="loading" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="24" color="primary" />
    </div>
    <v-simple-table v-else-if="prices.length" dense class="transparent dex-table">
      <thead>
        <tr>
          <th style="font-size: 11px">DEX</th>
          <th class="text-right" style="font-size: 11px">{{ $t('market.price') }} (ADA)</th>
          <th class="text-right" style="font-size: 11px">{{ $t('market.price') }} (USD)</th>
          <th class="text-right" style="font-size: 11px">{{ $t('market.volume24h') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in prices" :key="p.dex" :class="{ 'best-price': p.isBest }">
          <td style="font-size: 12px">
            {{ formatDexName(p.dex) }}
            <v-chip v-if="p.isBest" x-small color="primary" class="ml-1">{{ $t('market.bestPrice') }}</v-chip>
          </td>
          <td class="text-right" style="font-size: 12px">{{ p.priceAda.toFixed(p.priceAda < 1 ? 6 : 2) }}</td>
          <td class="text-right" style="font-size: 12px">${{ p.priceUsd.toFixed(p.priceUsd < 1 ? 6 : 4) }}</td>
          <td class="text-right" style="font-size: 12px">${{ formatCompact(p.volume24h) }}</td>
        </tr>
      </tbody>
    </v-simple-table>
    <div v-else class="text-center py-4 text--secondary text-caption">{{ $t('market.na') }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import marketApi, { type TokenPriceResponse } from '@/api/market-api';

const props = defineProps<{ assetId: string }>();

interface DexPrice extends TokenPriceResponse { isBest: boolean; }
const prices = ref<DexPrice[]>([]);
const loading = ref(false);

async function loadPrices() {
  if (!props.assetId || props.assetId === 'lovelace') { prices.value = []; return; }
  loading.value = true;
  try {
    const raw = await marketApi.getTokenPricesAcrossDexes(props.assetId);
    const bestPrice = Math.max(...raw.map(p => p.priceUsd));
    prices.value = raw
      .sort((a, b) => b.priceUsd - a.priceUsd)
      .map(p => ({ ...p, isBest: p.priceUsd === bestPrice }));
  } catch {
    prices.value = [];
  } finally {
    loading.value = false;
  }
}

function formatDexName(dex: string): string {
  return dex.replace(/_/g, ' ').replace(/V(\d)/g, ' v$1').replace(/\b\w/g, l => l.toUpperCase());
}

function formatCompact(value: number): string {
  if (value >= 1e9) return (value / 1e9).toFixed(1) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toFixed(0);
}

watch(() => props.assetId, () => loadPrices());
onMounted(() => loadPrices());
</script>

<style scoped>
.cross-dex-container {
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 12px;
}
.dex-table >>> td, .dex-table >>> th {
  border-bottom: 1px solid rgba(255,255,255,0.04) !important;
  padding: 6px 8px !important;
}
.dex-table >>> tr:last-child td { border-bottom: none !important; }
.best-price { background: rgba(38,250,176,0.04); }
</style>
```

**Step 3: Add sub-tabs to TokenDetailPanel.vue**

In `src/modules/market/components/TokenDetailPanel.vue`, restructure the panel-scroll content area. The chart section stays as-is. Below the chart, add:

```vue
<!-- Sub-tabs (below chart) -->
<div class="px-4 pb-2">
  <v-tabs v-model="activeSubTab" dense background-color="transparent" height="28" class="detail-sub-tabs">
    <v-tab>{{ $t('market.overview') }}</v-tab>
    <v-tab>{{ $t('market.trading') }}</v-tab>
  </v-tabs>
</div>

<!-- Overview tab content -->
<template v-if="activeSubTab === 0">
  <!-- P&L Section (if user holds this token) -->
  <div v-if="tokenPnl" class="px-4 pb-2">
    <v-simple-table dense class="transparent stats-table">
      <tbody>
        <tr>
          <td class="text--secondary" style="width: 40%; font-size: 12px; padding: 4px 8px">{{ $t('market.avgCostBasis') }}</td>
          <td class="text-right" style="font-size: 12px; padding: 4px 8px">{{ tokenPnl.avgCostBasisAda.toFixed(tokenPnl.avgCostBasisAda < 1 ? 6 : 2) }} A</td>
        </tr>
        <tr>
          <td class="text--secondary" style="width: 40%; font-size: 12px; padding: 4px 8px">{{ $t('market.unrealizedPnlDetail') }}</td>
          <td class="text-right" :style="{ fontSize: '12px', padding: '4px 8px', color: tokenPnl.unrealizedPnlAda >= 0 ? '#47CD89' : '#F97066' }">
            {{ tokenPnl.unrealizedPnlAda >= 0 ? '+' : '' }}{{ tokenPnl.unrealizedPnlAda.toFixed(2) }} A
          </td>
        </tr>
        <tr>
          <td class="text--secondary" style="width: 40%; font-size: 12px; padding: 4px 8px">{{ $t('market.realizedPnlDetail') }}</td>
          <td class="text-right" :style="{ fontSize: '12px', padding: '4px 8px', color: tokenPnl.realizedPnlAda >= 0 ? '#47CD89' : '#F97066' }">
            {{ tokenPnl.realizedPnlAda >= 0 ? '+' : '' }}{{ tokenPnl.realizedPnlAda.toFixed(2) }} A
          </td>
        </tr>
        <tr>
          <td class="text--secondary" style="width: 40%; font-size: 12px; padding: 4px 8px; font-weight: 600">{{ $t('market.totalPnlDetail') }}</td>
          <td class="text-right" :style="{ fontSize: '12px', padding: '4px 8px', fontWeight: '600', color: totalPnl >= 0 ? '#47CD89' : '#F97066' }">
            {{ totalPnl >= 0 ? '+' : '' }}{{ totalPnl.toFixed(2) }} A
          </td>
        </tr>
      </tbody>
    </v-simple-table>
  </div>

  <!-- Existing stats table -->
  <div class="px-4 pb-2">
    <!-- ... keep existing stats v-simple-table as-is ... -->
  </div>
</template>

<!-- Trading tab content -->
<template v-if="activeSubTab === 1">
  <div class="px-4 pb-2" style="display: flex; flex-direction: column; gap: 12px">
    <DepthChart
      v-if="tokenPolicyId && tokenAssetName"
      :policy-id="tokenPolicyId"
      :asset-name="tokenAssetName"
    />
    <CrossDexPrices :asset-id="token.unit" />
  </div>
</template>
```

Add to the script:
```typescript
import DepthChart from './DepthChart.vue';
import CrossDexPrices from './CrossDexPrices.vue';
import { useWalletPnl } from '@/modules/market/composables/useWalletPnl';

const { getTokenPnl } = useWalletPnl();
const activeSubTab = ref(0);

const tokenPnl = computed(() => getTokenPnl(props.token.unit));
const totalPnl = computed(() => {
  const p = tokenPnl.value;
  return p ? p.realizedPnlAda + p.unrealizedPnlAda : 0;
});

// Extract policyId and assetName from unit (format: policyId + assetNameHex)
const tokenPolicyId = computed(() => {
  if (props.token.unit === 'lovelace') return '';
  return props.token.unit.substring(0, 56);
});
const tokenAssetName = computed(() => {
  if (props.token.unit === 'lovelace') return '';
  return props.token.unit.substring(56);
});
```

Add scoped styles for the sub-tabs:
```css
.detail-sub-tabs >>> .v-tab {
  text-transform: none !important;
  font-size: 12px;
  min-width: unset;
  padding: 0 10px;
  letter-spacing: 0;
}
.detail-sub-tabs >>> .v-tabs-slider {
  height: 2px;
}
```

**Step 4: Verify**

Run: `npm run typecheck`

**Step 5: Commit**

```bash
git add src/modules/market/components/TokenDetailPanel.vue src/modules/market/components/DepthChart.vue src/modules/market/components/CrossDexPrices.vue
git commit -m "feat(market): add Overview/Trading sub-tabs with P&L, depth chart, cross-DEX prices"
```

---

## Task 6: Add P&L Summary to Dashboard Portfolio Card

**Files:**
- Modify: `src/modules/dashboard/components/PortfolioChart.vue`
- Modify: `src/modules/dashboard/views/Dashboard.vue`

**Context:** The PortfolioChart component shows portfolio balance (ADA/USD/EUR), wallet address, and chart data. Add a row below the existing balance display showing aggregate P&L from the wallet P&L endpoint. The data is fetched in Dashboard.vue and passed as props.

**Step 1: Add P&L props to PortfolioChart.vue**

Add new props:
```typescript
totalRealizedPnl: { type: Number, default: null },
totalUnrealizedPnl: { type: Number, default: null },
```

Add a row below the existing portfolio value display (after the balance, before the chart):
```vue
<div v-if="totalRealizedPnl != null || totalUnrealizedPnl != null" class="d-flex align-center px-4 pb-2" style="gap: 16px">
  <div class="pnl-item">
    <span class="text-caption text--secondary">{{ $t('market.unrealizedPnlDetail') }}</span>
    <span
      class="text-body-2 font-weight-medium"
      :style="{ color: (totalUnrealizedPnl || 0) >= 0 ? '#47CD89' : '#F97066' }"
    >
      {{ (totalUnrealizedPnl || 0) >= 0 ? '+' : '' }}{{ formatPnl(totalUnrealizedPnl || 0) }} A
    </span>
  </div>
  <div class="pnl-item">
    <span class="text-caption text--secondary">{{ $t('market.realizedPnlDetail') }}</span>
    <span
      class="text-body-2 font-weight-medium"
      :style="{ color: (totalRealizedPnl || 0) >= 0 ? '#47CD89' : '#F97066' }"
    >
      {{ (totalRealizedPnl || 0) >= 0 ? '+' : '' }}{{ formatPnl(totalRealizedPnl || 0) }} A
    </span>
  </div>
</div>
```

Add the format helper:
```typescript
function formatPnl(value: number): string {
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toFixed(2);
}
```

Add scoped style:
```css
.pnl-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
```

**Step 2: Fetch P&L in Dashboard.vue and pass as props**

In `src/modules/dashboard/views/Dashboard.vue`, import and use the P&L composable:

```typescript
import { useWalletPnl } from '@/modules/market/composables/useWalletPnl';

const { pnlSummary, fetchPnl } = useWalletPnl();
```

Call `fetchPnl()` on mount (or in the existing initialization flow).

Pass to PortfolioChart:
```vue
<PortfolioChart
  ... existing props ...
  :total-realized-pnl="pnlSummary?.totalRealizedPnlAda"
  :total-unrealized-pnl="pnlSummary?.totalUnrealizedPnlAda"
/>
```

**Step 3: Verify**

Run: `npm run typecheck`

**Step 4: Commit**

```bash
git add src/modules/dashboard/components/PortfolioChart.vue src/modules/dashboard/views/Dashboard.vue
git commit -m "feat(dashboard): add P&L summary to portfolio card"
```

---

## Task 7: Final Integration and Cleanup

**Files:**
- Modify: `src/modules/market/composables/useMarketData.ts` (remove any leftover mock references)
- Verify: all components render correctly

**Step 1: Remove mock data artifacts**

Ensure `useMarketData.ts` has no references to `MOCK_TOKENS`, `generateCandles`, or `TIMEFRAME_CONFIG` for mock generation. These should all have been removed in Task 2.

**Step 2: Verify the complete flow**

Run: `npm run typecheck`
Run: `npm run build`

Confirm no build errors.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(market): complete live market data integration with P&L and trading views"
```

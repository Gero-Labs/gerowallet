import { ref, computed, watch, onUnmounted, getCurrentInstance, type Ref, type ComputedRef, type WatchStopHandle } from 'vue';
import marketApi, { type TokenPriceResponse, type CandleResponse } from '@/api/market-api';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { xerberusStore } from '@/stores/xerberusStore';
import { walletStore } from '@/stores/walletStore';
import { coinGeckoStore } from '@/stores/coinGeckoStore';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { applyTokenImageOverride } from '@/shared/utils/resolver';

export interface MarketToken {
  unit: string;
  name: string;
  ticker: string;
  img: string;
  verified: boolean;
  price: number;
  priceAda: number;
  priceEur: number;
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
  decimals: number;
  description?: string;
  // Populated when cross-referencing with wallet holdings
  balance?: number;
  value?: number;
  allocation?: number;
  // Additional fields from API
  organicVolume24h?: number;
  dex?: string;
  avgCostBasis?: number | null;
  totalPnl?: number | null;
  realizedPnl?: number | null;
  unrealizedPnl?: number | null;
  isNative?: boolean;
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
  priceEur: number;
  priceChange24h: number;
  marketCap: number;
  volume24h: number;
}

// --- Singleton state (shared across all component instances) ---

const allTokens: Ref<MarketToken[]> = ref([]);
const adaData: Ref<AdaMarketData | null> = ref(null);
const loading = ref(false);
const error: Ref<string | null> = ref(null);

let initialized = false;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// Module-level EUR rate for Apex price conversion
const { usdToEurRate: _usdToEurRate, loadExchangeRate: _loadExchangeRate } = useCurrencyConverter();
_loadExchangeRate();
let consumerCount = 0;

// --- Helper: enrich API data with store data (DexHunter as fallback) ---

function enrichWithStores(apiToken: TokenPriceResponse): MarketToken {
  const assetId = apiToken.assetId;

  // DexHunter data as fallback for fields the backend doesn't yet provide
  const dhToken = (dexHunterStore.dexHunterTokens as Record<string, any>)[assetId];

  // Fingerprint: prefer API, fallback to DexHunter
  const fingerprint = apiToken.fingerprint || dhToken?.fingerprint || '';

  // Xerberus risk by fingerprint
  const xerberusRisk = fingerprint
    ? (xerberusStore.risks as Record<string, any>)[fingerprint]
    : null;

  return {
    unit: assetId,
    name: apiToken.name || dhToken?.name || apiToken.assetNameAscii || assetId,
    ticker: apiToken.ticker || dhToken?.ticker || apiToken.assetNameAscii || '',
    img: apiToken.logo || '',
    verified: apiToken.verified ?? dhToken?.verified ?? false,
    price: apiToken.priceUsd,
    priceAda: apiToken.priceAda,
    priceEur: apiToken.priceEur ?? 0,
    change1h: apiToken.priceChange1h ?? 0,
    change24h: apiToken.priceChange24h ?? 0,
    change7d: apiToken.priceChange7d ?? 0,
    volume24h: apiToken.volume24h ?? 0,
    mcap: apiToken.marketCap ?? dhToken?.mcap ?? 0,
    tvl: apiToken.tvl ?? null,
    liquidity: apiToken.liquidity ?? 0,
    holders: apiToken.holders ?? dhToken?.holders ?? 0,
    riskRating: xerberusRisk?.risk || null,
    isNew: apiToken.isNew ?? false,
    policyLocked: false, // TODO: get from API — default false until backend provides minting policy status
    fingerprint,
    decimals: apiToken.decimals ?? dhToken?.decimals ?? 0,
    organicVolume24h: apiToken.organicVolume24h ?? 0,
    dex: apiToken.dex ?? undefined,
  };
}

// --- Fetch all tokens ---

async function fetchAllTokens(silent = false): Promise<void> {
  if (!silent) loading.value = true;
  error.value = null;

  try {
    const chain = walletStore.loggedWallet?.chain;
    const isApex = chain === Blockchain.APEX_PRIME || chain === Blockchain.APEX_VECTOR;

    // For Apex wallets, use CoinGecko apex-4 data; for Cardano, use market API
    let nativePrice: { priceUsd: number; priceEur: number; priceChange24h: number; marketCap: number; volume24h: number };

    if (isApex) {
      const apexData = coinGeckoStore.cache['apex-4'];
      nativePrice = {
        priceUsd: apexData?.usd ?? 0,
        priceEur: (apexData?.usd ?? 0) * (_usdToEurRate.value || 1),
        priceChange24h: apexData?.usd_24h_change ?? 0,
        marketCap: apexData?.usd_market_cap ?? 0,
        volume24h: apexData?.usd_24h_vol ?? 0,
      };
    } else {
      const adaPrice = await marketApi.getAdaPrice();
      nativePrice = {
        priceUsd: adaPrice.priceUsd,
        priceEur: adaPrice.priceEur ?? 0,
        priceChange24h: adaPrice.priceChange24h ?? 0,
        marketCap: adaPrice.marketCap ?? 0,
        volume24h: adaPrice.volume24h ?? 0,
      };
    }

    // Apex wallets don't have market API token listings — only show native token
    const allPrices = isApex ? [] : await marketApi.getAllPrices();

    // Map API tokens through enrichment (backend already aggregates per token)
    const tokens: MarketToken[] = allPrices.map(tp => enrichWithStores(tp));

    // Build native token (ADA / AP3X) at position 0
    const nativeName = networks.resolveCurrencyName(chain, walletStore.loggedWallet?.network) || 'Cardano';
    const nativeTicker = networks.resolveCurrencyTicker(chain, walletStore.loggedWallet?.network) || 'ADA';
    const nativeImg = networks.resolveCurrencyImage(chain, walletStore.loggedWallet?.network) || '';
    const nativeToken: MarketToken = {
      unit: 'lovelace',
      name: nativeName,
      ticker: nativeTicker,
      img: nativeImg,
      verified: true,
      price: nativePrice.priceUsd,
      priceAda: 1,
      priceEur: nativePrice.priceEur,
      change1h: 0,
      change24h: nativePrice.priceChange24h,
      change7d: 0,
      volume24h: nativePrice.volume24h,
      mcap: nativePrice.marketCap,
      tvl: null,
      liquidity: 0,
      holders: 0,
      riskRating: 'AAA',
      isNew: false,
      policyLocked: true,
      fingerprint: '',
      decimals: 6,
      isNative: true,
    };

    // Remove any existing lovelace entry, then prepend native token
    const filtered = tokens.filter(t => t.unit !== 'lovelace');
    allTokens.value = [nativeToken, ...filtered];

    // Set adaData ref (used for native currency price display)
    adaData.value = {
      priceUsd: nativePrice.priceUsd,
      priceEur: nativePrice.priceEur,
      priceChange24h: nativePrice.priceChange24h,
      marketCap: nativePrice.marketCap,
      volume24h: nativePrice.volume24h,
    };
  } catch (e: any) {
    console.error('Market: Failed to fetch tokens', e);
    error.value = e?.message || 'Failed to load market data';
  } finally {
    loading.value = false;
  }
}

// --- Candles (async) ---

/** Lookback durations per timeframe */
const TIMEFRAME_LOOKBACK: Record<string, number> = {
  '15m': 2 * 86400_000,
  '1h': 7 * 86400_000,
  '1d': 90 * 86400_000,
  '1w': 365 * 86400_000,
};

/** Bucket size in seconds per timeframe (for grouping price history into candles) */
const TIMEFRAME_BUCKET: Record<string, number> = {
  '15m': 15 * 60,
  '1h': 3600,
  '1d': 86400,
  '1w': 7 * 86400,
};

/**
 * Build OHLCV candles from raw price history snapshots.
 * Groups data points into time buckets matching the requested timeframe.
 * @param history
 * @param timeframe
 * @param priceField - which price field to use ('priceAda' or 'priceUsd')
 */
function buildCandlesFromHistory(
  history: { priceAda: number; priceUsd: number; volume: number; timestamp: string }[],
  timeframe: string,
  priceField: 'priceAda' | 'priceUsd' = 'priceAda',
): CandlestickDataPoint[] {
  const bucketSize = TIMEFRAME_BUCKET[timeframe] || 3600;
  const buckets = new Map<number, { open: number; high: number; low: number; close: number; volume: number; firstTime: number; lastTime: number }>();

  for (const h of history) {
    const price = h[priceField];
    if (!price || price <= 0) continue;
    const ts = Math.floor(new Date(h.timestamp).getTime() / 1000);
    const bucketKey = Math.floor(ts / bucketSize) * bucketSize;
    const existing = buckets.get(bucketKey);

    if (!existing) {
      buckets.set(bucketKey, {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: h.volume || 0,
        firstTime: ts,
        lastTime: ts,
      });
    } else {
      if (ts < existing.firstTime) {
        existing.open = price;
        existing.firstTime = ts;
      }
      if (ts > existing.lastTime) {
        existing.close = price;
        existing.lastTime = ts;
      }
      if (price > existing.high) existing.high = price;
      if (price < existing.low) existing.low = price;
      existing.volume += h.volume || 0;
    }
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([time, b]) => ({
      time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
}

/** Map frontend timeframe values to backend resolution format (1D/1W are uppercase) */
const RESOLUTION_MAP: Record<string, string> = {
  '15m': '15m',
  '1h': '1h',
  '1d': '1D',
  '1w': '1W',
};

async function getTokenCandles(unit: string, timeframe: string, currency?: string): Promise<CandlestickDataPoint[]> {
  const isAda = unit === 'lovelace';
  const assetId = isAda ? 'lovelace' : unit;
  const resolution = RESOLUTION_MAP[timeframe] || timeframe;
  const to = Math.floor(Date.now() / 1000).toString();

  // For non-ADA tokens: don't pass currency to API (data is ADA-denominated by default,
  // USD-converted data stops early). Only ADA uses currency param for USD/EUR pricing.
  const apiCurrency = isAda ? currency : (currency === 'ada' ? undefined : currency);

  // Lookback: fetch candles from a reasonable time ago based on timeframe
  const lookbackSeconds: Record<string, number> = {
    '5m': 2 * 86400,       // 2 days
    '15m': 7 * 86400,      // 1 week
    '1h': 30 * 86400,      // 1 month
    '1d': 365 * 86400,     // 1 year
    '1w': 2 * 365 * 86400, // 2 years
  };
  const from = Math.floor(Date.now() / 1000 - (lookbackSeconds[timeframe] || 365 * 86400));

  try {
    const candles: CandleResponse[] = await marketApi.getCandles(assetId, resolution, from.toString(), to, apiCurrency);
    if (candles.length > 0) {
      return candles
        .filter(c => c.open != null && c.close != null)
        .map(c => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));
    }
  } catch {
    // Candle endpoint failed — fall through to price history
  }

  // Fallback: build candles from price history snapshots
  try {
    const lookback = TIMEFRAME_LOOKBACK[timeframe] || 7 * 86400_000;
    const now = new Date();
    const from = new Date(now.getTime() - lookback).toISOString();
    const toIso = now.toISOString();
    const history = await marketApi.getPriceHistory(assetId, from, toIso);
    if (history.length > 0) {
      // Use priceUsd for USD/EUR, priceAda for ADA (EUR uses USD as base — no native EUR in history)
      const priceField = currency === 'ada' ? 'priceAda' : 'priceUsd';
      console.debug(`📊 Built ${history.length} price points into candles for ${assetId} (${timeframe}, ${currency || 'ada'})`);
      return buildCandlesFromHistory(history, timeframe, priceField);
    }
  } catch (err) {
    console.warn(`Market: Failed to fetch price history for ${unit} (${timeframe})`, err);
  }

  return [];
}

// --- Search & lookup ---

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

/**
 * Resolve a token's logo image from market data (single source of truth), keyed by unit.
 * Falls back to the wallet's chain logo when market data has no logo for the token.
 * Reactive on `allTokens`, so images appear as soon as market data loads.
 * @param token - anything carrying `unit` (and optionally `ticker`/`name` for overrides)
 */
function getTokenImage(token: { unit?: string; ticker?: string; name?: string; img?: string } | null | undefined): string {
  const chainLogo = networks.resolveCurrencyImage(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network) || '';
  const name = token?.ticker || token?.name;
  // Hard overrides win (e.g. NIGHT ships a bundled logo).
  const override = applyTokenImageOverride(name, '');
  if (override) return override;
  const unit = token?.unit;
  // Native token (ADA / AP3X) always uses the bundled chain logo.
  if (!unit || unit === 'lovelace') return chainLogo;
  // Prefer market-data logo; then any image the token already carries
  // (e.g. on-chain metadata resolved for wallet assets in the Send flow); then chain logo.
  return getTokenByUnit(unit)?.img || token?.img || chainLogo;
}

// --- Price polling state ---

// Kept for the portfolio "live data" indicator. The live WebSocket was removed
// in favour of REST polling through the backend Nexus proxy; this now reflects
// whether the most recent price poll succeeded.
const wsConnected = ref(false);

/** Refresh all token prices via the backend proxy and track freshness. */
function pollPrices(silent: boolean): void {
  void fetchAllTokens(silent).finally(() => {
    wsConnected.value = !error.value;
  });
}

// --- Cleanup ---

let chainWatcherStop: WatchStopHandle | null = null;
let coinGeckoWatcherStop: WatchStopHandle | null = null;

function cleanup(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  if (chainWatcherStop) {
    chainWatcherStop();
    chainWatcherStop = null;
  }
  if (coinGeckoWatcherStop) {
    coinGeckoWatcherStop();
    coinGeckoWatcherStop = null;
  }
  initialized = false;
}

// --- Composable ---

export function useMarketData() {
  // Initialize once on first composable call
  if (!initialized) {
    initialized = true;
    pollPrices(false); // initial load
    // Poll prices every 15s while the tab is visible (replaces the live WebSocket).
    refreshInterval = setInterval(() => {
      if (!document.hidden) pollPrices(true);
    }, 15_000);
  }

  // Watch for wallet chain changes — re-fetch data when switching wallets
  if (!chainWatcherStop) {
    chainWatcherStop = watch(() => walletStore.loggedWallet?.chain, () => {
      pollPrices(false);
    });
  }

  // Watch for CoinGecko cache updates — Apex wallets depend on this data arriving async
  if (!coinGeckoWatcherStop) {
    coinGeckoWatcherStop = watch(() => coinGeckoStore.cache, () => {
      const chain = walletStore.loggedWallet?.chain;
      const isApex = chain === Blockchain.APEX_PRIME || chain === Blockchain.APEX_VECTOR;
      if (isApex) fetchAllTokens(true); // Silent — just updating prices
    }, { deep: true });
  }

  // Track consumers to cleanup interval when no components are using it
  consumerCount++;
  if (getCurrentInstance()) {
    onUnmounted(() => {
      consumerCount--;
      if (consumerCount <= 0) {
        cleanup();
      }
    });
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
    getTokenImage,
    getTokenCandles,
    wsConnected,
    fetchAllTokens,
    cleanup,
  };
}

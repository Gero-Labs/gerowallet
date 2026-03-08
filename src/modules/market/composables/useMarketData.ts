import { ref, computed, type Ref, type ComputedRef } from 'vue';
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
  // Populated when cross-referencing with wallet holdings
  balance?: number;
  value?: number;
  // Additional fields from API
  organicVolume24h?: number;
  dex?: string;
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

// --- Singleton state (shared across all component instances) ---

const allTokens: Ref<MarketToken[]> = ref([]);
const adaData: Ref<AdaMarketData | null> = ref(null);
const loading = ref(false);
const error: Ref<string | null> = ref(null);

let initialized = false;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

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
    img: apiToken.logo || dhToken?.img || '',
    verified: apiToken.verified ?? dhToken?.verified ?? false,
    price: apiToken.priceUsd,
    priceAda: apiToken.priceAda,
    change1h: apiToken.priceChange1h ?? 0,
    change24h: apiToken.priceChange24h ?? 0,
    change7d: apiToken.priceChange7d ?? 0,
    volume24h: apiToken.volume24h || 0,
    mcap: apiToken.marketCap ?? dhToken?.mcap ?? 0,
    tvl: apiToken.tvl || null,
    liquidity: apiToken.liquidity ?? 0,
    holders: apiToken.holders ?? dhToken?.holders ?? 0,
    riskRating: xerberusRisk?.risk || null,
    isNew: apiToken.isNew ?? false,
    policyLocked: true,
    fingerprint,
    organicVolume24h: apiToken.organicVolume24h || 0,
    dex: apiToken.dex || undefined,
  };
}

// --- Fetch all tokens ---

async function fetchAllTokens(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const [allPrices, adaPrice] = await Promise.all([
      marketApi.getAllPrices(),
      marketApi.getAdaPrice(),
    ]);

    // Map API tokens through enrichment (backend already aggregates per token)
    const tokens: MarketToken[] = allPrices.map(tp => enrichWithStores(tp));

    // Build ADA token at position 0
    const adaToken: MarketToken = {
      unit: 'lovelace',
      name: 'Cardano',
      ticker: 'ADA',
      img: '',
      verified: true,
      price: adaPrice.priceUsd,
      priceAda: 1,
      change1h: 0,
      change24h: adaPrice.priceChange24h || 0,
      change7d: 0,
      volume24h: adaPrice.volume24h || 0,
      mcap: adaPrice.marketCap || 0,
      tvl: null,
      liquidity: 0,
      holders: 0,
      riskRating: 'AAA',
      isNew: false,
      policyLocked: true,
      fingerprint: '',
    };

    // Remove any existing lovelace entry, then prepend ADA
    const filtered = tokens.filter(t => t.unit !== 'lovelace');
    allTokens.value = [adaToken, ...filtered];

    // Set adaData ref
    adaData.value = {
      priceUsd: adaPrice.priceUsd,
      priceChange24h: adaPrice.priceChange24h || 0,
      marketCap: adaPrice.marketCap || 0,
      volume24h: adaPrice.volume24h || 0,
    };
  } catch (e: any) {
    console.error('Market: Failed to fetch tokens', e);
    error.value = e?.message || 'Failed to load market data';
  } finally {
    loading.value = false;
  }
}

// --- Candles (async) ---

async function getTokenCandles(unit: string, timeframe: string): Promise<CandlestickDataPoint[]> {
  try {
    const assetId = unit === 'lovelace' ? 'lovelace' : unit;
    const candles: CandleResponse[] = await marketApi.getCandles(assetId, timeframe);
    return candles.map(c => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
  } catch {
    console.warn(`Market: Failed to fetch candles for ${unit} (${timeframe})`);
    return [];
  }
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

// --- Cleanup ---

function cleanup(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  initialized = false;
}

// --- Composable ---

export function useMarketData() {
  // Initialize once on first composable call
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

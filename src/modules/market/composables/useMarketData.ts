import { ref, computed, watch, onUnmounted, getCurrentInstance, type Ref, type ComputedRef, type WatchStopHandle } from 'vue';
import marketApi, { type TokenPriceResponse, type CandleResponse } from '@/api/market-api';
import { tokenMetadataStore } from '@/stores/tokenMetadataStore';
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
  change30d?: number;
  volume24h: number;
  volume7d?: number;
  txnCount24h?: number | null;
  makerCount24h?: number | null;
  totalSupply?: number | null;
  sparkline?: number[];
  mcap: number | null;
  tvl: number | null;
  liquidity: number;
  holders: number | null;
  isNew: boolean;
  policyLocked: boolean;
  fingerprint: string;
  decimals: number;
  // True when decimals could not be resolved from registry metadata or any
  // market fallback, so `decimals`/`balance` above fell back to raw units
  // instead of a wrong divided-by-decimals value (issue 1003).
  decimalsUnknown?: boolean;
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
  isSnekFun?: boolean;
  // Visible but not sendable. Carry it wherever isSnekFun travels — missing here
  // means the verified-only filter silently strips the row.
  isProgrammable?: boolean;
  // Stable row identity: a unit can appear twice (spendable + locked), and `unit`
  // alone collides as a v-data-table item-key.
  rowKey?: string;
  // Carried so the programmable exemption cannot override a hide-scam preference.
  isScam?: boolean;
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
// Read-only view of the module-level market cache, for passive watchers (see below).
export const marketTokensRef: Readonly<Ref<MarketToken[]>> = allTokens;
const snekTokens: Ref<MarketToken[]> = ref([]);
const adaData: Ref<AdaMarketData | null> = ref(null);
const loading = ref(false);
const error: Ref<string | null> = ref(null);

let initialized = false;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
// Monotonic id for in-flight fetchAllTokens calls. Polls are fire-and-forget on a
// 15s interval while getAllPrices can now take up to 30s, so calls can overlap and
// resolve out of order — this lets a call bail out of writing shared refs if a newer
// fetch has already started ("last requested wins", not "last resolved wins").
let fetchSeq = 0;

// Module-level EUR rate for Apex price conversion
const { usdToEurRate: _usdToEurRate, loadExchangeRate: _loadExchangeRate } = useCurrencyConverter();
_loadExchangeRate();
let consumerCount = 0;

// --- Helper: enrich API data with store data (DexHunter as fallback) ---

function enrichWithStores(apiToken: TokenPriceResponse, sparklineMap?: Record<string, number[]>): MarketToken {
  const assetId = apiToken.assetId;

  // DexHunter data as fallback for fields the backend doesn't yet provide
  const dhToken = (tokenMetadataStore.tokens as Record<string, {
    fingerprint?: string;
    name?: string;
    ticker?: string;
    verified?: boolean;
    holders?: number | null;
    decimals?: number;
  } | undefined>)[assetId];

  // Fingerprint: prefer API, fallback to DexHunter
  const fingerprint = apiToken.fingerprint || dhToken?.fingerprint || '';

  // Market cap: trust the backend value. The backend already suppresses implausible /
  // placeholder-supply market caps (isPlausibleMarketCapAda) and returns null for them, so
  // we surface that null as-is ('—'). DexHunter is metadata-only — no numeric mcap fallback.
  const mcap = apiToken.marketCap ?? null;

  // Market rows are built from the price feed, which knows nothing about CIP-113. The
  // wallet does: a unit held at the programmable-logic-base address is one Gero refuses
  // to move, so the badge and — more importantly — the swap-widget suppression in
  // TokenDetailPanel have to hold for the row opened from Market too, not just for the
  // holdings rows useHoldingsValuation stamps.
  const isProgrammable = Object.prototype.hasOwnProperty.call(
    walletStore.programmableTokens || {},
    assetId,
  );

  return {
    unit: assetId,
    rowKey: assetId,
    isProgrammable,
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
    change30d: apiToken.priceChange30d ?? 0,
    volume24h: apiToken.volume24h ?? 0,
    volume7d: apiToken.volume7d ?? 0,
    txnCount24h: apiToken.txnCount24h ?? null,
    makerCount24h: apiToken.makerCount24h ?? null,
    totalSupply: apiToken.totalSupply ?? null,
    sparkline: sparklineMap?.[assetId] ?? [],
    mcap,
    tvl: apiToken.tvl ?? null,
    liquidity: apiToken.liquidity ?? 0,
    // The bulk /api/market/prices endpoint does not return a holders count, so
    // this is null (renders "—") unless DexHunter happens to have it. Showing 0
    // would be misleading. (A real count needs the backend to add holders to the
    // bulk endpoint, or proxy /api/dex/tokens/{p}/{n}/holders.)
    holders: apiToken.holders ?? dhToken?.holders ?? null,
    isNew: apiToken.isNew ?? false,
    policyLocked: false, // TODO: get from API — default false until backend provides minting policy status
    fingerprint,
    decimals: apiToken.decimals ?? dhToken?.decimals ?? 0,
    organicVolume24h: apiToken.organicVolume24h ?? 0,
    dex: apiToken.dex ?? undefined,
    // Match both the pre-graduation feed (source 'SNEKFUN') and graduated tokens
    // that have moved to the bulk /prices feed (source 'SNEKFUN_GRADUATE'). Without
    // the prefix match, graduated snek tokens (which are unverified) get stripped by
    // the verified/scam filter and only their stale bonding-curve snapshot survives.
    isSnekFun: String(apiToken.source ?? '').startsWith('SNEKFUN') || apiToken.dex === 'SNEKFUN',
  };
}

// --- Fetch all tokens ---

async function fetchAllTokens(silent = false): Promise<void> {
  // Bitcoin renders its own dashboard (BitcoinPriceChart + bitcoinBalance) and never
  // consumes the Cardano market feed — so don't poll the ADA price / token list /
  // sparklines / snek.fun for a BTC wallet (was firing ~every 15s for nothing).
  if (walletStore.loggedWallet?.chain === Blockchain.BITCOIN) {
    if (!silent) loading.value = false;
    return;
  }
  const seq = ++fetchSeq;
  const isStale = () => seq !== fetchSeq; // a newer fetch superseded this one
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
      // Native ADA price. The backend Nexus market upstream intermittently
      // returns a transient 502/503/504 — a single blip must NOT blank the whole
      // market view for a poll cycle. Degrade to the last-known native price
      // (kept in adaData) and let the next poll refill. Only surface a hard error
      // when we have no cached native price at all (genuine first-load failure).
      try {
        const adaPrice = await marketApi.getAdaPrice();
        nativePrice = {
          priceUsd: adaPrice.priceUsd,
          priceEur: adaPrice.priceEur ?? 0,
          priceChange24h: adaPrice.priceChange24h ?? 0,
          marketCap: adaPrice.marketCap ?? 0,
          volume24h: adaPrice.volume24h ?? 0,
        };
      } catch (e) {
        if (!adaData.value) throw e; // no cached price to fall back on — surface it
        console.debug('Market: ADA price unavailable, reusing last-known native price', e);
        nativePrice = {
          priceUsd: adaData.value.priceUsd,
          priceEur: adaData.value.priceEur,
          priceChange24h: adaData.value.priceChange24h,
          marketCap: adaData.value.marketCap ?? 0,
          volume24h: adaData.value.volume24h ?? 0,
        };
      }
    }

    // Full token list is best-effort. Apex has no listing; for Cardano the
    // /api/market/prices aggregate is large and slow (7-15s) — a timeout or error
    // here must NOT blank the native token or trip the whole fetch. Degrade to
    // native-only; the next poll refills the list. (Native price is fetched above.)
    let allPrices: Awaited<ReturnType<typeof marketApi.getAllPrices>> = [];
    if (!isApex) {
      try {
        allPrices = await marketApi.getAllPrices();
      } catch (e) {
        console.debug('Market: token list unavailable (prices endpoint slow/unreachable)', e);
      }
    }

    // 7D sparklines (best-effort — failure must not block the table)
    let sparklineMap: Record<string, number[]> = {};
    if (!isApex) {
      try {
        const resp = await marketApi.getSparklines('7d');
        sparklineMap = resp?.data ?? {};
      } catch (e) {
        console.debug('Market: sparklines unavailable', e);
      }
    }

    // Map API tokens through enrichment (backend already aggregates per token)
    const tokens: MarketToken[] = allPrices.map(tp => enrichWithStores(tp, sparklineMap));

    // Build native token (ADA / AP3X) at position 0
    const nativeName = networks.resolveCurrencyName(chain, walletStore.loggedWallet?.network) || 'Cardano';
    const nativeTicker = networks.resolveCurrencyTicker(chain, walletStore.loggedWallet?.network) || 'ADA';
    const nativeImg = networks.resolveCurrencyImage(chain, walletStore.loggedWallet?.network) || '';
    const nativeToken: MarketToken = {
      unit: 'lovelace',
      rowKey: 'lovelace',
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
      change30d: 0,
      volume24h: nativePrice.volume24h,
      volume7d: 0,
      txnCount24h: null,
      makerCount24h: null,
      totalSupply: null,
      sparkline: [],
      mcap: nativePrice.marketCap,
      tvl: null,
      liquidity: 0,
      holders: null,
      isNew: false,
      policyLocked: true,
      fingerprint: '',
      decimals: 6,
      isNative: true,
    };

    // A newer fetch started while this one was awaiting — drop these results so we
    // don't clobber fresher data with a slow, stale response.
    if (isStale()) return;

    // Remove any existing lovelace entry, then prepend native token
    const filtered = tokens.filter(t => t.unit !== 'lovelace');
    allTokens.value = [nativeToken, ...filtered];

    // snek.fun bonding-curve tokens (separate list, shown under the snek.fun
    // filter). Fire-and-forget so it never blocks the main table.
    if (!isApex) {
      marketApi.getSnekFunTokens()
        .then(snekRaw => {
          // Graduated snek tokens (source SNEKFUN_GRADUATE) already appear in the
          // bulk /prices feed above with RICHER data (real price, changes, volume,
          // txns). Keep only the snek-feed tokens NOT already in the bulk feed
          // (pre-graduation bonding-curve tokens) so we never surface the partial
          // snek snapshot in place of the rich one. Pass sparklineMap so these get
          // mini-charts too.
          const existing = new Set(allTokens.value.map(t => t.unit));
          snekTokens.value = (snekRaw || [])
            .map(tp => enrichWithStores(tp, sparklineMap))
            .filter(t => !existing.has(t.unit));
        })
        .catch(() => { /* snek feed is optional — ignore failures */ });
    }

    // Set adaData ref (used for native currency price display)
    adaData.value = {
      priceUsd: nativePrice.priceUsd,
      priceEur: nativePrice.priceEur,
      priceChange24h: nativePrice.priceChange24h,
      marketCap: nativePrice.marketCap,
      volume24h: nativePrice.volume24h,
    };
  } catch (e) {
    // Don't let a stale/superseded call surface its error over a newer fetch.
    if (!isStale()) {
      console.error('Market: Failed to fetch tokens', e);
      error.value = (e instanceof Error ? e.message : '') || 'Failed to load market data';
    }
  } finally {
    // Only the latest in-flight call owns the loading flag.
    if (!isStale()) loading.value = false;
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

// Exported at module scope so consumers (e.g. the embedded swap widget's token
// resolver/catalog) can read the market cache PASSIVELY — without calling
// useMarketData(), which would register a poll consumer and start the 15s
// interval. These read the shared `allTokens` ref with no side effects; they
// return empty/undefined until some active useMarketData() consumer fills it.
export function getTokenByUnit(unit: string): MarketToken | undefined {
  return allTokens.value.find(t => t.unit === unit);
}

/**
 * Resolve a token's logo image from market data (single source of truth), keyed by unit.
 * Falls back to the wallet's chain logo when market data has no logo for the token.
 * Reactive on `allTokens`, so images appear as soon as market data loads.
 * @param token - anything carrying `unit` (and optionally `ticker`/`name` for overrides)
 */
export function getTokenImage(token: { unit?: string; ticker?: string; name?: string; img?: string } | null | undefined): string {
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
    snekTokens,
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

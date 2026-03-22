import { ref, computed, watch, onUnmounted, getCurrentInstance, type Ref, type ComputedRef, type WatchStopHandle } from 'vue';
import marketApi, { type TokenPriceResponse, type CandleResponse } from '@/api/market-api';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { xerberusStore } from '@/stores/xerberusStore';
import { walletStore } from '@/stores/walletStore';
import { coinGeckoStore } from '@/stores/coinGeckoStore';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';

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
    img: apiToken.logo || dhToken?.img || '',
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
    policyLocked: true, // TODO: get from API — hardcoded until backend provides minting policy status
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
        priceEur: apexData?.usd ?? 0, // CoinGecko only fetches USD; EUR not available
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
  const assetId = unit === 'lovelace' ? 'lovelace' : unit;
  const resolution = RESOLUTION_MAP[timeframe] || timeframe;
  const to = Math.floor(Date.now() / 1000).toString();

  // Try candle endpoint first (from=0 fetches all available data, matching chart.html)
  try {
    const candles: CandleResponse[] = await marketApi.getCandles(assetId, resolution, '0', to, currency);
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

// --- Live price streaming via SockJS XHR + STOMP ---
// WebSocket upgrade is blocked by Cloudflare from extension origin,
// so we use SockJS XHR streaming transport (HTTP-based, works everywhere).

const MARKET_API_BASE = import.meta.env['VITE_MARKET_API_URL'] || 'https://market.gerowallet.io';
const STOMP_TOPIC = '/topic/market/prices';

let xhrStream: XMLHttpRequest | null = null;
let xhrSendUrl = '';
let streamReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const wsConnected = ref(false);
let renderPending = false;

/** Build a token index for O(1) lookups */
function buildTokenIndex(): Record<string, number> {
  const index: Record<string, number> = {};
  allTokens.value.forEach((t, i) => { index[t.unit] = i; });
  return index;
}

/** Merge incoming price updates into existing tokens silently */
function mergePriceUpdates(updates: any) {
  const tokenIndex = buildTokenIndex();
  let changed = false;

  (Array.isArray(updates) ? updates : [updates]).forEach((u: any) => {
    if (!u.assetId) return;
    const idx = tokenIndex[u.assetId];
    if (idx == null) return;

    const t = allTokens.value[idx];
    if (u.priceAda != null) t.priceAda = u.priceAda;
    if (u.priceUsd != null) t.price = u.priceUsd;
    if (u.priceChange1h != null) t.change1h = u.priceChange1h;
    if (u.priceChange24h != null) t.change24h = u.priceChange24h;
    if (u.priceChange7d != null) t.change7d = u.priceChange7d;
    if (u.volume24h != null) t.volume24h = u.volume24h;
    if (u.tvl != null) t.tvl = u.tvl;
    if (u.liquidity != null) t.liquidity = u.liquidity;
    if (u.marketCap != null) t.mcap = u.marketCap;
    if (u.holders != null) t.holders = u.holders;
    if (u.isNew != null) t.isNew = u.isNew;
    changed = true;
  });

  if (!changed || renderPending) return;
  renderPending = true;
  setTimeout(() => {
    renderPending = false;
    allTokens.value = [...allTokens.value];
  }, 2000);
}

/** Minimal STOMP framing */
function stompFrame(command: string, headers: Record<string, string> = {}, body = ''): string {
  let frame = command + '\n';
  for (const [k, v] of Object.entries(headers)) frame += `${k}:${v}\n`;
  frame += '\n' + body + '\0';
  return frame;
}

function parseStompFrame(data: string): { command: string; headers: Record<string, string>; body: string } | null {
  const idx = data.indexOf('\n\n');
  if (idx < 0) return null;
  const headerSection = data.substring(0, idx);
  const body = data.substring(idx + 2).replace(/\0$/, '');
  const lines = headerSection.split('\n');
  const command = lines[0];
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(':');
    if (colon > 0) headers[lines[i].substring(0, colon)] = lines[i].substring(colon + 1);
  }
  return { command, headers, body };
}

/** Send a STOMP frame via SockJS XHR send endpoint */
function stompSend(frame: string): void {
  if (!xhrSendUrl) return;
  const xhr = new XMLHttpRequest();
  xhr.open('POST', xhrSendUrl, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.send(JSON.stringify([frame]));
}

/** Process a SockJS message chunk from the XHR stream */
function processSockJsChunk(chunk: string): void {
  if (chunk === 'o') {
    // SockJS open — send STOMP CONNECT
    stompSend(stompFrame('CONNECT', { 'accept-version': '1.2', 'heart-beat': '0,0' }));
    return;
  }
  if (chunk === 'h') return; // heartbeat
  if (chunk.startsWith('c')) { disconnectStream(); return; }

  if (chunk.startsWith('a')) {
    let messages: string[];
    try { messages = JSON.parse(chunk.substring(1)); } catch { return; }

    for (const msg of messages) {
      const frame = parseStompFrame(msg);
      if (!frame) continue;

      if (frame.command === 'CONNECTED') {
        stompSend(stompFrame('SUBSCRIBE', { id: 'sub-0', destination: STOMP_TOPIC }));
        wsConnected.value = true;
        console.debug('📡 Market stream connected and subscribed');
      } else if (frame.command === 'MESSAGE' && frame.body) {
        try { mergePriceUpdates(JSON.parse(frame.body)); } catch { /* ignore */ }
      }
    }
  }
}

let polling = false;
let xhrPollUrl = '';

/** Long-poll: POST to /xhr, get one message, repeat */
function poll(): void {
  if (!polling || !xhrPollUrl) return;

  const xhr = new XMLHttpRequest();
  xhrStream = xhr;
  xhr.open('POST', xhrPollUrl, true);
  xhr.timeout = 30000; // SockJS long-poll typically returns within 25s

  xhr.onload = () => {
    xhrStream = null;
    if (xhr.status === 200 && xhr.responseText) {
      processSockJsChunk(xhr.responseText.trim());
    }
    // Continue polling
    if (polling) poll();
  };

  xhr.onerror = xhr.ontimeout = () => {
    xhrStream = null;
    wsConnected.value = false;
    // Retry after delay
    if (polling) streamReconnectTimer = setTimeout(() => connectStream(), 5000);
  };

  xhr.send(null);
}

function connectStream(): void {
  if (polling) return;

  const server = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const session = Math.random().toString(36).substring(2, 10);
  const baseSessionUrl = `${MARKET_API_BASE}/ws/market/${server}/${session}`;
  xhrSendUrl = `${baseSessionUrl}/xhr_send`;
  xhrPollUrl = `${baseSessionUrl}/xhr`;

  // Open session: first POST to /xhr returns 'o'
  const openXhr = new XMLHttpRequest();
  openXhr.open('POST', xhrPollUrl, true);
  openXhr.onload = () => {
    if (openXhr.status !== 200) {
      console.warn('📡 Market stream open failed:', openXhr.status);
      streamReconnectTimer = setTimeout(() => connectStream(), 5000);
      return;
    }
    processSockJsChunk(openXhr.responseText.trim());
    // Start long-polling loop
    polling = true;
    poll();
  };
  openXhr.onerror = () => {
    streamReconnectTimer = setTimeout(() => connectStream(), 5000);
  };
  openXhr.send(null);
}

function disconnectStream(): void {
  polling = false;
  if (streamReconnectTimer) {
    clearTimeout(streamReconnectTimer);
    streamReconnectTimer = null;
  }
  if (xhrStream) {
    xhrStream.onload = null;
    xhrStream.onerror = null;
    xhrStream.ontimeout = null;
    xhrStream.abort();
    xhrStream = null;
  }
  wsConnected.value = false;
  xhrSendUrl = '';
  xhrPollUrl = '';
}

// --- Cleanup ---

let chainWatcherStop: WatchStopHandle | null = null;
let coinGeckoWatcherStop: WatchStopHandle | null = null;

function cleanup(): void {
  disconnectStream();
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
    fetchAllTokens().then(() => connectStream()); // WS after initial data is ready
    // REST fallback every 5 minutes (in case WS is down)
    refreshInterval = setInterval(() => {
      if (!document.hidden) fetchAllTokens(true);
    }, 300_000);
  }

  // Watch for wallet chain changes — re-fetch data when switching wallets
  if (!chainWatcherStop) {
    chainWatcherStop = watch(() => walletStore.loggedWallet?.chain, () => {
      disconnectStream();
      fetchAllTokens().then(() => connectStream()); // Reconnect WS with fresh data
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
    getTokenCandles,
    wsConnected,
    fetchAllTokens,
    cleanup,
  };
}

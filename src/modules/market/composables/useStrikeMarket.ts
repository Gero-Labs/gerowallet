import { ref, computed, getCurrentScope, onScopeDispose } from 'vue';
import { strikeMarketApi } from '@/api/strike-v2.market';
import { debugLog } from '@/utils/debug';
import type {
  ExchangeInfo,
  SymbolInfo,
  Ticker24hrResponse,
  PremiumIndexResponse,
} from '@/api/strike-v2.types';

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

const exchangeInfo = ref<ExchangeInfo | null>(null);
const tickers = ref<Record<string, Ticker24hrResponse>>({});
const fundingRates = ref<Record<string, PremiumIndexResponse>>({});
const loading = ref(false);

const REFRESH_INTERVAL_MS = 30_000;

let consumers = 0;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchExchangeInfo(): Promise<void> {
  const data = await strikeMarketApi.getExchangeInfo();
  exchangeInfo.value = data;
}

async function fetchTickers(): Promise<void> {
  const data = await strikeMarketApi.get24hrTicker();
  const arr = Array.isArray(data) ? data : [data];
  const map: Record<string, Ticker24hrResponse> = {};
  for (const ticker of arr) {
    map[ticker.symbol] = ticker;
  }
  tickers.value = map;
}

async function fetchFundingRates(): Promise<void> {
  const data = await strikeMarketApi.getPremiumIndex();
  const arr = Array.isArray(data) ? data : [data];
  const map: Record<string, PremiumIndexResponse> = {};
  for (const entry of arr) {
    map[entry.symbol] = entry;
  }
  fundingRates.value = map;
}

/**
 * Run fetches without letting a failure escape: Strike is a third-party API and
 * a timeout must not surface as an unhandled rejection every refresh. A failed
 * fetch leaves the last good data in place.
 */
async function settle(fetches: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(fetches);
  for (const result of results) {
    if (result.status === 'rejected') debugLog('Strike market data fetch failed:', result.reason);
  }
}

function refresh(): Promise<void> {
  // Exchange info is fetched once, but retried until it lands: without it the
  // symbol list stays empty for as long as the page is open.
  const fetches = [fetchTickers(), fetchFundingRates()];
  if (!exchangeInfo.value) fetches.push(fetchExchangeInfo());
  return settle(fetches);
}

function startPolling(): void {
  loading.value = true;
  void settle([fetchExchangeInfo(), fetchTickers(), fetchFundingRates()]).finally(() => {
    loading.value = false;
  });
  refreshInterval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
}

function release(): void {
  consumers -= 1;
  if (consumers > 0 || !refreshInterval) return;
  clearInterval(refreshInterval);
  refreshInterval = null;
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useStrikeMarket() {
  consumers += 1;
  if (consumers === 1) startPolling();
  // Callers outside a component/effect scope are never disposed, so they keep
  // polling alive for the life of the page, as before.
  if (getCurrentScope()) onScopeDispose(release);

  const symbols = computed<SymbolInfo[]>(() =>
    (exchangeInfo.value?.symbols ?? []).filter((s) => s.status === 'TRADING'),
  );

  const symbolNames = computed<string[]>(() => symbols.value.map((s) => s.symbol));

  function getSymbolInfo(symbol: string): SymbolInfo | undefined {
    return exchangeInfo.value?.symbols.find((s) => s.symbol === symbol);
  }

  function getTicker(symbol: string): Ticker24hrResponse | undefined {
    return tickers.value[symbol];
  }

  function getFunding(symbol: string): PremiumIndexResponse | undefined {
    return fundingRates.value[symbol];
  }

  return {
    exchangeInfo,
    symbols,
    symbolNames,
    tickers,
    fundingRates,
    loading,
    getSymbolInfo,
    getTicker,
    getFunding,
    fetchTickers,
    fetchFundingRates,
  };
}

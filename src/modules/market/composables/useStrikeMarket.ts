import { ref, computed } from 'vue';
import { strikeMarketApi } from '@/api/strike-v2.market';
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

let initialized = false;
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

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useStrikeMarket() {
  if (!initialized) {
    initialized = true;
    loading.value = true;

    Promise.all([fetchExchangeInfo(), fetchTickers(), fetchFundingRates()])
      .finally(() => {
        loading.value = false;
      });

    refreshInterval = setInterval(async () => {
      await Promise.all([fetchTickers(), fetchFundingRates()]);
    }, 30_000);
  }

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

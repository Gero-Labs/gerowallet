import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue';
import { PortfolioCacheService, PortfolioDataPoint } from '@/db/portfolio-cache';
import { pendingRetryDelayMs, WALLET_PENDING_MAX_WAIT_MS } from '@/api/market-api';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { debugLog } from '@/utils/debug';

// Singleton service — shared across all composable callers
let sharedService: PortfolioCacheService | null = null;

// Module-level EUR rate sync (runs once, not per component)
const { usdToEurRate: _usdToEurRate, loadExchangeRate: _loadExchangeRate } = useCurrencyConverter();
_loadExchangeRate();

export function usePortfolioData() {
  if (!sharedService) {
    sharedService = new PortfolioCacheService();
    // Keep service's EUR rate in sync (registered once on first init)
    watch(_usdToEurRate, (rate) => {
      sharedService!.usdToEurRate = rate;
    }, { immediate: true });
  }
  const service = sharedService;

  // Loading state
  const isLoading = ref(false);
  // The wallet's full history is still being fetched upstream (202 PENDING): the series are
  // empty because nothing is ready yet, not because the wallet has no history.
  const historyPending = ref(false);

  // Only the latest request may write state or schedule a retry; a newer one (timeframe,
  // mode, wallet) or unmount cancels a pending retry.
  let requestSeq = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSince: number | null = null;
  let pendingAddress: string | null = null;
  let disposed = false;
  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
      clearRetry();
    });
  }

  // Data refs
  const adaData = ref<PortfolioDataPoint[]>([]);
  const usdData = ref<PortfolioDataPoint[]>([]);
  const eurData = ref<PortfolioDataPoint[]>([]);

  // Track first loaded currency for progressive loading
  const firstLoadedCurrency = ref<string | null>(null);

  // Latest portfolio values from data
  const latestPortfolioValues = computed(() => {
    const getLatest = (data: PortfolioDataPoint[]): number | null => {
      if (!data || data.length === 0) return null;
      return data[data.length - 1][1];
    };
    return {
      ada: getLatest(adaData.value),
      usd: getLatest(usdData.value),
      eur: getLatest(eurData.value),
    };
  });

  /**
   * Load data for a specific timeframe and mode (single API call)
   */
  const loadForTimeframe = async (address: string, timeframe: string, adaOnly: boolean = false): Promise<void> => {
    if (!address) return;

    debugLog(`📊 composable loadForTimeframe: timeframe=${timeframe}, adaOnly=${adaOnly}`);
    clearRetry();
    const seq = ++requestSeq;
    isLoading.value = true;
    try {
      const result = await service.loadForTimeframe(address, timeframe, adaOnly);
      if (seq !== requestSeq || disposed) return;
      debugLog(`📊 composable: received adaData=${result.adaData.length}, usdData=${result.usdData.length}`);

      adaData.value = result.adaData;
      usdData.value = result.usdData;
      eurData.value = result.eurData;

      if (result.pendingRetryAfterSeconds != null) {
        historyPending.value = true;
        if (pendingAddress !== address || pendingSince == null) {
          pendingAddress = address;
          pendingSince = Date.now();
        }
        const delay = pendingRetryDelayMs(result.pendingRetryAfterSeconds);
        // Past the cap the chart stays pending; the next visit or refresh asks again.
        if (Date.now() - pendingSince + delay <= WALLET_PENDING_MAX_WAIT_MS) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void loadForTimeframe(address, timeframe, adaOnly);
          }, delay);
        }
      } else {
        historyPending.value = false;
        pendingSince = null;
        pendingAddress = null;
      }

      if (!firstLoadedCurrency.value) {
        if (result.adaData.length > 0) firstLoadedCurrency.value = 'ADA';
        else if (result.usdData.length > 0) firstLoadedCurrency.value = 'USD';
      }
    } catch (error) {
      console.error('Error loading portfolio data:', error);
    } finally {
      if (seq === requestSeq) isLoading.value = false;
    }
  };

  /**
   * Refresh data (re-fetch with default timeframe)
   */
  const refreshPortfolioData = async (address: string, adaOnly: boolean = false): Promise<void> => {
    return loadForTimeframe(address, '7d', adaOnly);
  };

  return {
    // Data
    adaData,
    usdData,
    eurData,

    // Loading
    isLoading,
    historyPending,
    firstLoadedCurrency,

    // Latest values
    latestPortfolioValues,

    // Methods
    loadForTimeframe,
    refreshPortfolioData,
  };
}

import { PortfolioCacheService, PortfolioDataPoint } from '@/db/portfolio-cache';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';

// Note: computed, ref, watch are auto-imported globally by unplugin-auto-import

interface UsePortfolioDataOptions {
  cacheTimeMs?: number; // Cache time in milliseconds, default 1 minute for testing
  enableCache?: boolean; // Enable/disable caching
}

// Singleton cache service — shared across all composable callers
let sharedCacheService: PortfolioCacheService | null = null;

export function usePortfolioData(options: UsePortfolioDataOptions = {}) {
  const {
    cacheTimeMs = 4 * 60 * 60 * 1000, // 4-hour default
    enableCache = true,
  } = options;

  // Reuse singleton cache service
  if (!sharedCacheService) {
    sharedCacheService = new PortfolioCacheService({
      cacheTimeMs,
      enableCache,
    });
  }
  const cacheService = sharedCacheService;

  // Get EUR conversion rate for snapshot transformation
  const { usdToEurRate, loadExchangeRate } = useCurrencyConverter();
  // Ensure rate is loaded
  loadExchangeRate();

  // Keep cache service's EUR rate in sync with the reactive ref
  watch(usdToEurRate, (rate) => {
    cacheService.usdToEurRate = rate;
  }, { immediate: true });

  // Loading states
  const loadingAda = ref(false);
  const loadingUsd = ref(false);

  // Data refs (only ADA and USD are stored; EUR is derived)
  const adaData = ref<PortfolioDataPoint[]>([]);
  const usdData = ref<PortfolioDataPoint[]>([]);

  // EUR data is always derived from USD data × current EUR rate (never stale)
  const eurData = computed<PortfolioDataPoint[]>(() => {
    const rate = usdToEurRate.value;
    if (!rate || rate === 0) return [];
    return usdData.value.map(([ts, val]) => [ts, val * rate] as PortfolioDataPoint);
  });

  // EUR loading mirrors USD loading (EUR appears as soon as USD arrives)
  const loadingEur = computed(() => loadingUsd.value);

  // Track loading order
  const loadingOrder = ref<Array<'ADA' | 'USD' | 'EUR'>>([]);

  // Computed loading state
  const isLoading = computed(() => {
    return loadingAda.value || loadingUsd.value;
  });

  // Get first loaded currency
  const firstLoadedCurrency = computed(() => {
    return loadingOrder.value.length > 0 ? loadingOrder.value[0] : null;
  });

  // Get latest portfolio values (most recent data point from each currency)
  const latestPortfolioValues = computed(() => {
    const getLatestValue = (data: PortfolioDataPoint[], currency: string): number | null => {
      if (!data || data.length === 0) return null;

      const validData = data.filter(point =>
        Array.isArray(point) &&
        typeof point[0] === 'number' &&
        !isNaN(point[0]) &&
        typeof point[1] === 'number' &&
        !isNaN(point[1])
      );

      if (validData.length === 0) return null;

      let maxIdx = 0;
      for (let i = 1; i < validData.length; i++) {
        if (validData[i][0] > validData[maxIdx][0]) maxIdx = i;
      }
      return validData[maxIdx][1];
    };

    return {
      ada: getLatestValue(adaData.value, 'ADA'),
      usd: getLatestValue(usdData.value, 'USD'),
      eur: getLatestValue(eurData.value, 'EUR'),
    };
  });

  // Load portfolio data for specific currency (ADA or USD only; EUR is derived)
  const loadPortfolioData = async (address: string, currency: 'ADA' | 'USD' | 'EUR'): Promise<PortfolioDataPoint[]> => {
    if (!address) {
      console.warn('No address provided for portfolio data');
      return [];
    }

    // EUR is derived from USD — load USD instead
    const actualCurrency = currency === 'EUR' ? 'USD' : currency;

    const loadingRef = actualCurrency === 'ADA' ? loadingAda : loadingUsd;
    loadingRef.value = true;

    try {
      return await cacheService.loadPortfolioData(address, actualCurrency);
    } catch (error) {
      console.error(`Error loading ${actualCurrency} portfolio data:`, error);
      return [];
    } finally {
      loadingRef.value = false;
    }
  };

  // Load all portfolio data
  const loadAllPortfolioData = async (address: string): Promise<void> => {
    if (!address) {
      console.warn('No address provided for loading all portfolio data');
      return;
    }

    try {
      const result = await cacheService.loadAllPortfolioData(address);
      adaData.value = result?.adaData || [];
      usdData.value = result?.usdData || [];
      // eurData is computed from usdData — no assignment needed
    } catch (error) {
      console.error('Error loading all portfolio data:', error);
      adaData.value = [];
      usdData.value = [];
    }
  };

  // Refresh data (ignores cache)
  const refreshPortfolioData = async (address: string): Promise<void> => {
    loadingAda.value = true;
    loadingUsd.value = true;

    try {
      const result = await cacheService.refreshPortfolioData(address);
      adaData.value = result?.adaData || [];
      usdData.value = result?.usdData || [];
    } catch (error) {
      console.error('Error refreshing portfolio data:', error);
      adaData.value = [];
      usdData.value = [];
    } finally {
      loadingAda.value = false;
      loadingUsd.value = false;
    }
  };

  // Cache management methods
  const clearCache = async (address?: string): Promise<void> => {
    if (address) {
      await cacheService.clearAddressCache(address);
    } else {
      await cacheService.clearAllCache();
    }
  };

  const cleanupExpiredCache = async (address: string): Promise<number> => {
    return cacheService.cleanupExpiredCache(address);
  };

  const getCacheStats = async () => {
    return cacheService.getCacheStats();
  };

  // New smart caching methods
  const getCacheStatus = async (address: string) => {
    return cacheService.getCacheStatus(address);
  };

  const loadMissingData = async (address: string): Promise<void> => {
    if (!address) {
      console.warn('No address provided for loading missing data');
      return;
    }

    try {
      loadingAda.value = true;
      loadingUsd.value = true;

      const result = await cacheService.loadMissingData(address);
      adaData.value = result?.adaData || [];
      usdData.value = result?.usdData || [];
    } catch (error) {
      console.error('Error loading missing portfolio data:', error);
      adaData.value = [];
      usdData.value = [];
    } finally {
      loadingAda.value = false;
      loadingUsd.value = false;
    }
  };

  // Progressive loading - loads ADA and USD in parallel, EUR is derived automatically
  const loadDataProgressively = async (address: string): Promise<void> => {
    if (!address) {
      console.warn('No address provided for progressive loading');
      return;
    }

    // Reset loading order and set loading states
    loadingOrder.value = [];
    loadingAda.value = true;
    loadingUsd.value = true;

    // Only load ADA and USD; EUR is derived from USD
    const currencies: Array<'ADA' | 'USD'> = ['ADA', 'USD'];

    const loadPromises = currencies.map(async (currency) => {
      try {
        const data = await loadPortfolioData(address, currency);

        // Track the loading order and update the corresponding ref immediately
        if (!loadingOrder.value.includes(currency)) {
          loadingOrder.value.push(currency);
        }
        // When USD arrives, EUR is also available (computed)
        if (currency === 'USD' && !loadingOrder.value.includes('EUR')) {
          loadingOrder.value.push('EUR');
        }

        if (currency === 'ADA') {
          adaData.value = data;
        } else if (currency === 'USD') {
          usdData.value = data;
        }

        return { currency, data, success: true };
      } catch (error) {
        console.error(`❌ Error loading ${currency} portfolio data:`, error);
        return { currency, data: [], success: false, error };
      }
    });

    try {
      await Promise.allSettled(loadPromises);
    } catch (error) {
      console.error('Error in parallel loading:', error);
    }
  };

  // Load portfolio data at a specific timeframe resolution (for chart timeframe changes)
  const loadForTimeframe = async (address: string, timeframe: string): Promise<void> => {
    if (!address) {
      console.warn('No address provided for timeframe loading');
      return;
    }

    loadingAda.value = true;
    loadingUsd.value = true;

    try {
      const result = await cacheService.loadForTimeframe(address, timeframe);
      adaData.value = result?.adaData || [];
      usdData.value = result?.usdData || [];
    } catch (error) {
      console.error('Error loading portfolio data for timeframe:', error);
    } finally {
      loadingAda.value = false;
      loadingUsd.value = false;
    }
  };

  const forceLoadCurrencyData = async (address: string, currency: 'ADA' | 'USD' | 'EUR'): Promise<void> => {
    if (!address) {
      console.warn('No address provided for force loading currency data');
      return;
    }

    // EUR is derived from USD
    const actualCurrency = currency === 'EUR' ? 'USD' : currency;

    const loadingRef = actualCurrency === 'ADA' ? loadingAda : loadingUsd;
    loadingRef.value = true;

    try {
      const data = await cacheService.forceLoadCurrencyData(address, actualCurrency);

      if (actualCurrency === 'ADA') {
        adaData.value = data;
      } else {
        usdData.value = data;
      }
    } catch (error) {
      console.error(`Error force loading ${actualCurrency} portfolio data:`, error);
    } finally {
      loadingRef.value = false;
    }
  };

  return {
    // Data
    adaData,
    usdData,
    eurData,

    // Loading states
    loadingAda,
    loadingUsd,
    loadingEur,
    isLoading,

    // Loading order tracking
    loadingOrder,
    firstLoadedCurrency,

    // Latest values
    latestPortfolioValues,

    // Methods
    loadPortfolioData,
    loadAllPortfolioData,
    refreshPortfolioData,
    loadMissingData,
    loadDataProgressively,
    loadForTimeframe,
    forceLoadCurrencyData,

    // Cache management
    clearCache,
    getCacheStats,
    getCacheStatus,
    cleanupExpiredCache,

    // Cache options
    cacheTimeMs,
    enableCache,
  };
}

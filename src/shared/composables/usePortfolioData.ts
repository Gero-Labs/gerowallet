import { PortfolioCacheService, PortfolioDataPoint } from '@/db/portfolio-cache';

// Note: computed, ref are auto-imported globally by unplugin-auto-import

interface UsePortfolioDataOptions {
  cacheTimeMs?: number; // Cache time in milliseconds, default 1 minute for testing
  enableCache?: boolean; // Enable/disable caching
}

export function usePortfolioData(options: UsePortfolioDataOptions = {}) {
  const {
    cacheTimeMs = 4 * 60 * 60 * 1000, // 4-hour default
    enableCache = true,
  } = options;

  // Create a cache service instance with options
  const cacheService = new PortfolioCacheService({
    cacheTimeMs,
    enableCache,
  });

  // Loading states
  const loadingAda = ref(false);
  const loadingUsd = ref(false);
  const loadingEur = ref(false);

  // Data refs
  const adaData = ref<PortfolioDataPoint[]>([]);
  const usdData = ref<PortfolioDataPoint[]>([]);
  const eurData = ref<PortfolioDataPoint[]>([]);

  // Track loading order
  const loadingOrder = ref<Array<'ADA' | 'USD' | 'EUR'>>([]);

  // Computed loading state
  const isLoading = computed(() => {
    return loadingAda.value || loadingUsd.value || loadingEur.value;
  });

  // Get first loaded currency
  const firstLoadedCurrency = computed(() => {
    return loadingOrder.value.length > 0 ? loadingOrder.value[0] : null;
  });

  // Get latest portfolio values (most recent data point from each currency)
  // CRITICAL FIX: Find the data point with the MAXIMUM timestamp to ensure we get the most recent value
  // This fixes the issue where cached/merged data might not be properly sorted
  const latestPortfolioValues = computed(() => {
    const getLatestValue = (data: PortfolioDataPoint[], currency: string): number | null => {
      if (!data || data.length === 0) return null;

      // Find the data point with the maximum timestamp (most recent) using Math.max for better performance
      // Add validation to ensure data points are valid before processing
      const validData = data.filter(point =>
        Array.isArray(point) &&
        typeof point[0] === 'number' &&
        !isNaN(point[0]) &&
        typeof point[1] === 'number' &&
        !isNaN(point[1])
      );

      if (validData.length === 0) return null;

      const timestamps = validData.map(point => point[0]);
      const maxTimestamp = Math.max(...timestamps);
      const maxIndex = timestamps.indexOf(maxTimestamp);
      const latestValue = maxIndex !== -1 ? validData[maxIndex][1] : null;

      // Check if data is stale (older than 15 minutes to match cache service) and return null to trigger fallback
      const now = Date.now();
      const fifteenMinutesAgo = now - (15 * 60 * 1000);
      const isStale = maxTimestamp < fifteenMinutesAgo;

      // If data is stale, return null to force fallback to computedValues
      if (isStale) {
        return null;
      }

      return latestValue;
    };

    return {
      ada: getLatestValue(adaData.value, 'ADA'),
      usd: getLatestValue(usdData.value, 'USD'),
      eur: getLatestValue(eurData.value, 'EUR'),
    };
  });

  // Load portfolio data for specific currency
  const loadPortfolioData = async (address: string, currency: 'ADA' | 'USD' | 'EUR'): Promise<PortfolioDataPoint[]> => {
    if (!address) {
      console.warn('No address provided for portfolio data');
      return [];
    }

    // Set loading state
    const loadingRef = currency === 'ADA' ? loadingAda : currency === 'USD' ? loadingUsd : loadingEur;
    loadingRef.value = true;

    try {
      return cacheService.loadPortfolioData(address, currency);
    } catch (error) {
      console.error(`Error loading ${currency} portfolio data:`, error);
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

      // Update refs with null checks
      adaData.value = result?.adaData || [];
      usdData.value = result?.usdData || [];
      eurData.value = result?.eurData || [];
    } catch (error) {
      console.error('Error loading all portfolio data:', error);
      // Set empty arrays on error
      adaData.value = [];
      usdData.value = [];
      eurData.value = [];
    }
  };

  // Refresh data (ignores cache)
  const refreshPortfolioData = async (address: string): Promise<void> => {
    // Set loading states
    loadingAda.value = true;
    loadingUsd.value = true;
    loadingEur.value = true;

    try {
      const result = await cacheService.refreshPortfolioData(address);

      // Update refs with null checks
      adaData.value = result?.adaData || [];
      usdData.value = result?.usdData || [];
      eurData.value = result?.eurData || [];
    } catch (error) {
      console.error('Error refreshing portfolio data:', error);
      // Set empty arrays on error
      adaData.value = [];
      usdData.value = [];
      eurData.value = [];
    } finally {
      loadingAda.value = false;
      loadingUsd.value = false;
      loadingEur.value = false;
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
      // Set loading states
      loadingAda.value = true;
      loadingUsd.value = true;
      loadingEur.value = true;

      const result = await cacheService.loadMissingData(address);

      // Update refs with null checks
      adaData.value = result?.adaData || [];
      usdData.value = result?.usdData || [];
      eurData.value = result?.eurData || [];
    } catch (error) {
      console.error('Error loading missing portfolio data:', error);
      // Set empty arrays on error
      adaData.value = [];
      usdData.value = [];
      eurData.value = [];
    } finally {
      loadingAda.value = false;
      loadingUsd.value = false;
      loadingEur.value = false;
    }
  };

  // Progressive loading - loads all currencies in parallel, showing results as they become available
  const loadDataProgressively = async (address: string): Promise<void> => {
    if (!address) {
      console.warn('No address provided for progressive loading');
      return;
    }

    // Reset loading order and set all loading states to true
    loadingOrder.value = [];
    loadingAda.value = true;
    loadingUsd.value = true;
    loadingEur.value = true;

    // Load all currencies in parallel
    const currencies: Array<'ADA' | 'USD' | 'EUR'> = ['ADA', 'USD', 'EUR'];

    const loadPromises = currencies.map(async (currency) => {
      try {

        const data = await loadPortfolioData(address, currency);

        // Track the loading order and update the corresponding ref immediately
        if (!loadingOrder.value.includes(currency)) {
          loadingOrder.value.push(currency);
        }

        if (currency === 'ADA') {
          adaData.value = data;
        } else if (currency === 'USD') {
          usdData.value = data;
        } else if (currency === 'EUR') {
          eurData.value = data;
        }

        return { currency, data, success: true };
      } catch (error) {
        console.error(`❌ Error loading ${currency} portfolio data:`, error);
        return { currency, data: [], success: false, error };
      }
    });

    // Wait for all promises to complete (but data is updated as each one finishes)
    try {
      await Promise.allSettled(loadPromises);
    } catch (error) {
      console.error('Error in parallel loading:', error);
    }
  };

  const forceLoadCurrencyData = async (address: string, currency: 'ADA' | 'USD' | 'EUR'): Promise<void> => {
    if (!address) {
      console.warn('No address provided for force loading currency data');
      return;
    }

    // Set loading state for specific currency
    const loadingRef = currency === 'ADA' ? loadingAda : currency === 'USD' ? loadingUsd : loadingEur;
    loadingRef.value = true;

    try {
      const data = await cacheService.forceLoadCurrencyData(address, currency);

      // Update specific currency data
      switch (currency) {
        case 'ADA':
          adaData.value = data;
          break;
        case 'USD':
          usdData.value = data;
          break;
        case 'EUR':
          eurData.value = data;
          break;
      }
    } catch (error) {
      console.error(`Error force loading ${currency} portfolio data:`, error);
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

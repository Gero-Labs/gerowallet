import { PortfolioCacheService, PortfolioDataPoint } from '@/db/portfolio-cache';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';

// Note: computed, ref, watch are auto-imported globally by unplugin-auto-import

// Singleton service — shared across all composable callers
let sharedService: PortfolioCacheService | null = null;

export function usePortfolioData() {
  if (!sharedService) {
    sharedService = new PortfolioCacheService();
  }
  const service = sharedService;

  // Get EUR conversion rate for snapshot transformation
  const { usdToEurRate, loadExchangeRate } = useCurrencyConverter();
  loadExchangeRate();

  // Keep service's EUR rate in sync with the reactive ref
  watch(usdToEurRate, (rate) => {
    service.usdToEurRate = rate;
  }, { immediate: true });

  // Loading state
  const isLoading = ref(false);

  // Data refs
  const adaData = ref<PortfolioDataPoint[]>([]);
  const usdData = ref<PortfolioDataPoint[]>([]);

  // EUR data derived from USD × rate
  const eurData = computed<PortfolioDataPoint[]>(() => {
    const rate = usdToEurRate.value;
    if (!rate || rate === 0) return [];
    return usdData.value.map(([ts, val]) => [ts, val * rate] as PortfolioDataPoint);
  });

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

    console.log(`📊 composable loadForTimeframe: timeframe=${timeframe}, adaOnly=${adaOnly}`);
    isLoading.value = true;
    try {
      const result = await service.loadForTimeframe(address, timeframe, adaOnly);
      console.log(`📊 composable: received adaData=${result.adaData.length}, usdData=${result.usdData.length}`);

      adaData.value = result.adaData;
      usdData.value = result.usdData;

      if (!firstLoadedCurrency.value) {
        if (result.adaData.length > 0) firstLoadedCurrency.value = 'ADA';
        else if (result.usdData.length > 0) firstLoadedCurrency.value = 'USD';
      }
    } catch (error) {
      console.error('Error loading portfolio data:', error);
    } finally {
      isLoading.value = false;
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
    firstLoadedCurrency,

    // Latest values
    latestPortfolioValues,

    // Methods
    loadForTimeframe,
    refreshPortfolioData,
  };
}

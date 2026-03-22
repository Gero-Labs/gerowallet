import { Api } from '@/api/api';
import { walletStore } from '@/stores/walletStore';

// Note: ref, computed are auto-imported globally by unplugin-auto-import

const usdToEurRate = ref<number>(1);
const loading = ref(false);
const error = ref<string | null>(null);
const rateLoaded = ref(false);
const usdToAdaRate = ref<number>(1);

export function useCurrencyConverter() {
  const api = new Api(walletStore.loggedWallet, walletStore.loggedWallet.provider);

  const loadExchangeRate = async () => {
    if (loading.value || rateLoaded.value) return;

    loading.value = true;
    error.value = null;

    try {
      const fiatRates = await api.fetchFiatRates();
      if (fiatRates?.ada) {
        usdToAdaRate.value = 1 / fiatRates.ada;
        rateLoaded.value = true;
      }

      if (fiatRates?.eur) {
        usdToEurRate.value = fiatRates.eur;
        rateLoaded.value = true;
      }
    } catch (apiError) {
      error.value = 'Failed to load current exchange rate';
      rateLoaded.value = true;
    } finally {
      loading.value = false;
    }
  };

  const currentCurrency = computed(() => walletStore.config?.currency || 'usd');
  const shouldConvert = computed(() => currentCurrency.value !== 'usd');

  const convertFiat = (usdAmount: number, forceSystemCurrency: boolean = false): number => {
    if (!usdAmount || usdAmount === 0) {
      return 0;
    }

    if (!shouldConvert.value && !forceSystemCurrency) {
      return usdAmount;
    }

    if (!rateLoaded.value && !loading.value) {
      loadExchangeRate();
    }
    // Convert USD to EUR (not ADA!)
    return Number((usdAmount * usdToEurRate.value).toFixed(6));
  };

  const getCurrencySymbol = (): string => {
    const currency = currentCurrency.value;
    const symbols = {
      usd: '$',
      eur: '€',
    };
    return symbols[currency] || '$';
  };

  const resetRateLoaded = () => {
    rateLoaded.value = false;
  };

  const forceReloadRate = async () => {
    rateLoaded.value = false;
    loading.value = false;
    await loadExchangeRate();
  };

  return {
    convertFiat,
    usdToEurRate,
    loading,
    error,
    loadExchangeRate,
    currentCurrency,
    shouldConvert,
    getCurrencySymbol,
    resetRateLoaded,
    forceReloadRate,
  };
}

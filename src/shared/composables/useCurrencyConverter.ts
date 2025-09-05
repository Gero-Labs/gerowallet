import { ref, computed } from 'vue';
import axios from 'axios';
import { walletStore } from '@/stores/walletStore';

const usdToEurRate = ref<number>(1);
const loading = ref(false);
const error = ref<string | null>(null);
const rateLoaded = ref(false);

export function useCurrencyConverter() {
  const loadExchangeRate = async () => {
    if (loading.value || rateLoaded.value) return;

    loading.value = true;
    error.value = null;

    try {
      const response = await axios.get('https://api.fxratesapi.com/latest?base=USD&symbols=EUR', { timeout: 10000 });

      if (response.data?.rates?.EUR) {
        usdToEurRate.value = response.data.rates.EUR;
        rateLoaded.value = true;
      } else {
        throw new Error('EUR rate not found in API response');
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

  const convertUsdToEur = (usdAmount: number): number => {
    if (!usdAmount || usdAmount === 0) {
      return 0;
    }

    if (!shouldConvert.value) {
      return usdAmount;
    }

    if (!rateLoaded.value && !loading.value) {
      loadExchangeRate();
    }

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
    convertUsdToEur,
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

import { computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';

/**
 * Returns the native currency symbol and ticker for the active wallet's chain.
 * Cardano → ₳ / ADA, Apex → Â / AP3X
 */
export function useNativeCurrency() {
  const currencySymbol = computed(() =>
    networks.resolveCurrencySymbol(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network) || '₳'
  );

  const currencyTicker = computed(() =>
    networks.resolveCurrencyTicker(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network) || 'ADA'
  );

  const currencyName = computed(() =>
    networks.resolveCurrencyName(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network) || 'Cardano'
  );

  return { currencySymbol, currencyTicker, currencyName };
}

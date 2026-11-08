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

  const currencyTicker = computed(currencyTickerNow);

  const currencyName = computed(() =>
    networks.resolveCurrencyName(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network) || 'Cardano'
  );

  return { currencySymbol, currencyTicker, currencyName };
}

/** The active wallet's native currency ticker (ADA, tADA on testnets). Reactive inside a computed; for code that is not a component. */
export function currencyTickerNow(): string {
  return networks.resolveCurrencyTicker(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network) || 'ADA';
}

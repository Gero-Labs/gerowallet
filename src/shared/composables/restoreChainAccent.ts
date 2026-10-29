import { walletStore } from '@/stores/walletStore';
import { updateVuetifyTheme } from '@/plugins/vuetify';
import { applyChainAccent } from './useChainAccent';

/**
 * Puts the signed-in wallet's accent back after a preview re-themed the app.
 * Onboarding's network step previews a chain by re-pointing Vuetify's theme.
 * Leaving it from a signed-in wallet (to add or pair another) does not change
 * the wallet's chain, so the useChainAccent watcher never fires, and Vuetify
 * stayed on the preview: Cardano cyan `primary` on a Bitcoin wallet. With no
 * wallet signed in there is nothing to restore, so `fallbackChain` is themed.
 */
export function restoreChainAccent(fallbackChain: string): void {
  const chain = walletStore.loggedWallet?.chain;
  if (!chain) {
    updateVuetifyTheme(fallbackChain);
    return;
  }
  applyChainAccent(chain);
  updateVuetifyTheme(chain);
}

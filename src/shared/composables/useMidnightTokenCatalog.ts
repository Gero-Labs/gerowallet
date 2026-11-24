import { watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';

/**
 * Load Nexus's Midnight token catalog whenever a Midnight wallet is logged in
 * (and when its network changes), so token names come from the catalog on
 * every screen. Called once per page (options and side panel App). The loader
 * is imported only for a Midnight wallet: other chains never load it.
 */
export function useMidnightTokenCatalog(): void {
  watch(
    () => (walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT ? walletStore.loggedWallet.network : null),
    async (network) => {
      if (!network) return;
      const { ensureMidnightTokenCatalog } = await import('@/chains/midnight/midnightTokenCatalog');
      await ensureMidnightTokenCatalog(network);
    },
    { immediate: true },
  );
}

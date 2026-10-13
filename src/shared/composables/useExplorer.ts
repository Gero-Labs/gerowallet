import { computed } from 'vue';
import WalletStore, { walletStore } from '@/stores/walletStore';
import {
  EXPLORER_CONFIG_KEY,
  explorersFor,
  getExplorerUrl,
  resolveExplorerId,
  type ExplorerEntity,
} from '@/shared/utils/explorer';

/**
 * Explorer links for the logged-in wallet: its chain, its network and the
 * explorer saved in its config. Components call `explorerUrl('tx', hash)`.
 */
export function useExplorer() {
  const chain = computed(() => walletStore.loggedWallet?.chain ?? '');
  const network = computed(() => walletStore.loggedWallet?.network);

  const explorerOptions = computed(() => explorersFor(chain.value, network.value));
  const explorerId = computed(() =>
    resolveExplorerId(chain.value, network.value, walletStore.config?.[EXPLORER_CONFIG_KEY]),
  );

  /**
   * `chain` and `network` override the wallet's own for flows that always live
   * on one chain: cNIGHT DUST registration is a Cardano transaction, and from a
   * Midnight wallet it is on that network's Cardano twin (cardanoTwinNetwork).
   */
  function explorerUrl(
    type: ExplorerEntity,
    id: string | null | undefined,
    options: { chain?: string; network?: string } = {},
  ): string {
    if (!id) return '';
    return getExplorerUrl(options.chain ?? chain.value, id, type, options.network ?? network.value, explorerId.value);
  }

  async function setExplorer(id: string): Promise<void> {
    if (!explorerOptions.value.some(option => option.id === id)) return;
    await WalletStore.setExplorer(id);
  }

  return { explorerOptions, explorerId, explorerUrl, setExplorer };
}

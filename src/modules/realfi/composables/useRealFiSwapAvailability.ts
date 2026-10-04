import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Blockchain, Network } from '@/models/types';
import WalletStore from '@/stores/walletStore';
import featureFlagsStore from '@/stores/featureFlagsStore';
import TokenMetadataStore from '@/stores/tokenMetadataStore';
import { REALFI_ASSETS } from '../assets';

export type RealFiSwapAvailability = 'unknown' | 'loading' | 'available' | 'unavailable';
const MAINNET_USDCX_UNIT =
  '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378';

interface SwapCatalogEntry {
  unit?: unknown;
  decimals?: unknown;
}

/** The widget registry is the supported-swap catalogue, not the wallet's held assets. */
export function hasSupportedSwapToken(
  catalog: Record<string, unknown>,
  unit: string,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(catalog, unit)) return false;
  const entry = catalog[unit] as SwapCatalogEntry | null | undefined;
  return entry?.unit === unit && Number(entry.decimals) === 6;
}

/**
 * Refreshes the shared swap-token catalogue and reports RealFi token availability.
 * A stale result from a previous wallet, account, network, or feature-flag scope cannot
 * unlock the acquisition action for the currently displayed wallet.
 */
export function useRealFiSwapAvailability() {
  const status = ref<RealFiSwapAvailability>('unknown');
  const walletScope = computed(() => {
    const wallet = WalletStore.state.loggedWallet;
    return JSON.stringify([
      wallet?.id ?? null,
      wallet?.baseAddress ?? null,
      wallet?.chain ?? null,
      wallet?.network ?? null,
      featureFlagsStore.isSwapEnabled(),
    ]);
  });
  const canCheck = computed(() => {
    const wallet = WalletStore.state.loggedWallet;
    return Boolean(
      wallet?.baseAddress &&
        wallet.chain === Blockchain.CARDANO &&
        wallet.network === Network.MAINNET &&
        featureFlagsStore.isSwapEnabled(),
    );
  });

  let requestId = 0;

  async function refresh(): Promise<void> {
    const requestScope = walletScope.value;
    if (!canCheck.value) {
      status.value = 'unknown';
      return;
    }

    const thisRequest = ++requestId;
    status.value = 'loading';
    const loaded = await TokenMetadataStore.loadTokens(
      () => thisRequest === requestId && requestScope === walletScope.value,
    ).catch(() => false);
    if (thisRequest !== requestId || requestScope !== walletScope.value) return;

    const catalog = TokenMetadataStore.state.tokens as Record<string, unknown>;
    status.value =
      loaded &&
      hasSupportedSwapToken(catalog, REALFI_ASSETS.mainnet.usdr) &&
      hasSupportedSwapToken(catalog, MAINNET_USDCX_UNIT)
        ? 'available'
        : 'unavailable';
  }

  watch(
    walletScope,
    () => {
      requestId += 1;
      status.value = 'unknown';
      if (canCheck.value) void refresh();
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    requestId += 1;
  });

  return {
    status,
    isAvailable: computed(() => canCheck.value && status.value === 'available'),
    isUsdcxAvailable: computed(() => {
      if (!canCheck.value || status.value !== 'available') return false;
      return hasSupportedSwapToken(
        TokenMetadataStore.state.tokens as Record<string, unknown>,
        MAINNET_USDCX_UNIT,
      );
    }),
    canCheck,
    refresh,
  };
}

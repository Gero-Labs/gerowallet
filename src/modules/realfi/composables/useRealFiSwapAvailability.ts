import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Blockchain, Network } from '@/models/types';
import WalletStore from '@/stores/walletStore';
import featureFlagsStore from '@/stores/featureFlagsStore';
import TokenMetadataStore from '@/stores/tokenMetadataStore';
import { MAINNET_USDCX_UNIT, REALFI_ASSETS } from '../assets';

export type RealFiSwapAvailability = 'unknown' | 'loading' | 'available' | 'unavailable';

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
 * Refreshes the shared swap-token catalogue and reports which leg of getting USDrf Gero
 * can swap: ADA → USDCx needs only USDCx listed; USDCx → USDrf needs both. `status` is
 * about the first leg, so a catalogue without USDrf still offers ADA → USDCx.
 *
 * A stale result from a previous wallet, account, network, or feature-flag scope cannot
 * unlock an acquisition action for the currently displayed wallet.
 */
export function useRealFiSwapAvailability() {
  const status = ref<RealFiSwapAvailability>('unknown');
  // Whether the last applied catalogue also listed USDrf: the second leg's own gate.
  const usdrfListed = ref(false);
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
      usdrfListed.value = false;
      return;
    }

    const thisRequest = ++requestId;
    status.value = 'loading';
    const loaded = await TokenMetadataStore.loadTokens(
      () => thisRequest === requestId && requestScope === walletScope.value,
    ).catch(() => false);
    if (thisRequest !== requestId || requestScope !== walletScope.value) return;

    const catalog = TokenMetadataStore.state.tokens as Record<string, unknown>;
    const usdcxListed = loaded && hasSupportedSwapToken(catalog, MAINNET_USDCX_UNIT);
    usdrfListed.value = usdcxListed && hasSupportedSwapToken(catalog, REALFI_ASSETS.mainnet.usdr);
    status.value = usdcxListed ? 'available' : 'unavailable';
  }

  watch(
    walletScope,
    () => {
      requestId += 1;
      status.value = 'unknown';
      usdrfListed.value = false;
      if (canCheck.value) void refresh();
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    requestId += 1;
  });

  const isUsdcxAvailable = computed(() => canCheck.value && status.value === 'available');
  return {
    status,
    /** ADA → USDCx: the first leg, and all a wallet without USDCx can do in Gero. */
    isUsdcxAvailable,
    /** USDCx → USDrf: listed in the catalogue. The page adds its own flag on top. */
    isUsdrfAvailable: computed(() => isUsdcxAvailable.value && usdrfListed.value),
    canCheck,
    refresh,
  };
}

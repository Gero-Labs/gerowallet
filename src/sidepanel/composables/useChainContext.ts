import { computed, ComputedRef } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import networks, { NetworkInfo } from '@/utils/networks';
import { themes } from '@/config/themes';
import { useChainAccent } from '@/shared/composables/useChainAccent';

export interface ThemePalette {
  primary: string;
  secondary: string;
  accent: string;
  light: string;
  dark: string;
  darker: string;
  muted: string;
  bright: string;
  gradient1: string;
  gradient2: string;
}

export interface ChainContext {
  isApex: ComputedRef<boolean>;
  isCardano: ComputedRef<boolean>;
  isBitcoin: ComputedRef<boolean>;
  isMidnight: ComputedRef<boolean>;
  networkInfo: ComputedRef<NetworkInfo | null>;
  themeColors: ComputedRef<ThemePalette>;
}

export function useChainContext(): ChainContext {
  // The CSS custom properties are written by the single accent writer.
  useChainAccent();

  const isApex = computed(() =>
    walletStore.loggedWallet?.chain === Blockchain.APEX_PRIME ||
    walletStore.loggedWallet?.chain === Blockchain.APEX_VECTOR
  );

  const isCardano = computed(() =>
    walletStore.loggedWallet?.chain === Blockchain.CARDANO
  );

  const isBitcoin = computed(() =>
    walletStore.loggedWallet?.chain === Blockchain.BITCOIN
  );

  const isMidnight = computed(() =>
    walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT
  );

  const networkInfo = computed<NetworkInfo | null>(() => {
    const wallet = walletStore.loggedWallet;
    if (!wallet) return null;
    return networks.networks.find(n =>
      n.blockchain === wallet.chain && n.network === wallet.network
    ) || null;
  });

  // Kept for the ~28 JS `:color` bindings that read themeColors directly.
  // The Midnight branch is required: without it a Midnight wallet would mix
  // violet CSS accents (from useChainAccent) with teal JS bindings.
  const themeColors = computed<ThemePalette>(() => {
    if (isApex.value) return themes.apex;
    if (isBitcoin.value) return themes.bitcoin;
    if (isMidnight.value) return themes.midnight;
    return themes.cardano;
  });

  return { isApex, isCardano, isBitcoin, isMidnight, networkInfo, themeColors };
}

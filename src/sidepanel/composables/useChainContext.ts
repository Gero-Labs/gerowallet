import { computed, watch, ComputedRef } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import networks, { NetworkInfo } from '@/utils/networks';
import { themes } from '@/config/themes';

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
  networkInfo: ComputedRef<NetworkInfo | null>;
  isMidnight: ComputedRef<boolean>;
  themeColors: ComputedRef<ThemePalette>;
}

let cssVariablesApplied = false;

export function useChainContext(): ChainContext {
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

  const themeColors = computed<ThemePalette>(() => {
    if (isApex.value) return themes.apex;
    if (isBitcoin.value) return themes.bitcoin;
    return themes.cardano;
  });

  // Apply CSS variables once per composable lifetime. Multiple components can
  // call useChainContext() — we only want one watcher writing to the document root.
  if (!cssVariablesApplied && typeof document !== 'undefined') {
    cssVariablesApplied = true;
    watch(themeColors, (colors) => {
      const root = document.documentElement;
      root.style.setProperty('--chain-primary', colors.primary);
      root.style.setProperty('--chain-secondary', colors.secondary);
      root.style.setProperty('--chain-accent', colors.accent);
      root.style.setProperty('--chain-gradient1', colors.gradient1);
      root.style.setProperty('--chain-gradient2', colors.gradient2);
      root.style.setProperty('--chain-light', colors.light);
      root.style.setProperty('--chain-dark', colors.dark);
    }, { immediate: true });
  }

  return { isApex, isMidnight, isCardano, isBitcoin, networkInfo, themeColors };
}

import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useChainContext } from './useChainContext';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import { isMidnightSwapNetwork } from '@/chains/midnight/midnightSwapConfig';

export interface NavTab {
  name: string;
  icon: string;
  activeIcon: string;
  /** Tabs navigate. Omitted for action tabs, which open a sheet instead. */
  route?: string;
  /** Action tabs emit this id from BottomNav instead of routing. */
  action?: string;
  center?: boolean;
}

const CARDANO_TABS: NavTab[] = [
  { name: 'home', icon: 'mdi-home-outline', activeIcon: 'mdi-home', route: '/' },
  { name: 'staking', icon: 'mdi-finance', activeIcon: 'mdi-finance', route: '/staking' },
  // Swap owns the center slot (formerly the Gero Card tab). It is an action, not
  // a route: the panel's swap lives in SwapSheet, the same sheet Quick Actions
  // opens, so there is one swap surface rather than two.
  { name: 'swap', icon: 'mdi-swap-horizontal', activeIcon: 'mdi-swap-horizontal', action: 'swap', center: true },
  { name: 'market', icon: 'mdi-chart-line', activeIcon: 'mdi-chart-line', route: '/market' },
  { name: 'activity', icon: 'mdi-history', activeIcon: 'mdi-history', route: '/activity' },
  { name: 'feed', icon: 'mdi-bell-outline', activeIcon: 'mdi-bell', route: '/feed' },
];

// Midnight and Solana: only home + tx history are meaningful today (no staking/card/market).
const HOME_ACTIVITY_TABS: NavTab[] = [
  { name: 'home', icon: 'mdi-home-outline', activeIcon: 'mdi-home', route: '/' },
  { name: 'activity', icon: 'mdi-history', activeIcon: 'mdi-history', route: '/activity' },
];

// Midnight on a swap network (midnightSwapConfig.ts): the P2P swap takes the center slot, as a route.
const MIDNIGHT_SWAP_TABS: NavTab[] = [
  { name: 'home', icon: 'mdi-home-outline', activeIcon: 'mdi-home', route: '/' },
  { name: 'midnightSwap', icon: 'mdi-swap-horizontal', activeIcon: 'mdi-swap-horizontal', route: '/midnight-swap', center: true },
  { name: 'activity', icon: 'mdi-history', activeIcon: 'mdi-history', route: '/activity' },
];

export function useMiniNavigation() {
  const route = useRoute();
  const { isMidnight, isSolana, networkInfo } = useChainContext();

  const navTabs = computed<NavTab[]>(() => {
    const base = isMidnight.value && isMidnightSwapNetwork(walletStore.loggedWallet?.network)
      ? MIDNIGHT_SWAP_TABS
      : isMidnight.value || isSolana.value ? HOME_ACTIVITY_TABS : CARDANO_TABS;
    return base.filter((tab) => {
      // Gero Copilot feed tab gated by the master flag (ships dark)
      if (tab.name === 'feed') return featureFlagsStore.isCopilotEnabled();
      // Hide Staking on chains without delegated staking.
      if (tab.name === 'staking') return !!networkInfo.value?.stakingSupport;
      // Same gate Quick Actions uses — a chain without swap support (e.g. BTC)
      // gets no swap button rather than a dead one. The isSwapEnabled
      // maintenance gate is handled inside SwapSheet.
      if (tab.name === 'swap') return !!networkInfo.value?.swapSupport;
      return true;
    });
  });
  const activeTab = computed(() => route.path);

  return { navTabs, activeTab };
}

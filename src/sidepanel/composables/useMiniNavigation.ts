import { computed } from 'vue';
import { useRoute } from 'vue-router/composables';
import { useChainContext } from './useChainContext';
import { featureFlagsStore } from '@/stores/featureFlagsStore';

export interface NavTab {
  name: string;
  icon: string;
  activeIcon: string;
  route: string;
  center?: boolean;
}

const CARDANO_TABS: NavTab[] = [
  { name: 'home', icon: 'mdi-home-outline', activeIcon: 'mdi-home', route: '/' },
  { name: 'staking', icon: 'mdi-finance', activeIcon: 'mdi-finance', route: '/staking' },
  { name: 'card', icon: 'mdi-credit-card-outline', activeIcon: 'mdi-credit-card', route: '/card', center: true },
  { name: 'market', icon: 'mdi-chart-line', activeIcon: 'mdi-chart-line', route: '/market' },
  { name: 'activity', icon: 'mdi-history', activeIcon: 'mdi-history', route: '/activity' },
  { name: 'feed', icon: 'mdi-bell-outline', activeIcon: 'mdi-bell', route: '/feed' },
];

// Midnight: only home + tx history are meaningful today (no staking/card/market).
const MIDNIGHT_TABS: NavTab[] = [
  { name: 'home', icon: 'mdi-home-outline', activeIcon: 'mdi-home', route: '/' },
  { name: 'activity', icon: 'mdi-history', activeIcon: 'mdi-history', route: '/activity' },
];

const APEX_TABS: NavTab[] = [
  { name: 'home', icon: 'mdi-home-outline', activeIcon: 'mdi-home', route: '/' },
  { name: 'staking', icon: 'mdi-finance', activeIcon: 'mdi-finance', route: '/staking' },
  { name: 'activity', icon: 'mdi-history', activeIcon: 'mdi-history', route: '/activity' },
];

export function useMiniNavigation() {
  const route = useRoute();
  const { isApex, isMidnight } = useChainContext();

  const navTabs = computed<NavTab[]>(() => {
    const base = isMidnight.value ? MIDNIGHT_TABS : isApex.value ? APEX_TABS : CARDANO_TABS;
    // Gero Copilot feed tab gated by the master flag (ships dark)
    return featureFlagsStore.isCopilotEnabled() ? base : base.filter((tab) => tab.name !== 'feed');
  });
  const activeTab = computed(() => route.path);

  return { navTabs, activeTab };
}

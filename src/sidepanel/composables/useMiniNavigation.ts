import { computed } from 'vue';
import { useRoute } from 'vue-router/composables';
import { useChainContext } from './useChainContext';

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
];

const APEX_TABS: NavTab[] = [
  { name: 'home', icon: 'mdi-home-outline', activeIcon: 'mdi-home', route: '/' },
  { name: 'staking', icon: 'mdi-finance', activeIcon: 'mdi-finance', route: '/staking' },
  { name: 'activity', icon: 'mdi-history', activeIcon: 'mdi-history', route: '/activity' },
];

export function useMiniNavigation() {
  const route = useRoute();
  const { isApex } = useChainContext();

  const navTabs = computed<NavTab[]>(() => isApex.value ? APEX_TABS : CARDANO_TABS);
  const activeTab = computed(() => route.path);

  return { navTabs, activeTab };
}

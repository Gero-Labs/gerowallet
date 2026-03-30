import { computed } from 'vue';
import { useRoute } from 'vue-router/composables';

export interface NavTab {
  name: string;
  icon: string;
  activeIcon: string;
  route: string;
  center?: boolean;
}

export const navTabs: NavTab[] = [
  { name: 'home', icon: 'mdi-home-outline', activeIcon: 'mdi-home', route: '/' },
  { name: 'staking', icon: 'mdi-finance', activeIcon: 'mdi-finance', route: '/staking' },
  { name: 'card', icon: 'mdi-credit-card-outline', activeIcon: 'mdi-credit-card', route: '/card', center: true },
  { name: 'market', icon: 'mdi-chart-line', activeIcon: 'mdi-chart-line', route: '/market' },
  { name: 'activity', icon: 'mdi-history', activeIcon: 'mdi-history', route: '/activity' },
];

export function useMiniNavigation() {
  const route = useRoute();
  const activeTab = computed(() => route.path);
  return { navTabs, activeTab };
}

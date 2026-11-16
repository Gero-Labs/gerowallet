import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import networks from '@/utils/networks';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./pages/HomePage.vue') },
  { path: '/staking', name: 'staking', component: () => import('./pages/StakingPage.vue') },
  { path: '/market', name: 'market', component: () => import('./pages/MarketPage.vue') },
  { path: '/perps', name: 'perps', component: () => import('./pages/PerpetualsPage.vue') },
  { path: '/vaults', name: 'vaults', component: () => import('./pages/VaultsPage.vue') },
  { path: '/activity', name: 'activity', component: () => import('./pages/ActivityPage.vue') },
  { path: '/feed', name: 'feed', component: () => import('./pages/FeedPage.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach((to, _from, next) => {
  const chain = walletStore.loggedWallet?.chain;

  // Staking page only on chains that support delegated staking.
  if (to.name === 'staking' &&
      !networks.resolveStakingSupport(chain ?? '', walletStore.loggedWallet?.network ?? '')) {
    next({ name: 'home' });
    return;
  }
  // Gero Copilot feed gated by the master feature flag (ships dark). While flags
  // load, isCopilotEnabled() is false via the getFlag fallback, so /feed redirects
  // home until gero-sync turns it on.
  if (to.name === 'feed' && !featureFlagsStore.isCopilotEnabled()) {
    next({ name: 'home' });
    return;
  }
  next();
});

export default router;

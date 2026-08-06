import VueRouter, { RouteConfig } from 'vue-router';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import { featureFlagsStore } from '@/stores/featureFlagsStore';

const routes: RouteConfig[] = [
  { path: '/', name: 'home', component: () => import('./pages/HomePage.vue') },
  { path: '/staking', name: 'staking', component: () => import('./pages/StakingPage.vue') },
  { path: '/market', name: 'market', component: () => import('./pages/MarketPage.vue') },
  { path: '/perps', name: 'perps', component: () => import('./pages/PerpetualsPage.vue') },
  { path: '/vaults', name: 'vaults', component: () => import('./pages/VaultsPage.vue') },
  { path: '/activity', name: 'activity', component: () => import('./pages/ActivityPage.vue') },
  { path: '/feed', name: 'feed', component: () => import('./pages/FeedPage.vue') },
  { path: '*', redirect: '/' },
];

const APEX_ALLOWED_ROUTE_NAMES = new Set(['home', 'staking', 'activity']);

const router = new VueRouter({ routes });

router.beforeEach((to, _from, next) => {
  const chain = walletStore.loggedWallet?.chain;
  const isApex = chain === Blockchain.APEX_PRIME || chain === Blockchain.APEX_VECTOR;

  if (isApex && to.name && !APEX_ALLOWED_ROUTE_NAMES.has(to.name)) {
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

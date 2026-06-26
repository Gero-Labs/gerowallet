import VueRouter, { RouteConfig } from 'vue-router';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';

const routes: RouteConfig[] = [
  { path: '/', name: 'home', component: () => import('./pages/HomePage.vue') },
  { path: '/staking', name: 'staking', component: () => import('./pages/StakingPage.vue') },
  { path: '/card', name: 'card', component: () => import('./pages/CardPage.vue') },
  { path: '/market', name: 'market', component: () => import('./pages/MarketPage.vue') },
  { path: '/cashback', name: 'cashback', component: () => import('./pages/CashbackPage.vue') },
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
  next();
});

export default router;

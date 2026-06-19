import VueRouter, { RouteConfig } from 'vue-router';

const routes: RouteConfig[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('./pages/HomePage.vue'),
  },
  {
    path: '/staking',
    name: 'staking',
    component: () => import('./pages/StakingPage.vue'),
  },
  {
    path: '/card',
    name: 'card',
    component: () => import('./pages/CardPage.vue'),
  },
  {
    path: '/market',
    name: 'market',
    component: () => import('./pages/MarketPage.vue'),
  },
  {
    path: '/cashback',
    name: 'cashback',
    component: () => import('./pages/CashbackPage.vue'),
  },
  {
    path: '/perps',
    name: 'perps',
    component: () => import('./pages/PerpetualsPage.vue'),
  },
  {
    path: '/vaults',
    name: 'vaults',
    component: () => import('./pages/VaultsPage.vue'),
  },
  {
    path: '/activity',
    name: 'activity',
    component: () => import('./pages/ActivityPage.vue'),
  },
  {
    path: '*',
    redirect: '/',
  },
];

const router = new VueRouter({
  routes,
});

export default router;

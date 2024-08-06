import VueRouter, {NavigationGuardNext, Route} from 'vue-router';

import { useStore } from '@/store';
import Welcome from '@/modules/welcome/views/Welcome.vue';
import BlankLayout from '@/modules/navigation/layouts/BlankLayout.vue';
import Dashboard from '@/modules/dashboard/views/Dashboard.vue';
import ContentLayout from '@/modules/navigation/layouts/ContentLayout.vue';
import Staking from "@/modules/staking/Staking.vue";
import DappConnect from "@/popup/modules/views/DappConnect.vue";
import PopupLayout from "@/modules/navigation/layouts/PopupLayout.vue";
import DappSignData from '@/popup/modules/views/DappSignData.vue';
import SignTx from '@/popup/modules/views/SignTx.vue';
import zkFiat from "@/modules/zkFiat/zkFiat.vue";
import Cashback from "@/modules/cashback/Cashback.vue";

const routes = [
  {
    path: '/',
    name: 'dashboard',
    component: Dashboard,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/welcome',
    name: 'welcome',
    component: Welcome,
    meta: {
      layout: BlankLayout,
    },
  },
  {
    path: '/market',
    name: 'market',
    component: Dashboard,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/swap',
    name: 'swap',
    component: Dashboard,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/staking',
    name: 'staking',
    component: Staking,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/cashback',
    name: 'cashback',
    component: Cashback,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/zkFiat',
    name: 'zkFiat',
    component: zkFiat,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/send',
    name: 'send',
    component: Dashboard,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/receive',
    name: 'receive',
    component: Dashboard,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/dapp-connect',
    name: 'dapp-connect',
    component: DappConnect,
    meta: {
      layout: PopupLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/dapp-sign',
    name: 'dapp-sign',
    component: DappSignData,
    meta: {
      layout: PopupLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/sign-tx',
    name: 'sign-tx',
    component: SignTx,
    meta: {
      layout: PopupLayout,
      requiresAuth: true,
    },
  },
  {
    path: '*',
    name: 'other',
    redirect: '/',
  },
];

const router = new VueRouter({
  mode: 'hash',
  // base: process.env['BASE_URL'],
  routes,
});

router.beforeEach(async (to: Route, from: Route, next: NavigationGuardNext) => {
  const store = useStore();
  await store.loadWallets();
  const wallets = store.getWallets;
  if (Array.isArray(wallets) && !wallets.length) {
    await store.loadWallets();
  }
  const isLoggedIn = store.isLoggedIn;
  if (to.matched.some(record => record.meta['requiresAuth'])) {
    // this route requires auth, check if logged in
    // if not, redirect to login page.
    if (!isLoggedIn) {
      next({
        path: '/welcome',
      });
    }
  } else if (to.name === 'welcome' && isLoggedIn) {
    next({
      path: '/',
    });
  }
  next();
});

export default router;

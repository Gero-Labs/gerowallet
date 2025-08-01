import VueRouter, { NavigationGuardNext, Route, RouteRecord } from 'vue-router';

import Welcome from '@/modules/welcome/views/Welcome.vue';
import BlankLayout from '@/modules/navigation/layouts/BlankLayout.vue';
import Dashboard from '@/modules/dashboard/views/Dashboard.vue';
import ContentLayout from '@/modules/navigation/layouts/ContentLayout.vue';
import Staking from "@/modules/staking/Staking.vue";
import DappConnect from "@/popup/modules/views/DappConnect.vue";
import PopupLayout from "@/modules/navigation/layouts/PopupLayout.vue";
import DappSignData from '@/popup/modules/views/DappSignData.vue';
import SignTx from '@/popup/modules/views/SignTx.vue';
import Cashback from "@/modules/cashback/Cashback.vue";
import MediaPlayer from "@/modules/media-player/MediaPlayer.vue";
import Swap from '@/modules/swap/Swap.vue';
import Login from '@/popup/modules/views/Login.vue';
import DevTools from '@/modules/devTools/DevTools.vue';
import Governance from '@/modules/governance/Governance.vue';
import WarningPopUp from '@/popup/modules/views/WarningPopUp.vue';
import Transactions from '@/modules/transactions/Transactions.vue';
import Blog from '@/modules/blog/Blog.vue';
import MultiSig from '@/modules/multisig/views/MultiSig.vue';
import Card from '@/modules/wallet/GeroCard.vue';
import WalletStore from '@/stores/walletStore';

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
    component: Swap,
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
    path: '/governance',
    name: 'governance',
    component: Governance,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/media-player',
    name: 'mediaPlayer',
    component: MediaPlayer,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/blog',
    name: 'blog',
    component: Blog,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/dev-tools',
    name: 'devTools',
    component: DevTools,
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
    path: '/warning',
    name: 'warning',
    component: WarningPopUp,
    meta: {
      layout: PopupLayout,
      requiresAuth: false,
      style: 'warning'
    }
  },
  {
    path: '/transactions',
    name: 'transactions',
    component: Transactions,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/plogin',
    name: 'plogin',
    component: Login,
    meta: {
      layout: PopupLayout,
      requiresAuth: false,
    },
  },
  {
    path: '/multisig',
    name: 'multisig',
    component: MultiSig,
    meta: {
      layout: ContentLayout,
      requiresAuth: false,
    },
  },
  {
    path: '/card',
    name: 'card',
    component: Card,
    meta: {
      layout: ContentLayout,
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
  const isLoggedIn: boolean = !!WalletStore.state.loggedWallet;
  const needsAuth: boolean = to.matched.some((routeRecord: RouteRecord) => routeRecord.meta['requiresAuth']);
  const isWelcome: boolean = to.name === 'welcome';

  if (needsAuth && !isLoggedIn) {
    // not logged in → send to /welcome (with optional redirect)
    let redirectTo = '/welcome';
    if (to.path !== '/') {
      redirectTo += `?redirect=${encodeURIComponent(to.fullPath)}`;
    }
    return next({ path: redirectTo });
  }
  if (isWelcome && isLoggedIn) {
    // already logged in → don’t show welcome again
    return next({ path: '/' });
  }
  next();
});

export default router;

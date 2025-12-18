import VueRouter, { NavigationGuardNext, Route, RouteRecord } from 'vue-router';

// Critical layouts loaded immediately
import BlankLayout from '@/modules/navigation/layouts/BlankLayout.vue';
import ContentLayout from '@/modules/navigation/layouts/ContentLayout.vue';
import PopupLayout from "@/modules/navigation/layouts/PopupLayout.vue";

// Critical parts loaded immediately
import Welcome from '@/modules/welcome/views/Welcome.vue';
import Dashboard from '@/modules/dashboard/views/Dashboard.vue';
import Login from '@/popup/modules/views/Login.vue';

// Lazy loading for other components (saves ~5MB initial load)
const Staking = () => import("@/modules/staking/Staking.vue");
const DappConnect = () => import("@/popup/modules/views/DappConnect.vue");
const DappSignData = () => import('@/popup/modules/views/DappSignData.vue');
const SignTx = () => import('@/popup/modules/views/SignTx.vue');
const Cashback = () => import("@/modules/cashback/Cashback.vue");
const MediaPlayer = () => import("@/modules/media-player/MediaPlayer.vue");
const Swap = () => import('@/modules/swap/Swap.vue');
const DevTools = () => import('@/modules/devTools/DevTools.vue');
const Governance = () => import('@/modules/governance/Governance.vue');
const WarningPopUp = () => import('@/popup/modules/views/WarningPopUp.vue');
const Transactions = () => import('@/modules/transactions/Transactions.vue');
const Blog = () => import('@/modules/blog/Blog.vue');
// const MultiSig = () => import('@/modules/multisig/views/MultiSig.vue'); // Disabled - under maintenance
const Card = () => import('@/modules/wallet/GeroCard.vue');

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
  // MultiSig route disabled - under maintenance
  // {
  //   path: '/multisig',
  //   name: 'multisig',
  //   component: MultiSig,
  //   meta: {
  //     layout: ContentLayout,
  //     requiresAuth: false,
  //   },
  // },
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
  const isLocked: boolean = WalletStore.state.isLocked;
  const needsAuth: boolean = to.matched.some((routeRecord: RouteRecord) => routeRecord.meta['requiresAuth']);
  const isWelcome: boolean = to.name === 'welcome';

  // Prevent redirect loops: if we're already being redirected to welcome, just allow it
  if (isWelcome && from.path === '/') {
    return next();
  }

  if (needsAuth && !isLoggedIn) {
    // not logged in → send to /welcome (with optional redirect)
    let redirectTo = '/welcome';
    if (to.path !== '/') {
      redirectTo += `?redirect=${encodeURIComponent(to.fullPath)}`;
    }
    return next({ path: redirectTo });
  }
  if (isWelcome && isLoggedIn && !isLocked) {
    // already logged in and NOT locked → don't show welcome again
    return next({ path: '/' });
  }
  if (needsAuth && isLocked) {
    // wallet is locked → send to /welcome to unlock
    let redirectTo = '/welcome';
    if (to.path !== '/') {
      redirectTo += `?redirect=${encodeURIComponent(to.fullPath)}`;
    }
    return next({ path: redirectTo });
  }
  next();
});

// Handle navigation errors globally (suppresses redirect errors in console)
router.onError((error) => {
  const isNavigationFailure = error.message.includes('Redirected') || error.message.includes('navigation guard');
  if (!isNavigationFailure) {
    console.error('Router error:', error);
  }
});

export default router;

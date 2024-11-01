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
import MediaPlayer from "@/modules/media-player/MediaPlayer.vue";
import loading from '@/plugins/loading';
import Swap from '@/modules/swap/Swap.vue';
import Login from '@/popup/modules/views/Login.vue';
import DevTools from '@/modules/devTools/DevTools.vue';
import Governance from '@/modules/governance/Governance.vue';
import WarningPopUp from '@/popup/modules/views/warningPopUp.vue';
import ReportWebsite from "@/popup/modules/components/ReportWebsite.vue";
import Transaction from "@/modules/Transaction/Transaction.vue"
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
    path: '/transaction',
    name: 'transaction',
    component: Transaction,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  // {
  //   path: '/transaction',
  //   name: 'transaction',
  //   component: TransactionsN,
  //   meta: {
  //     layout: ContentLayout,
  //     requiresAuth: true,
  //   },
  // },
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
    path: '/media-player',
    name: 'mediaPlayer',
    component: MediaPlayer,
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
    
  },
  {
    path: '/report',
    name: 'report',
    component: ReportWebsite,
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
  loading.setLoading(true);
  const store= useStore();
  await store.loadWallets();
  const wallets: any[] = store.wallets;
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
  loading.setLoading(false);
});

export default router;

import VueRouter, { NavigationGuardNext, Route, RouteRecord } from 'vue-router';
import { Blockchain } from '@/models/types';

// Critical layouts loaded immediately
import BlankLayout from '@/modules/navigation/layouts/BlankLayout.vue';
import ContentLayout from '@/modules/navigation/layouts/ContentLayout.vue';
import PopupLayout from "@/modules/navigation/layouts/PopupLayout.vue";

// Critical parts loaded immediately
import Welcome from '@/modules/welcome/views/Welcome.vue';
import PortfolioPage from '@/modules/portfolio/PortfolioPage.vue';

// Lazy loading for other components (saves ~5MB initial load)
const Staking = () => import("@/modules/staking/Staking.vue");
const DappConnect = () => import("@/popup/modules/views/DappConnect.vue");
const DappSignData = () => import('@/popup/modules/views/DappSignData.vue');
const SignTx = () => import('@/popup/modules/views/SignTx.vue');
const Cashback = () => import("@/modules/cashback/Cashback.vue");
const MediaPlayer = () => import("@/modules/media-player/MediaPlayer.vue");
const Swap = () => import('@/modules/swap/Swap.vue');
// Market.vue no longer used as standalone route — unified into PortfolioPage
const DevTools = () => import('@/modules/devTools/DevTools.vue');
const Governance = () => import('@/modules/governance/Governance.vue');
const WarningPopUp = () => import('@/popup/modules/views/WarningPopUp.vue');
const Transactions = () => import('@/modules/transactions/Transactions.vue');
const Blog = () => import('@/modules/blog/Blog.vue');
const BlogPost = () => import('@/modules/blog/BlogPost.vue');
const Card = () => import('@/modules/wallet/GeroCard.vue');
const PassKeyAuth = () => import('@/modules/authentication/views/PassKeyAuth.vue');
const LedgerBleSign = () => import('@/modules/authentication/views/LedgerBleSign.vue');
const GoMining = () => import('@/modules/gomining/GoMining.vue');
const BabylonStaking = () => import('@/modules/babylon/BabylonStaking.vue');
const Ordinals = () => import('@/modules/ordinals/Ordinals.vue');
const ThorchainSwap = () => import('@/modules/thorchain/ThorchainSwap.vue');
const MempoolExplorer = () => import('@/modules/mempool/MempoolExplorer.vue');
const LightningLnurl = () => import('@/modules/lightning/LightningLnurl.vue');
const BitcoinSignPsbt = () => import('@/popup/modules/views/BitcoinSignPsbt.vue');
const BitcoinSignMessage = () => import('@/popup/modules/views/BitcoinSignMessage.vue');
const WCSessionProposal = () => import('@/popup/modules/views/WCSessionProposal.vue');
const PoolOperator = () => import('@/modules/pool-operator/PoolOperator.vue');
const NexusPage = () => import('@/modules/nexus/NexusPage.vue');
const ProofServerPage = () => import('@/modules/midnight/ProofServerPage.vue');

import WalletStore from '@/stores/walletStore';
import featureFlagsStore from '@/stores/featureFlagsStore';
import networks from '@/utils/networks';

const routes = [
  {
    path: '/',
    name: 'dashboard',
    component: PortfolioPage,
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
    redirect: '/?view=all',
  },
  {
    path: '/swap',
    name: 'swap',
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
    path: '/nexus',
    name: 'nexus',
    component: NexusPage,
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
    path: '/pool-operator',
    name: 'poolOperator',
    component: PoolOperator,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/proof-server',
    name: 'proofServer',
    component: ProofServerPage,
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
    path: '/blog/:slug',
    name: 'blog-post',
    component: BlogPost,
    props: true,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/copilot-feed',
    name: 'copilotFeed',
    component: () => import('@/sidepanel/pages/FeedPage.vue'),
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
    path: '/sign-bitcoin-psbt',
    name: 'sign-bitcoin-psbt',
    component: BitcoinSignPsbt,
    meta: {
      layout: PopupLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/sign-bitcoin-message',
    name: 'sign-bitcoin-message',
    component: BitcoinSignMessage,
    meta: {
      layout: PopupLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/wc-session-proposal',
    name: 'wc-session-proposal',
    component: WCSessionProposal,
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
    path: '/card',
    name: 'card',
    component: Card,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/passkey-auth',
    name: 'passkey-auth',
    component: PassKeyAuth,
    meta: {
      layout: BlankLayout,
      requiresAuth: true,
    },
  },
  {
    // Popup window that runs the Web Bluetooth chooser for Ledger signing —
    // Chrome will not present that chooser inside a side panel. Opened by
    // DAppOverlay.signLedger; see LedgerBleSign.vue for the message protocol.
    path: '/ledger-ble-sign',
    name: 'ledger-ble-sign',
    component: LedgerBleSign,
    meta: {
      layout: BlankLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/gomining',
    name: 'gomining',
    component: GoMining,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/babylon',
    name: 'babylon',
    component: BabylonStaking,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/ordinals',
    name: 'ordinals',
    component: Ordinals,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/thorchain',
    name: 'thorchain',
    component: ThorchainSwap,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/mempool',
    name: 'mempool',
    component: MempoolExplorer,
    meta: {
      layout: ContentLayout,
      requiresAuth: true,
    },
  },
  {
    path: '/lightning',
    name: 'lightning',
    component: LightningLnurl,
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

/**
 * Check if a route is under maintenance
 * This matches the underMaintenance logic from NavigationDrawer
 */
function isRouteUnderMaintenance(routeName: string | null | undefined): boolean {
  if (!routeName) return false;

  // Route-specific maintenance checks
  switch (routeName) {
    case 'card':
      // Gero Card is under maintenance if feature flag is disabled
      return !featureFlagsStore.isGeroCardEnabled();

    case 'gomining':
      // GoMining is under maintenance if feature flag is disabled
      return !featureFlagsStore.isGoMiningEnabled();

    case 'poolOperator':
      // Pool Operator dashboard gated by feature flag
      return !featureFlagsStore.isPoolOperatorEnabled();

    case 'copilotFeed':
      // Gero Copilot feed gated by the master feature flag (ships dark)
      return !featureFlagsStore.isCopilotEnabled();

    // Add other routes that can be under maintenance here
    // case 'someOtherRoute':
    //   return !featureFlagsStore.isSomeOtherFeatureEnabled();

    default:
      return false;
  }
}

router.beforeEach(async (to: Route, from: Route, next: NavigationGuardNext) => {
  const isLoggedIn: boolean = !!WalletStore.state.loggedWallet;
  const isLocked: boolean = WalletStore.state.isLocked;
  const isSyncing: boolean = WalletStore.state.isSyncing;
  const needsAuth: boolean = to.matched.some((routeRecord: RouteRecord) => routeRecord.meta['requiresAuth']);
  const isWelcome: boolean = to.name === 'welcome';
  console.log(`[ROUTER] ${from.path} → ${to.path} | loggedIn=${isLoggedIn} locked=${isLocked} syncing=${isSyncing} welcome=${isWelcome}`);

  // Prevent redirect loops: if we're already being redirected to welcome, just allow it
  if (isWelcome && from.path === '/') {
    return next();
  }

  if (needsAuth && !isLoggedIn && to.name !== 'passkey-auth') {
    // not logged in → send to /welcome (with optional redirect).
    // EXCEPT the passkey-auth popup: in a pre-switch/first-login unlock it resolves
    // its target wallet from the `walletId` query param, so it can run before any
    // wallet is the active/logged-in one.
    let redirectTo = '/welcome';
    if (to.path !== '/') {
      redirectTo += `?redirect=${encodeURIComponent(to.fullPath)}`;
    }
    return next({ path: redirectTo });
  }
  // ?addWallet=1 is the escape hatch for "Enter Setup" (WalletSelector.vue):
  // adding a wallet from an already-logged-in session used to force a global
  // logout first purely to get past this guard, which killed the caller's
  // active session (and every other open tab's) as collateral damage. This
  // lets the new tab reach /welcome without touching anyone else's state.
  if (isWelcome && isLoggedIn && !isLocked && !isSyncing && to.query['addWallet'] !== '1') {
    // already logged in, NOT locked, NOT syncing → don't show welcome again
    return next({ path: '/' });
  }
  if (needsAuth && isSyncing && to.name !== 'ledger-ble-sign') {
    // Syncing wallet — stay on welcome until done.
    // EXCEPT the ledger-ble-sign popup: its transaction is already built and
    // handed over by the opener, so a background sync is irrelevant to it, and
    // bouncing the route would leave the side panel waiting on a result that
    // can never arrive.
    return next({ path: '/welcome' });
  }
  if (needsAuth && isLocked && to.name !== 'passkey-auth' && to.name !== 'ledger-ble-sign') {
    // wallet is locked → send to /welcome to unlock.
    // EXCEPT the passkey-auth popup: it IS the unlock ceremony (runs WebAuthn in a
    // popup window because the side panel can't), so it must render while locked.
    // It still requires a logged-in wallet via the `needsAuth && !isLoggedIn` check above.
    // EXCEPT ledger-ble-sign for a different reason: the wallet can auto-lock in the
    // moment between the side panel opening that window and the window resolving its
    // route. Redirecting is an in-app next(), so the window stays open showing
    // /welcome — nothing closes it, so tabs.onRemoved never fires, and the side panel
    // waits out its whole timeout for a result that can never come.
    let redirectTo = '/welcome';
    if (to.path !== '/') {
      redirectTo += `?redirect=${encodeURIComponent(to.fullPath)}`;
    }
    return next({ path: redirectTo });
  }

  // Check chain/network feature support for restricted routes
  // Note: Some routes (e.g. 'card') are also checked by isRouteUnderMaintenance below.
  // These are intentionally dual-gated: network support (here) vs. feature flag/maintenance (below).
  if (isLoggedIn) {
    const { chain, network } = WalletStore.state.loggedWallet;
    const routeNetworkGuards: Record<string, (c: string, n: string) => boolean> = {
      cashback: (c, n) => networks.resolveCashbackSupport(c, n),
      governance: (c, n) => networks.resolveGovernanceSupport(c, n),
      staking: (c, n) => networks.resolveStakingSupport(c, n),
      market: (c, n) => networks.resolveSwapSupport(c, n),
      transactions: (c, n) => networks.resolveTransactionsSupport(c, n),
      card: (c, n) => networks.resolveGeroCardSupport(c, n),
      // Bitcoin-dependent routes — gated by both the chain's own support flag AND the
      // isBitcoinEnabled feature flag. The flag is the master gate for Bitcoin (it replaced
      // removing the networks.ts entries): with it OFF these must redirect to '/' even for an
      // existing BTC wallet created while it was ON, closing the direct-URL gap for
      // #/thorchain etc. (Same AND-the-flag pattern as poolOperator below.)
      gomining: (c, n) => networks.resolveGoMiningSupport(c, n) && featureFlagsStore.isBitcoinEnabled(),
      babylon: (c, n) => networks.resolveBabylonSupport(c, n) && featureFlagsStore.isBitcoinEnabled(),
      ordinals: (c, n) => networks.resolveOrdinalsSupport(c, n) && featureFlagsStore.isBitcoinEnabled(),
      thorchain: (c, n) => networks.resolveThorchainSupport(c, n) && featureFlagsStore.isBitcoinEnabled(),
      mempool: (c, n) => networks.resolveMempoolSupport(c, n) && featureFlagsStore.isBitcoinEnabled(),
      lightning: (c, n) => networks.resolveLightningSupport(c, n) && featureFlagsStore.isBitcoinEnabled(),
      // Pool Operator — gated by staking support + the isPoolOperatorEnabled flag,
      // matching the NavigationDrawer item's own `enabled` condition. Returns the
      // live values (not a hard false) so gero-sync can turn it on without a release;
      // falsy => redirect to '/'. (Same pattern as copilotFeed below.)
      poolOperator: (c, n) => networks.resolveStakingSupport(c, n) && featureFlagsStore.isPoolOperatorEnabled(),
      // Copilot feed — closes the cold-refresh window before flags init. Returns
      // the live flag (not a hard false) so the maintenance case can turn it ON
      // once gero-sync enables it. Falsy => redirect to '/'.
      copilotFeed: () => featureFlagsStore.isCopilotEnabled(),
      // Proof server settings only apply to Midnight wallets (shielded-proving
      // config). Direct-URL visits from a non-Midnight wallet redirect home.
      proofServer: (c) => c === Blockchain.MIDNIGHT,
    };
    const guard = routeNetworkGuards[to.name];
    if (guard && !guard(chain, network)) {
      return next({ path: '/' });
    }
  }

  // Check if the route is under maintenance
  // Only check maintenance if feature flags are initialized to avoid false redirects on page refresh
  if (featureFlagsStore.state.isInitialized && isRouteUnderMaintenance(to.name)) {
    console.warn(`🚧 Route "${to.name}" is under maintenance. Redirecting to dashboard.`);
    return next({ path: '/' });
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

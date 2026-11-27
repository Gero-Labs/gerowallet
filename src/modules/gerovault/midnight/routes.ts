/**
 * Routes of GeroVault on Midnight (contract vaults), under `/midnight-vaults`.
 *
 * `router.ts` registers one parent at `GEROVAULT_MIDNIGHT_ROOT_PATH` with these children, and
 * gates every name in `GEROVAULT_MIDNIGHT_ROUTE_NAMES` on a Midnight wallet, the build-time network
 * list and `isGeroVaultMidnightEnabled`. Each child loads lazily a component in the folder of the
 * screen that owns it:
 * - `create/`: the create flow and the import of a vault;
 * - `vault/`: the vaults home, the vault screen with its tabs, and the deposit;
 * - `approve/`: signing a request file, a new request, one request's approvals and its submit;
 * - `recovery/`: cancelling a recovery and the move after one;
 * - `guardian/`: guardian mode, enrolment and signing as a guardian.
 *
 * A screen replaces its own files; only this file names the paths.
 */
import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router';
import { lazyPage } from '@/modules/navigation/lazyPage';

export const GEROVAULT_MIDNIGHT_ROOT_PATH = '/midnight-vaults';

/** The vault screen's tabs, in display order. */
export const GEROVAULT_MIDNIGHT_TABS = Object.freeze(['overview', 'policy', 'recovery', 'technical', 'history'] as const);
export type GerovaultMidnightTab = (typeof GEROVAULT_MIDNIGHT_TABS)[number];

/** Route name of each tab, a child of `/midnight-vaults/:vaultId`. */
export const GEROVAULT_MIDNIGHT_TAB_ROUTES: Readonly<Record<GerovaultMidnightTab, string>> = Object.freeze({
  overview: 'gerovaultMidnightOverview',
  policy: 'gerovaultMidnightPolicy',
  recovery: 'gerovaultMidnightRecovery',
  technical: 'gerovaultMidnightTechnical',
  history: 'gerovaultMidnightHistory',
});

/** Every other route name. Query parameters each page reads are named beside it. */
export const GEROVAULT_MIDNIGHT_ROUTES = Object.freeze({
  /** `/midnight-vaults`: this seed's vaults, the vaults it guards, Create and Import. */
  home: 'gerovaultMidnight',
  /** `/midnight-vaults/create`. */
  create: 'gerovaultMidnightCreate',
  /** `/midnight-vaults/import`: by vault file, by contract address, or a restored package's review. */
  import: 'gerovaultMidnightImport',
  /** `/midnight-vaults/sign`: an owner opens a request file and signs it (`?vaultId=` preselects the vault). */
  sign: 'gerovaultMidnightSign',
  /** `/midnight-vaults/guardian`: guardian mode. */
  guardian: 'gerovaultMidnightGuardian',
  /** `/midnight-vaults/guardian/enrol`: a guardian's card, code check and backup. */
  guardianEnrol: 'gerovaultMidnightGuardianEnrol',
  /** `/midnight-vaults/guardian/sign`: a guardian reviews a recovery request, with its code, and signs. */
  guardianSign: 'gerovaultMidnightGuardianSign',
  /** `/midnight-vaults/:vaultId`: redirects to the overview tab. */
  vault: 'gerovaultMidnightVault',
  /** `/midnight-vaults/:vaultId/deposit`: a deposit from this wallet (a contract call). */
  deposit: 'gerovaultMidnightDeposit',
  /** `/midnight-vaults/:vaultId/request`: a new request (`?kind=` a `MidnightRequestKind`, payout by default). */
  newRequest: 'gerovaultMidnightNewRequest',
  /** `/midnight-vaults/:vaultId/requests/:digest`: one request, its approvals, import and submit. */
  request: 'gerovaultMidnightRequest',
  /** `/midnight-vaults/:vaultId/cancel-recovery`: the owners' cancel of a pending recovery. */
  cancelRecovery: 'gerovaultMidnightCancelRecovery',
  /** `/midnight-vaults/:vaultId/move`: after a recovery, the guided move to a new vault. */
  move: 'gerovaultMidnightMove',
} as const);

/** Every route name under `/midnight-vaults`: all of them share one gate. */
export const GEROVAULT_MIDNIGHT_ROUTE_NAMES: readonly string[] = Object.freeze([
  ...Object.values(GEROVAULT_MIDNIGHT_ROUTES),
  ...Object.values(GEROVAULT_MIDNIGHT_TAB_ROUTES),
]);

/** The tab a tab route shows, or null for any other route. */
export function gerovaultMidnightTabOf(name: string | null | undefined): GerovaultMidnightTab | null {
  return GEROVAULT_MIDNIGHT_TABS.find(tab => GEROVAULT_MIDNIGHT_TAB_ROUTES[tab] === name) ?? null;
}

const R = GEROVAULT_MIDNIGHT_ROUTES;
const TABS = GEROVAULT_MIDNIGHT_TAB_ROUTES;

/** The children of the `/midnight-vaults` parent in `router.ts`. */
export const GEROVAULT_MIDNIGHT_CHILD_ROUTES: RouteRecordRaw[] = [
  { path: '', name: R.home, component: lazyPage(() => import('./vault/MidnightVaultsHome.vue')) },
  { path: 'create', name: R.create, component: lazyPage(() => import('./create/MidnightVaultCreate.vue')) },
  { path: 'import', name: R.import, component: lazyPage(() => import('./create/MidnightVaultImport.vue')) },
  { path: 'sign', name: R.sign, component: lazyPage(() => import('./approve/MidnightSignRequest.vue')) },
  { path: 'guardian', name: R.guardian, component: lazyPage(() => import('./guardian/MidnightGuardianHome.vue')) },
  { path: 'guardian/enrol', name: R.guardianEnrol, component: lazyPage(() => import('./guardian/MidnightGuardianEnrol.vue')) },
  { path: 'guardian/sign', name: R.guardianSign, component: lazyPage(() => import('./guardian/MidnightGuardianSign.vue')) },
  {
    // The vault screen; its tabs are child routes rendered inside it.
    path: ':vaultId',
    component: lazyPage(() => import('./vault/MidnightVaultScreen.vue')),
    children: [
      { path: '', name: R.vault, redirect: (to: RouteLocationNormalized) => ({ name: TABS.overview, params: to.params }) },
      { path: 'overview', name: TABS.overview, component: lazyPage(() => import('./vault/MidnightVaultOverviewTab.vue')) },
      { path: 'policy', name: TABS.policy, component: lazyPage(() => import('./vault/MidnightVaultPolicyTab.vue')) },
      { path: 'recovery', name: TABS.recovery, component: lazyPage(() => import('./vault/MidnightVaultRecoveryTab.vue')) },
      { path: 'technical', name: TABS.technical, component: lazyPage(() => import('./vault/MidnightVaultTechnicalTab.vue')) },
      { path: 'history', name: TABS.history, component: lazyPage(() => import('./vault/MidnightVaultHistoryTab.vue')) },
    ],
  },
  // Pages of their own, outside the vault's tabs.
  { path: ':vaultId/deposit', name: R.deposit, component: lazyPage(() => import('./vault/MidnightVaultDeposit.vue')) },
  { path: ':vaultId/request', name: R.newRequest, component: lazyPage(() => import('./approve/MidnightNewRequest.vue')) },
  { path: ':vaultId/requests/:digest', name: R.request, component: lazyPage(() => import('./approve/MidnightRequestDetail.vue')) },
  { path: ':vaultId/cancel-recovery', name: R.cancelRecovery, component: lazyPage(() => import('./recovery/MidnightCancelRecovery.vue')) },
  { path: ':vaultId/move', name: R.move, component: lazyPage(() => import('./recovery/MidnightVaultMove.vue')) },
];

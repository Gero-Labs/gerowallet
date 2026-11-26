import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router, RouterOptions, RouteRecordRaw } from 'vue-router';
import { Blockchain } from '@/models/types';

const state = vi.hoisted(() => ({
  wallet: { loggedWallet: null as { chain: string; network: string } | null, isLocked: false, isSyncing: false },
  enabled: true,
  supported: true,
}));
vi.mock('vue-router', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return { ...actual, createRouter: (options: RouterOptions) => actual.createRouter({
    ...options, history: actual.createMemoryHistory(),
    // Exercise production route records, redirects and guards without loading UI services.
    routes: options.routes.map(route => route.redirect ? route : { ...route, component: { render: () => null } } as RouteRecordRaw),
  }) };
});
vi.mock('@/stores/walletStore', () => ({ default: { state: state.wallet }, walletStore: state.wallet }));
vi.mock('@/stores/featureFlagsStore', () => {
  const flags = { state: { isInitialized: true }, ...Object.fromEntries([
    'GeroCard', 'GoMining', 'PoolOperator', 'RealFi', 'Governance', 'GovernanceVoting', 'Copilot', 'Bitcoin', 'HelpCenter', 'Vaults',
  ].map(key => [`is${key}Enabled`, () => state.enabled])) };
  return { default: flags, featureFlagsStore: flags };
});
vi.mock('@/utils/networks', () => ({ default: Object.fromEntries([
  'Cashback', 'Governance', 'Staking', 'Swap', 'Transactions', 'GeroCard', 'GoMining', 'Babylon', 'Ordinals', 'Thorchain', 'Mempool', 'Lightning', 'RealFi',
].map(key => [`resolve${key}Support`, () => state.supported])) }));
vi.mock('@/modules/help/HelpLayout.vue', () => ({ default: {} }));
vi.mock('@/modules/navigation/layouts/BlankLayout.vue', () => ({ default: {} }));
vi.mock('@/modules/navigation/layouts/ContentLayout.vue', () => ({ default: {} }));
vi.mock('@/modules/navigation/layouts/PopupLayout.vue', () => ({ default: {} }));
vi.mock('@/modules/welcome/views/Welcome.vue', () => ({ default: {} }));
vi.mock('@/modules/portfolio/PortfolioPage.vue', () => ({ default: {} }));

let router: Router;
beforeEach(async () => {
  vi.resetModules();
  state.wallet.loggedWallet = null;
  state.wallet.isLocked = false;
  state.wallet.isSyncing = false;
  state.enabled = true;
  state.supported = true;
  router = (await import('./router')).default;
});

describe('production options router guards', () => {
  it('preserves the full requested route through authentication and accepts public help while locked', async () => {
    await router.push('/transactions?tab=utxos&tx=abc');
    expect(router.currentRoute.value.path).toBe('/welcome');
    expect(router.currentRoute.value.query['redirect']).toBe('/transactions?tab=utxos&tx=abc');
    state.wallet.isLocked = true;
    await router.push('/help/articles/restore?basic=1');
    expect(router.currentRoute.value.fullPath).toBe('/help/articles/restore?basic=1');
  });
  it('retains the unlock ceremony before login, and the Ledger ceremony across lock/sync', async () => {
    state.wallet.isLocked = true;
    await router.push('/passkey-auth?walletId=7');
    expect(router.currentRoute.value.name).toBe('passkey-auth');
    state.wallet.loggedWallet = { chain: Blockchain.CARDANO, network: 'mainnet' };
    state.wallet.isSyncing = true;
    await router.push('/ledger-ble-sign?request=abc');
    expect(router.currentRoute.value.name).toBe('ledger-ble-sign');
    await router.push('/transactions');
    expect(router.currentRoute.value.path).toBe('/welcome');
  });
  it('keeps add-wallet setup reachable and preserves governance query redirects', async () => {
    state.wallet.loggedWallet = { chain: Blockchain.CARDANO, network: 'mainnet' };
    await router.push('/welcome?addWallet=1');
    expect(router.currentRoute.value.path).toBe('/welcome');
    await router.push('/governance?drep=abc');
    expect(router.currentRoute.value.name).toBe('governanceDReps');
    expect(router.currentRoute.value.query['drep']).toBe('abc');
  });
  it('blocks direct URLs by network and feature flags, and resolves the Router4 catch-all', async () => {
    state.wallet.loggedWallet = { chain: Blockchain.CARDANO, network: 'mainnet' };
    state.supported = false;
    await router.push('/swap');
    expect(router.currentRoute.value.path).toBe('/');
    state.supported = true;
    state.enabled = false;
    await router.push('/thorchain');
    expect(router.currentRoute.value.path).toBe('/');
    await router.push('/missing/deep/path');
    expect(router.currentRoute.value.path).toBe('/');
  });
  it('redirects the retired /market route to the dashboard market view', async () => {
    state.wallet.loggedWallet = { chain: Blockchain.CARDANO, network: 'mainnet' };
    await router.push('/market');
    expect(router.currentRoute.value.path).toBe('/');
    expect(router.currentRoute.value.query['view']).toBe('all');
  });
});

describe('GeroVault routes', () => {
  const VAULT_PATHS = [
    '/vaults', '/vaults/create', '/vaults/abc', '/vaults/abc/proposals', '/vaults/abc/policy', '/vaults/abc/history', '/vaults/abc/settings',
    '/vaults/abc/spend', '/vaults/abc/import-signatures',
  ];

  it.each(VAULT_PATHS)('sends %s home while the flag is off', async path => {
    state.wallet.loggedWallet = { chain: Blockchain.CARDANO, network: 'mainnet' };
    state.enabled = false;
    await router.push(path);
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('opens the overview, the create placeholder and each vault tab with the flag on', async () => {
    state.wallet.loggedWallet = { chain: Blockchain.CARDANO, network: 'preprod' };
    await router.push('/vaults');
    expect(router.currentRoute.value.name).toBe('gerovault');
    await router.push('/vaults/create');
    expect(router.currentRoute.value.name).toBe('gerovaultCreate');
    for (const [tab, name] of [['proposals', 'gerovaultProposals'], ['policy', 'gerovaultPolicy'], ['history', 'gerovaultHistory'], ['settings', 'gerovaultSettings']]) {
      await router.push(`/vaults/abc/${tab}`);
      expect(router.currentRoute.value.name).toBe(name);
      expect(router.currentRoute.value.params['vaultId']).toBe('abc');
    }
  });

  it('opens the spend and import-signatures pages of a vault with the flag on', async () => {
    state.wallet.loggedWallet = { chain: Blockchain.CARDANO, network: 'preprod' };
    for (const [page, name] of [['spend', 'gerovaultSpend'], ['import-signatures', 'gerovaultImportSignatures']]) {
      await router.push(`/vaults/abc/${page}`);
      expect(router.currentRoute.value.name).toBe(name);
      expect(router.currentRoute.value.params['vaultId']).toBe('abc');
    }
  });

  it('opens a vault on its proposals tab', async () => {
    state.wallet.loggedWallet = { chain: Blockchain.CARDANO, network: 'mainnet' };
    await router.push('/vaults/abc');
    expect(router.currentRoute.value.path).toBe('/vaults/abc/proposals');
  });

  it('keeps every vault route to Cardano wallets', async () => {
    state.wallet.loggedWallet = { chain: Blockchain.MIDNIGHT, network: 'preprod' };
    for (const path of VAULT_PATHS) {
      await router.push('/staking');
      await router.push(path);
      expect(router.currentRoute.value.path).toBe('/');
    }
  });

  it('asks for a login first, like any wallet page', async () => {
    await router.push('/vaults/abc/policy');
    expect(router.currentRoute.value.path).toBe('/welcome');
    expect(router.currentRoute.value.query['redirect']).toBe('/vaults/abc/policy');
  });
});

describe('production sidepanel router gates', () => {
  it('retains staking network checks and the feed feature gate', async () => {
    router = (await import('@/sidepanel/router')).default;
    state.wallet.loggedWallet = { chain: Blockchain.CARDANO, network: 'mainnet' };
    await router.push('/activity');
    expect(router.currentRoute.value.name).toBe('activity');
    state.supported = false;
    await router.push('/staking');
    expect(router.currentRoute.value.name).toBe('home');
    state.enabled = false;
    await router.push('/feed');
    expect(router.currentRoute.value.name).toBe('home');
    state.enabled = true;
    await router.push('/feed');
    expect(router.currentRoute.value.name).toBe('feed');
  });
});

// The scaffolding's placeholders under /midnight-vaults: every route renders its own file, the vault
// screen renders its tabs, and the vault screens host the other screens' components under the names
// contracts.ts fixes. No data.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { GEROVAULT_MIDNIGHT_CHILD_ROUTES, GEROVAULT_MIDNIGHT_ROOT_PATH, GEROVAULT_MIDNIGHT_ROUTES, GEROVAULT_MIDNIGHT_TAB_ROUTES, gerovaultMidnightTabOf } from './routes';
import { MIDNIGHT_VAULT_HOSTED } from './contracts';

vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { id: 7, secretsWalletId: 3, chain: 'Midnight', network: 'Preprod' } } }));

enableAutoUnmount(afterEach);

const $t = (key: string): string => key;

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }, { path: GEROVAULT_MIDNIGHT_ROOT_PATH, children: GEROVAULT_MIDNIGHT_CHILD_ROUTES }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: { plugins: [createTestVuetify(), router], config: { globalProperties: mockGlobalProperties({ $t }) } },
  });
  await flushPromises();
  return { wrapper, router };
}

const PAGES: readonly [string, string][] = [
  ['/midnight-vaults', 'MidnightVaultsHome'],
  ['/midnight-vaults/create', 'MidnightVaultCreate'],
  ['/midnight-vaults/import', 'MidnightVaultImport'],
  ['/midnight-vaults/sign', 'MidnightSignRequest'],
  ['/midnight-vaults/guardian', 'MidnightGuardianHome'],
  ['/midnight-vaults/guardian/enrol', 'MidnightGuardianEnrol'],
  ['/midnight-vaults/guardian/sign', 'MidnightGuardianSign'],
  ['/midnight-vaults/abc/deposit', 'MidnightVaultDeposit'],
  ['/midnight-vaults/abc/request', 'MidnightNewRequest'],
  ['/midnight-vaults/abc/requests/def', 'MidnightRequestDetail'],
  ['/midnight-vaults/abc/cancel-recovery', 'MidnightCancelRecovery'],
  ['/midnight-vaults/abc/move', 'MidnightVaultMove'],
];

describe('the Midnight vault placeholders', () => {
  it.each(PAGES)('%s renders %s', async (path, name) => {
    const { wrapper } = await mountAt(path);
    expect(wrapper.findComponent({ name }).exists()).toBe(true);
    expect(wrapper.text()).toContain('common.comingSoon');
  });

  it('opens a vault on its overview tab, inside the vault screen, with the recovery banners hosted', async () => {
    const { wrapper, router } = await mountAt('/midnight-vaults/abc');
    expect(router.currentRoute.value.name).toBe(GEROVAULT_MIDNIGHT_TAB_ROUTES.overview);
    const screen = wrapper.findComponent({ name: 'MidnightVaultScreen' });
    expect(screen.exists()).toBe(true);
    for (const name of [MIDNIGHT_VAULT_HOSTED.recoveryAlert.name, MIDNIGHT_VAULT_HOSTED.moveBanner.name]) {
      expect(screen.findComponent({ name }).props()).toEqual({ walletId: 3, vaultId: 'abc' });
    }
    expect(screen.findComponent({ name: MIDNIGHT_VAULT_HOSTED.requestList.name }).props()).toEqual({ walletId: 3, vaultId: 'abc' });
  });

  it.each([
    ['policy', 'MidnightVaultPolicyTab'],
    ['recovery', 'MidnightVaultRecoveryTab'],
    ['technical', 'MidnightVaultTechnicalTab'],
    ['history', 'MidnightVaultHistoryTab'],
  ] as const)('renders the %s tab inside the vault screen', async (tab, name) => {
    const { wrapper, router } = await mountAt(`/midnight-vaults/abc/${tab}`);
    expect(gerovaultMidnightTabOf(String(router.currentRoute.value.name))).toBe(tab);
    expect(wrapper.findComponent({ name: 'MidnightVaultScreen' }).findComponent({ name }).exists()).toBe(true);
  });

  it('shows the recovery panel on the Recovery tab and the guardian list on the home', async () => {
    const recovery = await mountAt('/midnight-vaults/abc/recovery');
    expect(recovery.wrapper.findComponent({ name: MIDNIGHT_VAULT_HOSTED.recoveryPanel.name }).props()).toEqual({ walletId: 3, vaultId: 'abc' });
    const home = await mountAt('/midnight-vaults');
    expect(home.router.currentRoute.value.name).toBe(GEROVAULT_MIDNIGHT_ROUTES.home);
    expect(home.wrapper.findComponent({ name: MIDNIGHT_VAULT_HOSTED.guardianList.name }).props()).toEqual({ walletId: 3 });
  });
});

describe('the hosted components', () => {
  const files = import.meta.glob<{ default: { name?: string } }>('./*/*.vue', { eager: true });

  it.each(Object.entries(MIDNIGHT_VAULT_HOSTED))('%s is the file and component contracts.ts names', (_key, { name, file }) => {
    const module = files[file.replace('src/modules/gerovault/midnight/', './')];
    expect(module, file).toBeDefined();
    expect(module!.default.name).toBe(name);
  });
});

// The vault list and the vault screen over an in-memory store and a mock chain reader: what each
// state shows, the Create and Spend links, the locked UTxOs, the funding banner, the Details layer,
// the tabs, and accepting a restored candidate.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type RouteLocationNormalized } from 'vue-router';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { displayLabel } from '@/shared/gerovault';
import type { VaultChainReader, VaultRecord, VaultStore } from '@/modules/gerovault/contracts';
import GerovaultOverview from '@/modules/gerovault/views/GerovaultOverview.vue';
import GerovaultVault from '@/modules/gerovault/views/GerovaultVault.vue';
import GerovaultTabPanel from '@/modules/gerovault/views/GerovaultTabPanel.vue';
import {
  GEROVAULT_CREATE_ROUTE,
  GEROVAULT_OVERVIEW_ROUTE,
  GEROVAULT_SPEND_ROUTE,
  GEROVAULT_TAB_ROUTES,
  GEROVAULT_TABS,
  GEROVAULT_VAULT_ROUTE,
} from '@/modules/gerovault/gerovaultRoutes';
import { GEROVAULT_CHAIN_READER, GEROVAULT_STORE, GEROVAULT_WALLET } from './context';
import { historyEntries, memoryStore, mockReader, utxo, vaultFixture, type VaultFixture } from './__fixtures__/vaultFixtures';

enableAutoUnmount(afterEach);

/** Keys, with their parameters, so a test can see what a string was given. */
const $t = (key: string, params?: Record<string, unknown>): string => (params ? `${key} ${JSON.stringify(params)}` : key);
const blank = { render: () => null };

let f: VaultFixture;

beforeAll(async () => {
  f = await vaultFixture();
});

beforeEach(() => {
  localStorage.clear();
});

async function mountAt(path: string, options: { store: VaultStore; reader?: VaultChainReader; wallet?: boolean }) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: blank },
      {
        path: '/vaults',
        children: [
          { path: '', name: GEROVAULT_OVERVIEW_ROUTE, component: GerovaultOverview },
          { path: 'create', name: GEROVAULT_CREATE_ROUTE, component: blank },
          {
            path: ':vaultId',
            component: GerovaultVault,
            children: [
              { path: '', name: GEROVAULT_VAULT_ROUTE, redirect: (to: RouteLocationNormalized) => ({ name: GEROVAULT_TAB_ROUTES.proposals, params: to.params }) },
              ...GEROVAULT_TABS.map(tab => ({ path: tab, name: GEROVAULT_TAB_ROUTES[tab], component: GerovaultTabPanel })),
            ],
          },
          { path: ':vaultId/spend', name: GEROVAULT_SPEND_ROUTE, component: blank },
        ],
      },
    ],
  });
  await router.push(path);
  await router.isReady();
  const reader = options.reader ?? mockReader();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    attachTo: document.body,
    global: {
      plugins: [createTestVuetify(), router],
      config: { globalProperties: mockGlobalProperties({ $t }) },
      provide: {
        [GEROVAULT_STORE as symbol]: options.store,
        [GEROVAULT_WALLET as symbol]: () => (options.wallet === false ? undefined : { walletId: 7, network: 'preprod' }),
        [GEROVAULT_CHAIN_READER as symbol]: () => reader,
      },
    },
  });
  await flushPromises();
  return { wrapper, router, reader };
}

const candidate = (overrides: Partial<VaultRecord> = {}): VaultRecord => ({ ...f.record, status: 'candidate', origin: 'restored', acceptedAt: null, ...overrides });

describe('vault list', () => {
  it('lists accepted vaults with their balance and candidates under their own heading', async () => {
    const other = { ...candidate(), vaultId: 'c'.repeat(64), name: 'Found' };
    const reader = mockReader({ utxos: [utxo(f.address, 1, 12_500_000n)] });
    const { wrapper } = await mountAt('/vaults', { store: memoryStore([f.record, other]), reader });
    const accepted = wrapper.get('[data-test="overview-accepted"]');
    expect(accepted.findAll('[data-test="vault-card"]')).toHaveLength(1);
    expect(accepted.get('[data-test="vault-card-name"]').text()).toBe(displayLabel('Treasury'));
    expect(accepted.get('[data-test="vault-card-balance"]').text()).toContain('"amount":"12.5"');
    const candidates = wrapper.get('[data-test="overview-candidates"]');
    expect(candidates.text()).toContain('gerovault.detail.overview.candidates');
    expect(candidates.get('[data-test="vault-card-candidate"]').text()).toBe('gerovault.detail.candidate.chip');
    expect(candidates.text()).toContain('gerovault.detail.overview.originRestored');
    // A candidate's balance is never read.
    expect(reader.utxos).toHaveBeenCalledTimes(1);
  });

  it('has a working Create button and an Import package entry', async () => {
    const { wrapper, router } = await mountAt('/vaults', { store: memoryStore([]) });
    expect(wrapper.text()).toContain('gerovault.detail.overview.empty');
    const create = wrapper.get('[data-test="overview-create"]');
    expect(create.attributes('disabled')).toBeUndefined();
    await create.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe(GEROVAULT_CREATE_ROUTE);

    await router.push('/vaults');
    await flushPromises();
    await wrapper.get('[data-test="overview-import"]').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('[data-test="recovery-import"]')).not.toBeNull();
  });

  it('says so when the store cannot be read, and reads again on retry', async () => {
    const store = memoryStore([f.record], { failList: true });
    const { wrapper } = await mountAt('/vaults', { store });
    expect(wrapper.find('[data-test="overview-unavailable"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('gerovault.detail.overview.empty');
    vi.mocked(store.list).mockResolvedValue([f.record]);
    await wrapper.get('[data-test="overview-unavailable"] button').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-test="vault-card"]')).toHaveLength(1);
  });

  it('opens a card on the vault screen', async () => {
    const { wrapper, router } = await mountAt('/vaults', { store: memoryStore([f.record]) });
    await wrapper.get('[data-test="vault-card"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/vaults/${f.id}/proposals`);
  });
});

describe('vault screen', () => {
  it('shows the name, threshold, address, balance without locked UTxOs, the funding banner and Spend', async () => {
    const reader = mockReader({
      utxos: [
        utxo(f.address, 1, 5_000_000n, { assets: { HOSKY: 10n } }),
        utxo(f.address, 2, 9_000_000n, { datumHash: 'd'.repeat(64) }),
      ],
    });
    const { wrapper, router } = await mountAt(`/vaults/${f.id}/proposals`, { store: memoryStore([f.record]), reader });
    expect(wrapper.get('[data-test="vault-name"]').text()).toBe(displayLabel('Treasury'));
    expect(wrapper.get('[data-test="vault-threshold-chip"]').text()).toContain('"threshold":2,"owners":3');
    expect(wrapper.get('[data-test="vault-address-value"]').text().replace(/\s/g, '')).toBe(f.address);
    expect(wrapper.get('[data-test="vault-balance-ada"]').text()).toContain('"amount":"5"');
    expect(wrapper.get('[data-test="vault-balance-locked"]').text()).toContain('"count":1,"amount":"9"');
    expect(wrapper.get('[data-test="vault-balance-assets"]').text()).toContain('HOSKY');
    expect(wrapper.get('[data-test="vault-funding-blocked"]').text()).toContain('gerovault.detail.funding.NO_MANIFEST');
    expect(reader.utxos).toHaveBeenCalledWith(f.address, expect.anything());

    await wrapper.get('[data-test="vault-spend"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe(GEROVAULT_SPEND_ROUTE);
    expect(router.currentRoute.value.params['vaultId']).toBe(f.id);
  });

  it('opens the QR on request', async () => {
    const { wrapper } = await mountAt(`/vaults/${f.id}/proposals`, { store: memoryStore([f.record]) });
    expect(wrapper.find('[data-test="vault-qr"]').exists()).toBe(false);
    await wrapper.get('[data-test="vault-address-qr-toggle"]').trigger('click');
    expect(wrapper.find('[data-test="vault-qr"]').exists()).toBe(true);
  });

  it('shows the scripts and the vault id only in the Details layer', async () => {
    const { wrapper } = await mountAt(`/vaults/${f.id}/proposals`, { store: memoryStore([f.record]) });
    expect(wrapper.find('[data-test="vault-technical"]').exists()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', cancelable: true }));
    await nextTick();
    expect(wrapper.get('[data-test="vault-technical-id"]').text().replace(/\s/g, '')).toBe(f.id);
    expect(wrapper.get('[data-test="vault-technical-payment-cbor"]').text().replace(/\s/g, '')).toBe(f.vault.payment.cbor);
    expect(wrapper.get('[data-test="vault-technical-stake-hash"]').text().replace(/\s/g, '')).toBe(f.vault.stake.hash);
    expect(wrapper.get('.gerovault-vault__id .g-mono').text()).toBe(f.id);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', cancelable: true }));
    await nextTick();
    expect(wrapper.find('[data-test="vault-technical"]').exists()).toBe(false);
  });

  it('has the four tabs: participants with their labels, history from the reader, and the recovery package', async () => {
    const reader = mockReader({ history: (page: number) => (page === 1 ? historyEntries(20) : historyEntries(3, 20)) });
    const { wrapper, router } = await mountAt(`/vaults/${f.id}/policy`, { store: memoryStore([f.record]), reader });
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map(t => t.text())).toEqual(['gerovault.tabs.proposals', 'gerovault.tabs.policy', 'gerovault.tabs.history', 'common.settings']);

    expect(wrapper.get('[data-test="vault-threshold"]').text()).toContain('"threshold":2,"owners":3');
    const people = wrapper.findAll('[data-test="vault-participant"]');
    expect(people).toHaveLength(3);
    const text = people.map(p => p.text()).join('\n');
    expect(text).toContain(displayLabel('Alice'));
    expect(text).toContain(displayLabel('Bob'));
    expect(text).toContain('gerovault.detail.participants.you');
    expect(wrapper.findAll('[data-test="vault-participant-check"]')).toHaveLength(2);
    expect(wrapper.text()).toContain('gerovault.detail.check.unchecked');

    await router.push(`/vaults/${f.id}/history`);
    await flushPromises();
    expect(wrapper.findAll('[data-test="vault-history-row"]')).toHaveLength(20);
    await wrapper.get('[data-test="vault-history-more"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-test="vault-history-row"]')).toHaveLength(23);
    expect(wrapper.find('[data-test="vault-history-more"]').exists()).toBe(false);

    await router.push(`/vaults/${f.id}/settings`);
    await flushPromises();
    expect(wrapper.get('[data-test="recovery-panel-status"]').text()).toContain('gerovault.detail.recovery.neverExported');
    await wrapper.get('[data-test="recovery-panel-export"]').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('[data-test="recovery-export"]')?.textContent).toContain('gerovault.detail.recovery.cannotMoveFunds');
  });

  it('offers a retry when the reader fails', async () => {
    const reader = mockReader({ utxos: new Error('down') });
    const { wrapper } = await mountAt(`/vaults/${f.id}/proposals`, { store: memoryStore([f.record]), reader });
    expect(wrapper.find('[data-test="vault-balance-error"]').exists()).toBe(true);
    reader.utxos.mockResolvedValue([utxo(f.address, 1, 1_000_000n)]);
    await wrapper.get('[data-test="vault-balance-error"] button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="vault-balance-ada"]').text()).toContain('"amount":"1"');
  });

  it('accepts a restored candidate only after the user confirms, and blocks Spend until then', async () => {
    const store = memoryStore([candidate()]);
    const { wrapper } = await mountAt(`/vaults/${f.id}/policy`, { store });
    expect(wrapper.find('[data-test="vault-candidate-chip"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="vault-spend"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="vault-funding-blocked"]').text()).toContain('gerovault.detail.funding.CANDIDATE');
    expect(wrapper.text()).toContain('gerovault.detail.recovery.claim');

    const accept = wrapper.get('[data-test="candidate-accept-button"]');
    expect(accept.attributes('disabled')).toBeDefined();
    await wrapper.get('[data-test="candidate-accept-agree"] input').setValue(true);
    expect(wrapper.get('[data-test="candidate-accept-button"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-test="candidate-accept-button"]').trigger('click');
    await flushPromises();
    expect(store.accept).toHaveBeenCalledWith(7, f.id);
    expect(wrapper.find('[data-test="vault-candidate"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="vault-spend"]').exists()).toBe(true);
  });

  it('leaves a vault still being created to the create flow', async () => {
    const { wrapper } = await mountAt(`/vaults/${f.id}/proposals`, { store: memoryStore([candidate({ origin: 'created' })]) });
    expect(wrapper.text()).toContain('gerovault.detail.candidate.created');
    expect(wrapper.find('[data-test="candidate-accept"]').exists()).toBe(false);
  });

  it('says a vault this wallet does not hold is not found, and shows no tabs', async () => {
    const { wrapper } = await mountAt(`/vaults/${'e'.repeat(64)}/proposals`, { store: memoryStore([f.record]) });
    expect(wrapper.find('[data-test="vault-not-found"]').exists()).toBe(true);
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    const malformed = await mountAt('/vaults/abc/proposals', { store: memoryStore([f.record]) });
    expect(malformed.wrapper.find('[data-test="vault-not-found"]').exists()).toBe(true);
  });
});

// The GeroVault placeholder screens: an overview with an empty state and inactive
// actions, and a vault shell with its four tabs, each an empty state. No data.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import GerovaultOverview from './GerovaultOverview.vue';
import GerovaultCreate from './GerovaultCreate.vue';
import GerovaultVault from './GerovaultVault.vue';
import GerovaultTabPanel from './GerovaultTabPanel.vue';
import { GEROVAULT_TAB_ROUTES, GEROVAULT_TABS } from '@/modules/gerovault/gerovaultRoutes';

enableAutoUnmount(afterEach);

const $t = (key: string): string => key;

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      {
        path: '/vaults',
        children: [
          { path: '', name: 'gerovault', component: GerovaultOverview },
          { path: 'create', name: 'gerovaultCreate', component: GerovaultCreate },
          {
            path: ':vaultId',
            component: GerovaultVault,
            children: GEROVAULT_TABS.map(tab => ({ path: tab, name: GEROVAULT_TAB_ROUTES[tab], component: GerovaultTabPanel })),
          },
        ],
      },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: { plugins: [createTestVuetify(), router], config: { globalProperties: mockGlobalProperties({ $t }) } },
  });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  localStorage.clear();
});

describe('GeroVault overview placeholder', () => {
  it('shows the empty state, the about tooltip, the Details toggle and inactive actions', async () => {
    const { wrapper } = await mountAt('/vaults');
    expect(wrapper.get('h1').text()).toBe('gerovault.title');
    expect(wrapper.text()).toContain('gerovault.overview.empty');
    expect(wrapper.find('button[aria-label="gerovault.about.label"]').exists()).toBe(true);
    expect(wrapper.find('[role="switch"]').exists()).toBe(true);
    const actions = wrapper.findAll('.g-btn');
    expect(actions.map(button => button.text())).toEqual(['gerovault.importPackage', 'gerovault.createVault']);
    for (const action of actions) expect(action.attributes('disabled')).toBeDefined();
  });
});

describe('GeroVault create placeholder', () => {
  it('says creating is not available yet and leads back to the overview', async () => {
    const { wrapper, router } = await mountAt('/vaults/create');
    expect(wrapper.text()).toContain('gerovault.createUnavailable');
    await wrapper.get('a.g-btn').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('gerovault');
  });
});

describe('GeroVault vault shell placeholder', () => {
  it('has the four tabs, each an empty state, linked to its own route', async () => {
    const { wrapper, router } = await mountAt('/vaults/abc/proposals');
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map(tab => tab.text())).toEqual(['gerovault.tabs.proposals', 'gerovault.tabs.policy', 'gerovault.tabs.history', 'common.settings']);
    expect(wrapper.text()).toContain('gerovault.tabEmpty.proposals');

    await tabs[2]!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/vaults/abc/history');
    expect(wrapper.text()).toContain('gerovault.tabEmpty.history');

    await router.push('/vaults/abc/settings');
    await flushPromises();
    expect(wrapper.text()).toContain('gerovault.tabEmpty.settings');
  });

  it('shows the vault identifier only in the technical layer', async () => {
    const { wrapper } = await mountAt('/vaults/abc/policy');
    expect(wrapper.text()).not.toContain('gerovault.vault.id');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', cancelable: true }));
    await nextTick();
    expect(wrapper.text()).toContain('gerovault.vault.id');
    expect(wrapper.get('.gerovault-vault__id .g-mono').text()).toBe('abc');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', cancelable: true }));
    await nextTick();
    expect(wrapper.text()).not.toContain('gerovault.vault.id');

    await wrapper.get('[role="switch"]').trigger('click');
    expect(wrapper.text()).toContain('gerovault.vault.id');
  });
});

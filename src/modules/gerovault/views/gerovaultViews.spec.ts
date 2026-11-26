// The GeroVault create placeholder. The overview and the vault screen have their own specs in
// `src/modules/gerovault/detail/`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
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

describe('GeroVault create placeholder', () => {
  it('says creating is not available yet and leads back to the overview', async () => {
    const { wrapper, router } = await mountAt('/vaults/create');
    expect(wrapper.text()).toContain('gerovault.createUnavailable');
    await wrapper.get('a.g-btn').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('gerovault');
  });
});

// The slice's spend and import-signatures placeholders: a title, an empty state and a way
// back to the vault. No data.
import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type RouteLocationNormalized } from 'vue-router';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import GerovaultSpend from './GerovaultSpend.vue';
import GerovaultImportSignatures from './GerovaultImportSignatures.vue';
import {
  GEROVAULT_IMPORT_SIGNATURES_ROUTE,
  GEROVAULT_SPEND_ROUTE,
  GEROVAULT_TAB_ROUTES,
  GEROVAULT_VAULT_ROUTE,
} from '@/modules/gerovault/gerovaultRoutes';

enableAutoUnmount(afterEach);

const $t = (key: string): string => key;
const blank = { render: () => null };

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: blank },
      {
        path: '/vaults',
        children: [
          {
            path: ':vaultId',
            component: { render: () => h(RouterView) },
            children: [
              { path: '', name: GEROVAULT_VAULT_ROUTE, redirect: (to: RouteLocationNormalized) => ({ name: GEROVAULT_TAB_ROUTES.proposals, params: to.params }) },
              { path: 'proposals', name: GEROVAULT_TAB_ROUTES.proposals, component: blank },
            ],
          },
          { path: ':vaultId/spend', name: GEROVAULT_SPEND_ROUTE, component: GerovaultSpend },
          { path: ':vaultId/import-signatures', name: GEROVAULT_IMPORT_SIGNATURES_ROUTE, component: GerovaultImportSignatures },
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

describe.each([
  ['/vaults/abc/spend', 'gerovault.spend.title', 'gerovault.spend.unavailable'],
  ['/vaults/abc/import-signatures', 'gerovault.spend.importSignatures.title', 'gerovault.spend.importSignatures.unavailable'],
])('GeroVault placeholder at %s', (path, title, message) => {
  it('shows its title and empty state, and leads back to the same vault', async () => {
    const { wrapper, router } = await mountAt(path);
    expect(wrapper.get('h1').text()).toBe(title);
    expect(wrapper.text()).toContain(message);
    await wrapper.get('a.g-btn').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/vaults/abc/proposals');
  });
});

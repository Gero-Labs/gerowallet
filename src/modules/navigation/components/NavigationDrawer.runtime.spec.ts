import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { VApp, VNavigationDrawer } from 'vuetify/components';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: vi.fn(), sendToBackground: vi.fn() },
}));
vi.mock('@/plugins/vuetify', () => ({ updateVuetifyTheme: vi.fn() }));
vi.mock('@/plugins/changeLog', () => ({ default: { setEnabled: vi.fn() } }));
vi.mock('@/db/wallet-db', () => ({ getDb: vi.fn() }));
vi.mock('@/shared/composables/useFeatureNotifications', () => ({ hasNewFeaturesInPath: () => false }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import NavigationDrawer from './NavigationDrawer.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.stubGlobal('APP_VERSION', '0.0.0-test');
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  walletStore.loggedWallet = {
    chain: 'Cardano', network: 'Mainnet', baseAddress: null,
    name: 'Runtime test wallet', icon: 'gero',
  } as never;
});
afterEach(() => { vi.unstubAllGlobals(); });

async function mountNativeDrawer() {
  const vuetify = createTestVuetify();
  vuetify.theme.change('dark');
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<main />' } }],
  });
  await router.push('/');
  await router.isReady();
  const open = ref(false);
  const wrapper = mount(defineComponent({
    setup: () => () => h(VApp, null, { default: () => h(NavigationDrawer, {
      modelValue: open.value,
      'onUpdate:modelValue': (value: boolean) => { open.value = value; },
    }) }),
  }), {
    global: {
      plugins: [vuetify, router],
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
    },
  });
  await flushPromises();
  return { wrapper, vuetify, router, open };
}

describe('NavigationDrawer with native Vuetify injections', () => {
  it('mounts the drawer before options mixins install $vuetify and preserves live theme/router behavior', async () => {
    const { wrapper, vuetify, router } = await mountNativeDrawer();
    const drawer = wrapper.findComponent(VNavigationDrawer);
    expect(drawer.exists()).toBe(true);
    expect(drawer.props('temporary')).toBe(false);
    expect(drawer.props('modelValue')).toBe(true);
    expect(wrapper.text()).toContain('Runtime test wallet');
    const dashboard = wrapper.get('a[href="/"]');
    expect(dashboard.classes()).toContain('activePageDark');
    vuetify.theme.change('light');
    await nextTick();
    expect(dashboard.classes()).toContain('activePage');
    expect(dashboard.classes()).not.toContain('activePageDark');
    await wrapper.get('a[href="/nexus"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/nexus');
  });

  it('names the network under the wallet and shows the chain as a badge on its avatar', async () => {
    const { wrapper } = await mountNativeDrawer();
    const header = wrapper.get('.account-header');
    expect(header.findAll('.v-list-item-subtitle').map((line) => line.text())).toEqual(['Mainnet']);
    expect(header.get('.account-avatar .account-chain').attributes('aria-label')).toBe('Cardano');
  });

  it('closes on the mobile breakpoint and returns to a persistent desktop drawer', async () => {
    const { wrapper, open } = await mountNativeDrawer();
    const drawer = wrapper.findComponent(VNavigationDrawer);
    open.value = true;
    await nextTick();
    vi.stubGlobal('innerWidth', 375);
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    expect(drawer.props('temporary')).toBe(true);
    expect(open.value).toBe(false);
    expect(drawer.props('modelValue')).toBe(false);
    open.value = true;
    await nextTick();
    expect(drawer.props('modelValue')).toBe(true);
    vi.stubGlobal('innerWidth', 1440);
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    expect(drawer.props('temporary')).toBe(false);
    expect(drawer.props('modelValue')).toBe(true);
  });
});

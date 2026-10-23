// Settings → Advanced holds the app-wide "Balances in the wallet list" switch
// (#1332): on unless turned off, and turning it off also forgets the cached values.
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ setWalletListBalances: vi.fn(async () => undefined), clearCachedValues: vi.fn() }));
vi.mock('@/modules/dashboard/components/SubmitApiSettingsRow.vue', () => ({ default: { render: () => null } }));
// A switch that reports its value and flips on click.
vi.mock('@/shared/components/ToggleSwitch.vue', () => ({ default: {
  props: { modelValue: Boolean },
  emits: ['update:modelValue'],
  template: '<button type="button" class="toggle" :data-on="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />',
} }));
vi.mock('@bringweb3/chrome-extension-kit', () => ({ getTurnOff: async () => ({ isTurnedOff: false }), setTurnOff: vi.fn() }));
vi.mock('@/utils/networks', () => ({ default: { resolveCashbackSupport: () => false, resolveStakingSupport: () => false } }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.reactive({ config: {}, loggedWallet: null as unknown }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.reactive({ proofServer: { mode: 'remote' } }) }));
vi.mock('@/stores/geroStore', () => ({
  geroStore: Vue.reactive({ wallets: {} as Record<number, unknown>, config: {} as Record<string, unknown> }),
  default: { setWalletListBalances: env.setWalletListBalances },
}));
vi.mock('@/stores/featureFlagsStore', () => ({
  featureFlagsStore: { isCopilotEnabled: () => false, isLiveChatEnabled: () => false, isSubmitApiEnabled: () => false },
}));
vi.mock('@/stores/agentDockPrefsStore', () => ({ agentDockPrefsStore: { hidden: false, setHidden: vi.fn() } }));
vi.mock('@/db/wallet-db', () => ({ setWalletConfiguration: vi.fn() }));
vi.mock('@/stores/modules/card', () => ({ default: { logout: vi.fn(async () => undefined) } }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: vi.fn(), setError: vi.fn() } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useFeatureNotifications', () => ({ isFeatureNew: () => false, markFeatureAsSeen: vi.fn() }));
vi.mock('@/services/walletLibrary/walletValues', () => ({ clearCachedValues: env.clearCachedValues }));

import AdvancedSettingsTab from './AdvancedSettingsTab.vue';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';

async function render() {
  walletStore.loggedWallet = { id: 1, name: 'Daily', chain: 'Cardano', network: 'Mainnet', type: 'Normal' };
  const view = mount(AdvancedSettingsTab as unknown as Parameters<typeof mount>[0], { global: {
    plugins: [createTestVuetify()],
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $router: { push: vi.fn() } }) },
    stubs: { 'v-window-item': { template: '<div><slot /></div>' } },
  } });
  await flushPromises();
  return view;
}
const balancesSwitch = (view: Awaited<ReturnType<typeof render>>) =>
  view.findAll('.v-row').find((row) => row.find('h3').exists() && row.find('h3').text() === 'settings.walletListBalances')!.find('.toggle');

beforeEach(() => {
  vi.clearAllMocks();
  geroStore.config = {};
  // The tab reads its other app-wide switches from chrome.storage.
  vi.stubGlobal('chrome', { storage: { local: { get: (_key: string, done: (result: object) => void) => done({}), set: vi.fn() } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('the wallet list balances switch', () => {
  it('is on unless it was turned off', async () => {
    expect(balancesSwitch(await render()).attributes('data-on')).toBe('true');
    geroStore.config = { walletListBalances: false };
    expect(balancesSwitch(await render()).attributes('data-on')).toBe('false');
  });

  it('turning it off saves that and forgets the cached values', async () => {
    await balancesSwitch(await render()).trigger('click');

    expect(env.setWalletListBalances).toHaveBeenCalledExactlyOnceWith(false);
    expect(env.clearCachedValues).toHaveBeenCalledOnce();
  });

  it('turning it on saves that and keeps the cache', async () => {
    geroStore.config = { walletListBalances: false };
    await balancesSwitch(await render()).trigger('click');

    expect(env.setWalletListBalances).toHaveBeenCalledExactlyOnceWith(true);
    expect(env.clearCachedValues).not.toHaveBeenCalled();
  });
});

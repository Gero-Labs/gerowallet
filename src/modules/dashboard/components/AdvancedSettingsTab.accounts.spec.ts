import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { env, stub } = vi.hoisted(() => ({
  env: {
    // The background: LOGIN answers with `loginSucceeds`, everything else with success.
    loginSucceeds: true,
    send: vi.fn(),
    removeWallet: vi.fn(),
    push: vi.fn(),
  },
  stub: () => ({ default: { render: () => null } }),
}));
vi.mock('@/modules/dashboard/components/SubmitApiSettingsRow.vue', stub);
vi.mock('@/shared/components/ToggleSwitch.vue', stub);
vi.mock('@bringweb3/chrome-extension-kit', () => ({ getTurnOff: async () => ({ isTurnedOff: false }), setTurnOff: vi.fn() }));
vi.mock('@/utils/networks', () => ({ default: { resolveCashbackSupport: () => false, resolveStakingSupport: () => false } }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: env.send } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.reactive({ config: {}, loggedWallet: null as unknown }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.reactive({ proofServer: { mode: 'remote' } }) }));
vi.mock('@/stores/geroStore', () => ({
  geroStore: Vue.reactive({ wallets: {} as Record<number, unknown> }),
  default: { removeWallet: env.removeWallet },
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

import AdvancedSettingsTab from './AdvancedSettingsTab.vue';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';

const base = { chain: 'Cardano', network: 'Mainnet', type: 'Normal', encryptionMethod: 'password' };
const daily = { id: 1, name: 'Daily', ...base, publicKey: 'xpub-0' };
const added = { id: 2, name: 'Account #1', ...base, publicKey: 'xpub-1', accountIndex: 1, parentWalletId: 1 };

function render(loggedWallet: Record<string, unknown>) {
  geroStore.wallets = { 1: daily, 2: added } as unknown as typeof geroStore.wallets;
  walletStore.loggedWallet = loggedWallet;
  return mount(AdvancedSettingsTab as unknown as Parameters<typeof mount>[0], {
    attachTo: document.body,
    global: {
      plugins: [createTestVuetify()],
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $router: { push: env.push } }) },
      stubs: { 'v-window-item': { template: '<div><slot /></div>' } },
    },
  });
}

/** Clicks the Danger zone button, then Yes in its confirmation. */
async function confirmRemoval(label: string): Promise<void> {
  const button = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  button(label)!.click();
  await flushPromises();
  button('common.yes')!.click();
  await flushPromises();
}

/** The message types the background was sent, in order. */
const sent = () => env.send.mock.calls.map(([request]) => request.method);

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stand-in for the chrome namespace
  (globalThis as any).chrome = { storage: { local: { get: (_key: string, cb: (r: object) => void) => cb({}), set: vi.fn() } } };
  env.send.mockImplementation(async (request: { method: string }) => ({
    data: { success: request.method === MessageTypes.LOGIN ? env.loginSucceeds : true },
  }));
});
afterEach(() => {
  vi.clearAllMocks();
  env.loginSucceeds = true;
  document.body.innerHTML = '';
});

describe('Remove account on an added account', () => {
  it('switches to the wallet’s account #0 first, then removes only that account', async () => {
    render(added);
    await flushPromises();

    await confirmRemoval('accounts.removeAccount');

    const login = env.send.mock.calls.find(([request]) => request.method === MessageTypes.LOGIN)![0];
    expect(login.data.wallet).toMatchObject({ id: 1 });
    expect(sent().indexOf(MessageTypes.LOGIN)).toBeLessThan(sent().indexOf(MessageTypes.NOTIFY_WALLET_REMOVED));
    expect(env.removeWallet.mock.calls).toEqual([[2]]);
    expect(sent()).not.toContain(MessageTypes.LOGOUT);
    expect(env.push).not.toHaveBeenCalled();
  });

  it('removes the account and logs out when the switch fails', async () => {
    env.loginSucceeds = false;
    render(added);
    await flushPromises();

    await confirmRemoval('accounts.removeAccount');

    expect(env.removeWallet.mock.calls).toEqual([[2]]);
    expect(sent()).toContain(MessageTypes.LOGOUT);
  });
});

describe('Delete wallet on account #0', () => {
  it('removes its added accounts with it and logs out', async () => {
    render(daily);
    await flushPromises();

    await confirmRemoval('settings.deleteWallet');

    expect(env.removeWallet.mock.calls).toEqual([[1], [2]]);
    expect(sent()).not.toContain(MessageTypes.LOGIN);
    expect(sent()).toContain(MessageTypes.LOGOUT);
  });
});

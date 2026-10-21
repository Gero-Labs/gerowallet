// Restoring a Google (MPC) wallet that is already on this device logs in to it and
// never writes a second copy (issue 1343). Before, the "Restore Google wallet" entry
// restored the account again and the wallet list showed it twice.
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { env } = vi.hoisted(() => ({
  env: {
    send: vi.fn(),
    push: vi.fn(async () => undefined),
    // What the background answers RECOVER_MPC_GOOGLE_WALLET with.
    recover: { success: true, walletId: 7 } as Record<string, unknown>,
    // The Google wallet this device already stores for the account, if any.
    stored: null as null | Record<string, unknown>,
    wallets: {} as Record<number, unknown>,
  },
}));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: env.send } }));
vi.mock('@/db/gero-db', () => ({
  findMpcGoogleWallet: vi.fn(async () => env.stored),
  getAllWallets: vi.fn(async () => env.wallets),
}));
vi.mock('@/shared/utils/mpc/mpcPasskey', () => ({ mpcPasskeyAvailable: async () => false, enrollMpcPasskey: vi.fn() }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: null } }));
vi.mock('@/utils/networks', () => ({ default: { resolveIconColor: () => 'icon' } }));
vi.mock('@/utils/assets', () => ({ google: '' }));
vi.mock('@/utils/rules', () => ({
  default: new Proxy({}, { get: () => () => () => true }),
}));
vi.mock('@/modules/dashboard/dialogs/UnlockWalletDialog.vue', () => ({
  default: {
    name: 'UnlockWalletDialog',
    props: ['modelValue', 'preLoginWalletId'],
    template: '<div v-if="modelValue" class="unlock-stub">unlock {{ preLoginWalletId }}</div>',
  },
}));

import StepGoogleRestore from './StepGoogleRestore.vue';
import { MessageTypes } from '@/models/MessageTypes';

// An unsigned JWT whose payload carries the Google `sub`, as the sign-in step reads it.
const ID_TOKEN = `h.${btoa(JSON.stringify({ sub: 'google-sub-1' }))}.s`;
const DAILY = { id: 3, name: 'Daily', icon: 'icon', type: 'Google', encryptionMethod: 'mpc', userId: 'google-sub-1' };

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.clearAllMocks();
  env.recover = { success: true, walletId: 7 };
  env.stored = null;
  env.wallets = {};
});

function render() {
  env.send.mockImplementation(async (request: { method: string }) => {
    if (request.method === MessageTypes.SIGN_WITH_GOOGLE) {
      return { data: { success: true, tokens: { idToken: ID_TOKEN, accessToken: 'access' } } };
    }
    if (request.method === MessageTypes.RECOVER_MPC_GOOGLE_WALLET) return { data: env.recover };
    return { data: { success: true } };
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ email: 'alice@example.com', email_verified: true, name: 'Alice' }) })));
  return mount(StepGoogleRestore as unknown as Parameters<typeof mount>[0], {
    props: { network: { blockchain: 'Cardano', network: 'Mainnet' } },
    global: {
      plugins: [createTestVuetify()],
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $router: { push: env.push } }) },
    },
  });
}

const button = (wrapper: ReturnType<typeof render>, text: string) => wrapper.findAll('button').find((b) => b.text().includes(text));
const sent = () => env.send.mock.calls.map(([request]) => request.method);

describe('StepGoogleRestore', () => {
  it('logs in to the wallet already on this device instead of restoring a copy', async () => {
    env.stored = DAILY;
    const wrapper = render();
    await button(wrapper, 'welcome.googleSignInButton')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('welcome.googleWalletAlreadyRestored');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(button(wrapper, 'welcome.restoreGoogleWallet')).toBeUndefined();

    await button(wrapper, 'welcome.logInToThisWallet')!.trigger('click');
    expect(wrapper.find('.unlock-stub').text()).toBe('unlock 3');
    expect(sent()).not.toContain(MessageTypes.RECOVER_MPC_GOOGLE_WALLET);
  });

  it('offers the same login when the background finds the wallet already stored', async () => {
    env.recover = { success: false, code: 'wallet_exists', walletId: 3, error: 'This wallet is already on this device' };
    env.wallets = { 3: DAILY };
    const wrapper = render();
    await button(wrapper, 'welcome.googleSignInButton')!.trigger('click');
    await flushPromises();
    const inputs = wrapper.findAll('input');
    await inputs[1].setValue('recovery-password-123');
    await inputs[2].setValue('Spending-Password-1!');
    await inputs[3].setValue('Spending-Password-1!');
    await flushPromises();

    await button(wrapper, 'welcome.restoreGoogleWallet')!.trigger('click');
    await flushPromises();

    expect(sent()).toContain(MessageTypes.RECOVER_MPC_GOOGLE_WALLET);
    expect(wrapper.text()).toContain('welcome.googleWalletAlreadyRestored');
    expect(button(wrapper, 'welcome.logInToThisWallet')).toBeDefined();
    expect(sent()).not.toContain(MessageTypes.UNLOCK_MPC_WALLET);
    expect(sent()).not.toContain(MessageTypes.LOGIN);
  });

  it('still shows the restore form for an account whose wallet is not on this device', async () => {
    const wrapper = render();
    await button(wrapper, 'welcome.googleSignInButton')!.trigger('click');
    await flushPromises();

    expect(wrapper.find('form').exists()).toBe(true);
    expect(button(wrapper, 'welcome.restoreGoogleWallet')).toBeDefined();
    expect(wrapper.text()).not.toContain('welcome.googleWalletAlreadyRestored');
  });
});

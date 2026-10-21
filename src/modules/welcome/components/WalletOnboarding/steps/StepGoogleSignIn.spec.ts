// Signing in with a Google account whose wallet is already on this device offers only
// "Log in to this wallet" (issue 1343): neither create nor restore makes a second copy.
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { env } = vi.hoisted(() => ({
  env: {
    send: vi.fn(),
    // The Google wallet this device already stores for the account, if any.
    stored: null as null | Record<string, unknown>,
    // Whether the backend has an enrollment for the account.
    enrolled: false,
  },
}));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: env.send } }));
vi.mock('@/db/gero-db', () => ({ findMpcGoogleWallet: vi.fn(async () => env.stored) }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: null } }));
vi.mock('@/utils/assets', () => ({ google: '' }));
vi.mock('@/modules/dashboard/dialogs/UnlockWalletDialog.vue', () => ({
  default: {
    name: 'UnlockWalletDialog',
    props: ['modelValue', 'preLoginWalletId'],
    template: '<div v-if="modelValue" class="unlock-stub">unlock {{ preLoginWalletId }}</div>',
  },
}));

import StepGoogleSignIn from './StepGoogleSignIn.vue';
import { MessageTypes } from '@/models/MessageTypes';

// An unsigned JWT whose payload carries the Google `sub`, as the step reads it.
const ID_TOKEN = `h.${btoa(JSON.stringify({ sub: 'google-sub-1' }))}.s`;

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.clearAllMocks();
  env.stored = null;
  env.enrolled = false;
});

async function signIn() {
  env.send.mockImplementation(async (request: { method: string }) => {
    if (request.method === MessageTypes.SIGN_WITH_GOOGLE) {
      return { data: { success: true, tokens: { idToken: ID_TOKEN, accessToken: 'access' } } };
    }
    if (request.method === MessageTypes.CHECK_MPC_ENROLLMENT) return { data: { success: true, enrolled: env.enrolled } };
    return { data: { success: true } };
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ email: 'alice@example.com', email_verified: true, name: 'Alice' }) })));
  const wrapper = mount(StepGoogleSignIn as unknown as Parameters<typeof mount>[0], {
    props: { network: { blockchain: 'Cardano', network: 'Mainnet' } },
    global: {
      plugins: [createTestVuetify()],
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $router: { push: vi.fn(async () => undefined) } }) },
    },
  });
  await wrapper.findAll('button').find((b) => b.text().includes('welcome.googleSignInButton'))!.trigger('click');
  await flushPromises();
  return wrapper;
}

const buttonTexts = (wrapper: Awaited<ReturnType<typeof signIn>>) => wrapper.findAll('button').map((b) => b.text());

describe('StepGoogleSignIn', () => {
  it('offers only login for the wallet already on this device', async () => {
    env.stored = { id: 3, name: 'Daily', icon: 'icon' };
    env.enrolled = true;
    const wrapper = await signIn();

    expect(wrapper.text()).toContain('welcome.googleWalletAlreadyExists');
    expect(buttonTexts(wrapper)).toContain('welcome.logInToThisWallet');
    expect(buttonTexts(wrapper)).not.toContain('welcome.restoreThisWallet');
    expect(buttonTexts(wrapper)).not.toContain('common.continue');

    await wrapper.findAll('button').find((b) => b.text() === 'welcome.logInToThisWallet')!.trigger('click');
    expect(wrapper.find('.unlock-stub').text()).toBe('unlock 3');
  });

  it('offers restore for an enrolled account whose wallet is not on this device', async () => {
    env.enrolled = true;
    const wrapper = await signIn();

    expect(buttonTexts(wrapper)).toContain('welcome.restoreThisWallet');
    expect(buttonTexts(wrapper)).not.toContain('welcome.logInToThisWallet');
  });
});

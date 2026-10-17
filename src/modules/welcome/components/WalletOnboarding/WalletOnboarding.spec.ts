import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import networks from '@/utils/networks';
import { Blockchain, Network, WalletType } from '@/models/types';
import type { HardwareAccount } from '@/shared/utils/walletAccount';

const { flags, stub } = vi.hoisted(() => ({
  flags: { multiAccount: true, setError: vi.fn() },
  // Each step is a stub that shows its props, so the flow can be driven from here.
  stub: (name: string) => ({ name, props: ['accountIndices', 'accounts', 'groupPublicKey'], template: `<div class="${name}" />` }),
}));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: flags.setError } }));
vi.mock('@/plugins/vuetify', () => ({ updateVuetifyTheme: vi.fn() }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isMultiAccountEnabled: () => flags.multiAccount } }));
vi.mock('@/shared/utils/webauthn-prf', () => ({ isPrfSupported: async () => false }));
vi.mock('./steps/StepStart.vue', () => ({ default: stub('StepStart') }));
vi.mock('./steps/StepSecurity.vue', () => ({ default: stub('StepSecurity') }));
vi.mock('./steps/StepCreateConfirm.vue', () => ({ default: stub('StepCreateConfirm') }));
vi.mock('./steps/StepSeedPhrase.vue', () => ({ default: stub('StepSeedPhrase') }));
vi.mock('./steps/StepRestoreConfirm.vue', () => ({ default: stub('StepRestoreConfirm') }));
vi.mock('./steps/StepDevice.vue', () => ({ default: stub('StepDevice') }));
vi.mock('./steps/StepConnect.vue', () => ({ default: stub('StepConnect') }));
vi.mock('./steps/StepAccounts.vue', () => ({ default: stub('StepAccounts') }));
vi.mock('./steps/StepReview.vue', () => ({ default: stub('StepReview') }));
vi.mock('./steps/StepGoogleSignIn.vue', () => ({ default: stub('StepGoogleSignIn') }));
vi.mock('./steps/StepGoogleSecure.vue', () => ({ default: stub('StepGoogleSecure') }));
vi.mock('./steps/StepGoogleBackup.vue', () => ({ default: stub('StepGoogleBackup') }));
vi.mock('./steps/StepGoogleConfirm.vue', () => ({ default: stub('StepGoogleConfirm') }));
vi.mock('./steps/StepGoogleRestore.vue', () => ({ default: stub('StepGoogleRestore') }));

import WalletOnboarding from './WalletOnboarding.vue';

const network = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
const keystone = { id: 7, name: 'Cold storage', chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Keystone };
const account = (accountIndex: number, publicKey = `xpub-${accountIndex}`): HardwareAccount => ({ accountIndex, publicKey, keys: [] });

function render() {
  return mount(WalletOnboarding, {
    props: { network, addAccountTo: keystone },
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
}
const connected = async (wrapper: ReturnType<typeof render>, accounts: HardwareAccount[]) => {
  wrapper.findComponent({ name: 'StepConnect' }).vm.$emit('connected', { publicKey: accounts[0].publicKey, keys: [], btSupported: false, accounts });
  await flushPromises();
};

afterEach(() => {
  flags.multiAccount = true;
  vi.clearAllMocks();
});

describe('adding accounts of a paired device', () => {
  it('opens on connecting the wallet’s device, asking for the first five accounts', async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.findComponent({ name: 'StepConnect' }).props('accountIndices')).toEqual([0, 1, 2, 3, 4]);
  });

  it('lists what the device exported, then asks again for account 0 and the next five', async () => {
    const wrapper = render();
    await flushPromises();
    await connected(wrapper, [0, 1, 2, 3, 4].map((i) => account(i)));
    const step = wrapper.findComponent({ name: 'StepAccounts' });
    expect((step.props('accounts') as HardwareAccount[]).map((a) => a.accountIndex)).toEqual([0, 1, 2, 3, 4]);

    step.vm.$emit('scan-more');
    await flushPromises();
    expect(wrapper.findComponent({ name: 'StepConnect' }).props('accountIndices')).toEqual([0, 5, 6, 7, 8, 9]);

    await connected(wrapper, [0, 5].map((i) => account(i)));
    expect((wrapper.findComponent({ name: 'StepAccounts' }).props('accounts') as HardwareAccount[]).map((a) => a.accountIndex))
      .toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('stays on connecting when a further scan reads another device', async () => {
    const wrapper = render();
    await flushPromises();
    await connected(wrapper, [account(0), account(1)]);
    wrapper.findComponent({ name: 'StepAccounts' }).vm.$emit('scan-more');
    await flushPromises();

    await connected(wrapper, [account(0, 'xpub-other'), account(5)]);

    expect(flags.setError).toHaveBeenCalledWith('accounts.differentDevice');
    expect(wrapper.findComponent({ name: 'StepConnect' }).exists()).toBe(true);
  });

  it('hands the chosen accounts and account #0’s xpub to the review', async () => {
    const wrapper = render();
    await flushPromises();
    await connected(wrapper, [account(0), account(1)]);
    wrapper.findComponent({ name: 'StepAccounts' }).vm.$emit('next', [account(1)]);
    await flushPromises();

    const review = wrapper.findComponent({ name: 'StepReview' });
    expect((review.props('accounts') as HardwareAccount[]).map((a) => a.accountIndex)).toEqual([1]);
    expect(review.props('groupPublicKey')).toBe('xpub-0');
  });

  it('pairs one account, as before, while multi-account is off', async () => {
    flags.multiAccount = false;
    const wrapper = render();
    await flushPromises();
    expect(wrapper.findComponent({ name: 'StepConnect' }).props('accountIndices')).toBeUndefined();

    wrapper.findComponent({ name: 'StepConnect' }).vm.$emit('connected', { publicKey: 'xpub-0', keys: [], btSupported: false });
    await flushPromises();
    expect(wrapper.findComponent({ name: 'StepAccounts' }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'StepReview' }).props('accounts')).toBeUndefined();
  });
});

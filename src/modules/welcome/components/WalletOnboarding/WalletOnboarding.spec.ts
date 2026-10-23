import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import networks from '@/utils/networks';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';
import type { AccountXpub } from '@/shared/utils/walletAccount';

const { flags, stub, derive, findExisting } = vi.hoisted(() => ({
  flags: { multiAccount: true, setError: vi.fn() },
  // Each step is a stub that shows its props, so the flow can be driven from here.
  stub: (name: string) => ({ name, props: ['accountIndices', 'accounts', 'groupPublicKey', 'source', 'wallet', 'offerAccounts', 'accountCount', 'selected', 'offered', 'busy'], template: `<div class="${name}" />` }),
  derive: vi.fn(),
  findExisting: vi.fn(),
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
vi.mock('./steps/StepJoinAccounts.vue', () => ({ default: stub('StepJoinAccounts') }));
vi.mock('./steps/StepAddAccount.vue', () => ({ default: stub('StepAddAccount') }));
vi.mock('@/shared/utils/softwareAccounts', () => ({ deriveAccountXpubsFromMnemonic: derive }));
vi.mock('@/db/gero-db', () => ({ findExistingWallet: findExisting }));
vi.mock('./steps/StepGoogleSignIn.vue', () => ({ default: stub('StepGoogleSignIn') }));
vi.mock('./steps/StepGoogleSecure.vue', () => ({ default: stub('StepGoogleSecure') }));
vi.mock('./steps/StepGoogleBackup.vue', () => ({ default: stub('StepGoogleBackup') }));
vi.mock('./steps/StepGoogleConfirm.vue', () => ({ default: stub('StepGoogleConfirm') }));
vi.mock('./steps/StepGoogleRestore.vue', () => ({ default: stub('StepGoogleRestore') }));

import WalletOnboarding from './WalletOnboarding.vue';

const network = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
const keystone = { id: 7, name: 'Cold storage', chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Keystone };
const account = (accountIndex: number, publicKey = `xpub-${accountIndex}`): AccountXpub => ({ accountIndex, publicKey, keys: [] });

function render(addAccountTo: object | null = keystone, onNetwork = network) {
  return mount(WalletOnboarding, {
    props: { network: onNetwork, addAccountTo: addAccountTo as Wallet | null },
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
}
const connected = async (wrapper: ReturnType<typeof render>, accounts: AccountXpub[]) => {
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
    expect((step.props('accounts') as AccountXpub[]).map((a) => a.accountIndex)).toEqual([0, 1, 2, 3, 4]);

    step.vm.$emit('scan-more');
    await flushPromises();
    expect(wrapper.findComponent({ name: 'StepConnect' }).props('accountIndices')).toEqual([0, 5, 6, 7, 8, 9]);

    await connected(wrapper, [0, 5].map((i) => account(i)));
    expect((wrapper.findComponent({ name: 'StepAccounts' }).props('accounts') as AccountXpub[]).map((a) => a.accountIndex))
      .toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('gives the accounts step back what the user chose after a further scan, and forgets it on going back', async () => {
    const wrapper = render();
    await flushPromises();
    await connected(wrapper, [0, 1, 2, 3, 4].map((i) => account(i)));
    const step = wrapper.findComponent({ name: 'StepAccounts' });
    step.vm.$emit('update:selected', [0, 1]);
    step.vm.$emit('update:offered', [0, 1, 2, 3, 4]);
    step.vm.$emit('scan-more');
    await flushPromises();

    await connected(wrapper, [0, 5].map((i) => account(i)));
    const again = wrapper.findComponent({ name: 'StepAccounts' });
    expect(again.props('selected')).toEqual([0, 1]);
    expect(again.props('offered')).toEqual([0, 1, 2, 3, 4]);

    again.vm.$emit('back');
    await flushPromises();
    await connected(wrapper, [0, 1].map((i) => account(i)));
    expect(wrapper.findComponent({ name: 'StepAccounts' }).props('selected')).toEqual([]);
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
    expect((review.props('accounts') as AccountXpub[]).map((a) => a.accountIndex)).toEqual([1]);
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

describe('restoring a recovery phrase with several accounts', () => {
  const words = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ');
  const daily = { id: 12, name: 'Daily', chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal };

  async function toAccounts() {
    derive.mockImplementation(async (_mnemonic: string, indices: number[]) => indices.map((i) => account(i)));
    const wrapper = render(null);
    await flushPromises();
    wrapper.findComponent({ name: 'StepStart' }).vm.$emit('select', 'restore');
    await flushPromises();
    const seed = wrapper.findComponent({ name: 'StepSeedPhrase' });
    seed.vm.$emit('change', words);
    seed.vm.$emit('next');
    await flushPromises();
    return wrapper;
  }

  it('lists the first five accounts the phrase derives', async () => {
    const wrapper = await toAccounts();
    const step = wrapper.findComponent({ name: 'StepAccounts' });

    expect(derive).toHaveBeenCalledWith(words.join(' '), [0, 1, 2, 3, 4], { chain: Blockchain.CARDANO, network: Network.MAINNET });
    expect((step.props('accounts') as AccountXpub[]).map((a) => a.accountIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(step.props('source')).toBe('seed');
  });

  it('derives five more in place, with no device to ask', async () => {
    const wrapper = await toAccounts();
    wrapper.findComponent({ name: 'StepAccounts' }).vm.$emit('scan-more');
    await flushPromises();

    expect(derive).toHaveBeenLastCalledWith(words.join(' '), [5, 6, 7, 8, 9], { chain: Blockchain.CARDANO, network: Network.MAINNET });
    expect((wrapper.findComponent({ name: 'StepAccounts' }).props('accounts') as AccountXpub[])).toHaveLength(10);
  });

  it('secures a new wallet, then adds the accounts chosen under it', async () => {
    findExisting.mockResolvedValue(null);
    const wrapper = await toAccounts();
    wrapper.findComponent({ name: 'StepAccounts' }).vm.$emit('next', [account(0), account(2)]);
    await flushPromises();
    expect(wrapper.findComponent({ name: 'StepSecurity' }).exists()).toBe(true);

    wrapper.findComponent({ name: 'StepSecurity' }).vm.$emit('next');
    await flushPromises();
    const confirm = wrapper.findComponent({ name: 'StepRestoreConfirm' });
    expect((confirm.props('accounts') as AccountXpub[]).map((a) => a.accountIndex)).toEqual([0, 2]);
  });

  it('joins a phrase Gero already has, with nothing to secure again', async () => {
    findExisting.mockResolvedValue(daily);
    const wrapper = await toAccounts();
    wrapper.findComponent({ name: 'StepAccounts' }).vm.$emit('next', [account(1)]);
    await flushPromises();

    expect(findExisting).toHaveBeenCalledWith({ chain: Blockchain.CARDANO, network: Network.MAINNET, publicKey: 'xpub-0' });
    expect(wrapper.findComponent({ name: 'StepSecurity' }).exists()).toBe(false);
    const join = wrapper.findComponent({ name: 'StepJoinAccounts' });
    expect(join.props('wallet')).toEqual(daily);
    expect((join.props('accounts') as AccountXpub[]).map((a) => a.accountIndex)).toEqual([1]);
  });

  it('lists a Bitcoin phrase’s accounts too', async () => {
    derive.mockImplementation(async (_mnemonic: string, indices: number[]) => indices.map((i) => account(i)));
    const bitcoin = networks.resolveNetwork(Blockchain.BITCOIN, Network.TESTNET);
    const wrapper = render(null, bitcoin);
    await flushPromises();
    wrapper.findComponent({ name: 'StepStart' }).vm.$emit('select', 'restore');
    await flushPromises();
    const seed = wrapper.findComponent({ name: 'StepSeedPhrase' });
    seed.vm.$emit('change', words);
    seed.vm.$emit('next');
    await flushPromises();

    expect(derive).toHaveBeenCalledWith(words.join(' '), [0, 1, 2, 3, 4], { chain: Blockchain.BITCOIN, network: Network.TESTNET });
    expect(wrapper.findComponent({ name: 'StepAccounts' }).exists()).toBe(true);
  });

  it('lists a Midnight phrase’s accounts too', async () => {
    derive.mockImplementation(async (_mnemonic: string, indices: number[]) => indices.map((i) => account(i)));
    const midnight = networks.resolveNetwork(Blockchain.MIDNIGHT, Network.PREPROD);
    const wrapper = render(null, midnight);
    await flushPromises();
    wrapper.findComponent({ name: 'StepStart' }).vm.$emit('select', 'restore');
    await flushPromises();
    const seed = wrapper.findComponent({ name: 'StepSeedPhrase' });
    seed.vm.$emit('change', words);
    seed.vm.$emit('next');
    await flushPromises();

    expect(derive).toHaveBeenCalledWith(words.join(' '), [0, 1, 2, 3, 4], { chain: Blockchain.MIDNIGHT, network: Network.PREPROD });
    expect(wrapper.findComponent({ name: 'StepAccounts' }).exists()).toBe(true);
  });

  it('shows it is reading the accounts, and reads them once however often Continue is pressed', async () => {
    let finish: (accounts: AccountXpub[]) => void = () => undefined;
    derive.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const wrapper = render(null, networks.resolveNetwork(Blockchain.MIDNIGHT, Network.PREPROD));
    await flushPromises();
    wrapper.findComponent({ name: 'StepStart' }).vm.$emit('select', 'restore');
    await flushPromises();
    const seed = wrapper.findComponent({ name: 'StepSeedPhrase' });
    seed.vm.$emit('change', words);
    seed.vm.$emit('next');
    seed.vm.$emit('next');
    await flushPromises();

    expect(seed.props('busy')).toBe(true);
    expect(derive).toHaveBeenCalledTimes(1);
    finish([0, 1, 2, 3, 4].map((i) => account(i)));
    await flushPromises();
    expect(wrapper.findComponent({ name: 'StepAccounts' }).props('busy')).toBe(false);
  });

  it('restores one account, as before, while multi-account is off', async () => {
    flags.multiAccount = false;
    const wrapper = render(null);
    await flushPromises();
    wrapper.findComponent({ name: 'StepStart' }).vm.$emit('select', 'restore');
    await flushPromises();
    wrapper.findComponent({ name: 'StepSeedPhrase' }).vm.$emit('next');
    await flushPromises();

    expect(derive).not.toHaveBeenCalled();
    expect(wrapper.findComponent({ name: 'StepSecurity' }).exists()).toBe(true);
  });
});

describe('adding an account to a recovery-phrase wallet', () => {
  it('opens the add-account step for that wallet', async () => {
    const daily = { id: 12, name: 'Daily', chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal, encryptionMethod: 'password' };
    const wrapper = render(daily);
    await flushPromises();

    expect(wrapper.findComponent({ name: 'StepAddAccount' }).props('wallet')).toEqual(daily);
    expect(wrapper.findComponent({ name: 'StepConnect' }).exists()).toBe(false);
  });
});

describe('creating a wallet with several accounts', () => {
  async function toSecurity(onNetwork = network) {
    const wrapper = render(null, onNetwork);
    await flushPromises();
    wrapper.findComponent({ name: 'StepStart' }).vm.$emit('select', 'create');
    await flushPromises();
    return wrapper;
  }
  const confirmWith = async (wrapper: Awaited<ReturnType<typeof toSecurity>>, count: number) => {
    const security = wrapper.findComponent({ name: 'StepSecurity' });
    security.vm.$emit('select', 'password', 'Daily', count);
    security.vm.$emit('next');
    await flushPromises();
    return wrapper.findComponent({ name: 'StepCreateConfirm' });
  };

  it('asks how many accounts, and creates that many', async () => {
    const wrapper = await toSecurity();
    expect(wrapper.findComponent({ name: 'StepSecurity' }).props('offerAccounts')).toBe(true);
    expect((await confirmWith(wrapper, 3)).props('accountCount')).toBe(3);
  });

  it('asks on Bitcoin and Midnight too, but not on a chain onboarding offers no accounts for', async () => {
    expect((await toSecurity(networks.resolveNetwork(Blockchain.BITCOIN, Network.TESTNET))).findComponent({ name: 'StepSecurity' }).props('offerAccounts')).toBe(true);
    const midnight = await toSecurity(networks.resolveNetwork(Blockchain.MIDNIGHT, Network.PREPROD));
    expect(midnight.findComponent({ name: 'StepSecurity' }).props('offerAccounts')).toBe(true);
    expect((await confirmWith(midnight, 3)).props('accountCount')).toBe(3);
    const apex = await toSecurity(networks.resolveNetwork(Blockchain.APEX_PRIME, Network.MAINNET));
    expect(apex.findComponent({ name: 'StepSecurity' }).props('offerAccounts')).toBe(false);
    expect((await confirmWith(apex, 3)).props('accountCount')).toBe(1);
  });

  it('creates one account, as before, while multi-account is off', async () => {
    flags.multiAccount = false;
    const wrapper = await toSecurity();
    expect(wrapper.findComponent({ name: 'StepSecurity' }).props('offerAccounts')).toBe(false);
    expect((await confirmWith(wrapper, 3)).props('accountCount')).toBe(1);
  });

  it('does not ask during a restore, whose accounts were chosen from the phrase', async () => {
    findExisting.mockResolvedValue(null);
    derive.mockImplementation(async (_mnemonic: string, indices: number[]) => indices.map((i) => account(i)));
    const wrapper = render(null);
    await flushPromises();
    wrapper.findComponent({ name: 'StepStart' }).vm.$emit('select', 'restore');
    await flushPromises();
    const seed = wrapper.findComponent({ name: 'StepSeedPhrase' });
    seed.vm.$emit('change', 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' '));
    seed.vm.$emit('next');
    await flushPromises();
    wrapper.findComponent({ name: 'StepAccounts' }).vm.$emit('next', [account(0)]);
    await flushPromises();
    expect(wrapper.findComponent({ name: 'StepSecurity' }).props('offerAccounts')).toBe(false);
  });
});

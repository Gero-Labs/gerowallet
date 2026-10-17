import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import networks from '@/utils/networks';
import { Blockchain, Network } from '@/models/types';
import type { AccountXpub } from '@/shared/utils/walletAccount';

const mocks = vi.hoisted(() => ({ discover: vi.fn(), discoverBitcoin: vi.fn(), findExisting: vi.fn() }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key, tc: (key: string) => key } }));
vi.mock('@/db/gero-db', () => ({ findExistingWallet: mocks.findExisting }));
vi.mock('@/shared/utils/accountDiscovery', () => ({ ACCOUNTS_PER_SCAN: 5, discoverAccounts: mocks.discover, discoverBitcoinAccounts: mocks.discoverBitcoin }));

import StepAccounts from './StepAccounts.vue';

const network = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
const account = (accountIndex: number): AccountXpub => ({ accountIndex, publicKey: `xpub-${accountIndex}`, keys: [] });

/** Probes answer `activity` per index; the wallet list holds the indices in `stored`. */
function device(activity: Record<number, string>, stored: Record<number, string> = {}) {
  mocks.discover.mockImplementation(async (_chain: string, _network: string, accounts: AccountXpub[]) =>
    accounts.map((a) => ({ ...a, address: `addr1-${a.accountIndex}`, stakeAddress: `stake1-${a.accountIndex}`, activity: activity[a.accountIndex] ?? 'unused', balance: '0' })));
  mocks.findExisting.mockImplementation(async ({ publicKey }: { publicKey: string }) => {
    const index = Number(publicKey.split('-')[1]);
    return index in stored ? { id: 100 + index, name: stored[index] } : null;
  });
}

function render(accounts: AccountXpub[], onNetwork = network) {
  return mount(StepAccounts, {
    props: { network: onNetwork, accounts },
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
}

const rows = (wrapper: ReturnType<typeof render>) => wrapper.findAll('button.account-row');
const checked = (wrapper: ReturnType<typeof render>) => rows(wrapper).map((row) => row.attributes('aria-checked'));
const continueWith = async (wrapper: ReturnType<typeof render>) => {
  await wrapper.find('button.onb-continue').trigger('click');
  return (wrapper.emitted('next')?.[0]?.[0] as AccountXpub[] | undefined)?.map((a) => a.accountIndex);
};

afterEach(() => vi.clearAllMocks());

describe('choosing accounts', () => {
  it('pre-selects account #0 and the used accounts, and adds them', async () => {
    device({ 0: 'used', 2: 'used' });
    const wrapper = render([0, 1, 2, 3].map(account));
    await flushPromises();

    expect(checked(wrapper)).toEqual(['true', 'false', 'true', 'false']);
    expect(await continueWith(wrapper)).toEqual([0, 2]);
  });

  it('keeps account #0 when it is new: the other accounts are listed under it', async () => {
    device({});
    const wrapper = render([0, 1].map(account));
    await flushPromises();

    expect(rows(wrapper)[0].attributes('disabled')).toBeDefined();
    await rows(wrapper)[1].trigger('click');
    expect(await continueWith(wrapper)).toEqual([0, 1]);
  });

  it('shows accounts Gero already has as added, and adds only the new ones', async () => {
    device({ 0: 'used', 1: 'used', 3: 'used' }, { 0: 'Cold storage', 1: 'Account #1' });
    const wrapper = render([0, 1, 2, 3].map(account));
    await flushPromises();

    expect(rows(wrapper)[0].attributes('disabled')).toBeDefined();
    expect(rows(wrapper)[1].attributes('disabled')).toBeDefined();
    expect(rows(wrapper)[0].text()).toContain('accounts.alreadyAdded');
    expect(await continueWith(wrapper)).toEqual([3]);
  });

  it('offers an account whose probe failed without selecting it', async () => {
    device({ 1: 'unknown' }, { 0: 'Cold storage' });
    const wrapper = render([0, 1].map(account));
    await flushPromises();

    expect(checked(wrapper)).toEqual(['true', 'false']);
    expect(wrapper.find('button.onb-continue').attributes('disabled')).toBeDefined();
    await rows(wrapper)[1].trigger('click');
    expect(await continueWith(wrapper)).toEqual([1]);
  });

  it('probes only the accounts a further scan adds', async () => {
    device({});
    const wrapper = render([0, 1].map(account));
    await flushPromises();
    await wrapper.setProps({ accounts: [0, 1, 5, 6].map(account) });
    await flushPromises();

    expect(mocks.discover.mock.calls.map((call) => (call[2] as AccountXpub[]).map((a) => a.accountIndex))).toEqual([[0, 1], [5, 6]]);
    expect(rows(wrapper)).toHaveLength(4);
  });

  it('asks for more accounts', async () => {
    device({});
    const wrapper = render([0].map(account));
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text().includes('accounts.scanMore'))!.trigger('click');
    expect(wrapper.emitted('scan-more')).toHaveLength(1);
  });
});

describe('choosing Bitcoin accounts', () => {
  it('probes them on their receive addresses, and pre-selects the used ones', async () => {
    mocks.findExisting.mockResolvedValue(null);
    mocks.discoverBitcoin.mockImplementation(async (_network: string, _type: string, accounts: AccountXpub[]) =>
      accounts.map((a) => ({ ...a, address: `tb1q-${a.accountIndex}`, stakeAddress: '', activity: a.accountIndex === 1 ? 'used' : 'unused' })));
    const wrapper = render([0, 1, 2].map(account), networks.resolveNetwork(Blockchain.BITCOIN, Network.TESTNET));
    await flushPromises();

    expect(mocks.discoverBitcoin).toHaveBeenCalledWith(Network.TESTNET, 'segwit', [0, 1, 2].map(account));
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(checked(wrapper)).toEqual(['true', 'true', 'false']);
  });
});

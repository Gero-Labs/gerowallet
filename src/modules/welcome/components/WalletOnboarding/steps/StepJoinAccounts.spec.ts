import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';
import type { AccountXpub } from '@/shared/utils/walletAccount';

const mocks = vi.hoisted(() => ({ send: vi.fn(), addAccounts: vi.fn(), push: vi.fn(async () => undefined) }));
vi.mock('@/plugins/i18n', () => ({
  default: { t: (key: string, params?: { index?: number }) => (params?.index !== undefined ? `${key}:${params.index}` : key), tc: (key: string) => key },
}));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn() } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.send } }));
vi.mock('@/stores/geroStore', () => ({ default: { addAccounts: mocks.addAccounts } }));

import StepJoinAccounts from './StepJoinAccounts.vue';

const daily: Wallet = { id: 12, name: 'Daily', chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal, publicKey: 'xpub-0' };
const account = (accountIndex: number): AccountXpub => ({ accountIndex, publicKey: `xpub-${accountIndex}`, keys: [] });

function render(accounts: AccountXpub[]) {
  return mount(StepJoinAccounts, {
    props: { wallet: daily, accounts },
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
}

afterEach(() => vi.clearAllMocks());

describe('joining a recovery phrase Gero already has', () => {
  it('adds the accounts under the stored wallet and opens the first', async () => {
    mocks.addAccounts.mockResolvedValue([{ id: 30, name: 'accounts.label:1' }, { id: 31, name: 'accounts.label:3' }]);
    const wrapper = render([account(1), account(3)]);
    await wrapper.find('button.step-next').trigger('click');
    await flushPromises();

    expect(mocks.addAccounts).toHaveBeenCalledWith(12, [
      { name: 'accounts.label:1', publicKey: 'xpub-1', accountIndex: 1 },
      { name: 'accounts.label:3', publicKey: 'xpub-3', accountIndex: 3 },
    ]);
    expect(mocks.send).toHaveBeenCalledWith({ method: 'LOGIN', data: { wallet: { id: 30, name: 'accounts.label:1' } } });
    expect(mocks.push).toHaveBeenCalledWith('/');
  });

  it('opens the stored wallet when every account was added meanwhile', async () => {
    mocks.addAccounts.mockResolvedValue([]);
    const wrapper = render([account(1)]);
    await wrapper.find('button.step-next').trigger('click');
    await flushPromises();

    expect(mocks.send).toHaveBeenCalledWith({ method: 'LOGIN', data: { wallet: daily } });
  });
});

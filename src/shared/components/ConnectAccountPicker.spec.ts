// The account a dApp connect prompt connects (#1331): one row per account of
// the logged wallet, by name, first address and (when the name doesn't say it)
// account number.
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, params?: { index?: number }) => (key === 'accounts.label' ? `Account #${params?.index}` : key) }),
}));
vi.mock('@/shared/utils/accountDiscovery', () => ({
  accountReceiveAddress: async (account: { id: number }) => `addr_test1qq${String(account.id).repeat(40)}`,
}));

import ConnectAccountPicker from './ConnectAccountPicker.vue';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';

const wallet = { chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal };
const MAIN = { id: 1, name: 'Main', ...wallet } as Wallet;
const SECOND = { id: 2, name: 'Account #1', accountIndex: 1, parentWalletId: 1, ...wallet } as Wallet;
const SAVINGS = { id: 3, name: 'Savings', accountIndex: 2, parentWalletId: 1, ...wallet } as Wallet;

async function render(accounts: Wallet[], modelValue = 1) {
  const view = mount(ConnectAccountPicker, { props: { accounts, modelValue, loggedId: 1 }, global: { stubs: { 'v-icon': true } } });
  await flushPromises();
  return view;
}

describe('ConnectAccountPicker', () => {
  it('shows nothing for a wallet with one account', async () => {
    expect((await render([MAIN])).find('[role="radiogroup"]').exists()).toBe(false);
  });

  it('names each account with its address, and its number when the name doesn\'t say it', async () => {
    const rows = (await render([MAIN, SECOND, SAVINGS])).findAll('[role="radio"]').map((row) => ({
      name: row.find('.connect-account__name').text(),
      address: row.find('.connect-account__address').text(),
      index: row.find('.connect-account__index').exists() ? row.find('.connect-account__index').text() : null,
    }));

    expect(rows).toEqual([
      { name: 'Main', address: 'addr_test1qq111…11111111', index: 'Account #0' },
      { name: 'Account #1', address: 'addr_test1qq222…22222222', index: null },
      { name: 'Savings', address: 'addr_test1qq333…33333333', index: 'Account #2' },
    ]);
  });

  it('marks the chosen account and picks another on click', async () => {
    const view = await render([MAIN, SECOND]);
    expect(view.findAll('[role="radio"]').map((row) => row.attributes('aria-checked'))).toEqual(['true', 'false']);
    expect(view.text()).not.toContain('accounts.connectSwitches');

    await view.findAll('[role="radio"]')[1].trigger('click');
    expect(view.emitted('update:modelValue')).toEqual([[2]]);
  });

  it('says Gero switches when another account than the logged one is chosen', async () => {
    expect((await render([MAIN, SECOND], 2)).text()).toContain('accounts.connectSwitches');
  });
});

// The wallet list shows what each wallet is worth (#1332): a wallet's value
// under its name, and for a wallet with added accounts their total, with every
// account's own value below it. The "Balances in the wallet list" setting and
// the logged wallet's "hide balances" turn all of it off.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

const state = vi.hoisted(() => ({
  wallets: [] as unknown[],
  children: {} as Record<number, unknown[]>,
  values: {} as Record<string, unknown>,
  pending: {} as Record<string, boolean>,
  enabled: undefined as undefined | { value: boolean },
}));
vi.mock('@/shared/composables/useWalletLibrary', async () => {
  const { computed: vueComputed, ref: vueRef } = await import('vue');
  return {
    useWalletLibrary: () => ({
      preferences: vueRef({ categories: [], uncategorizedCollapsed: false }),
      query: vueRef(''), favoritesOnly: vueRef(false), sort: vueRef('custom'), ready: vueRef(true), saving: vueRef(false),
      error: vueRef(''), indexing: vueRef(false), pendingCount: vueRef(0), favoriteCount: vueRef(0),
      wallets: vueComputed(() => state.wallets), filtered: vueComputed(() => state.wallets), filtering: vueRef(false), reorderable: vueRef(false),
      groups: vueComputed(() => [{ key: 'none', id: null, name: '', favorites: false, expanded: true, collapsed: false, total: state.wallets.length, wallets: state.wallets }]),
      run: vi.fn(), toggleFavorite: vi.fn(), moveWallet: vi.fn(),
      accountsFor: (wallet: { id: number }) => state.children[wallet.id] ?? [],
    }),
  };
});
vi.mock('@/shared/composables/useWalletValues', () => ({
  useWalletValues: (_wallets: unknown, enabled: { value: boolean }) => {
    state.enabled = enabled;
    return {
      valueOf: (wallet: { stakeAddress: string }) => (enabled.value ? state.values[wallet.stakeAddress] : undefined),
      isPending: (wallet: { stakeAddress: string }) => !!state.pending[wallet.stakeAddress],
    };
  },
}));
vi.mock('@/db/wallet-library', () => ({ walletLibraryRepository: {} }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isMultiAccountEnabled: () => false } }));
vi.mock('@/stores/geroStore', async () => ({ geroStore: (await import('vue')).reactive({ config: {} as Record<string, unknown>, wallets: {} }) }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ config: {} as Record<string, unknown> }) }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (key === 'walletLibrary.valuesUpdated' ? `Updated ${params?.time}` : key),
    tc: (key: string) => key,
  }),
}));
vi.mock('@/shared/utils/relativeTime', () => ({ formatRelativeTime: (at: number) => `at ${at}` }));
// Renders the list's rows through the item slot, as vuedraggable does.
vi.mock('vuedraggable', async () => {
  const vue = await import('vue');
  return {
    default: vue.defineComponent({
      props: { modelValue: { type: Array, default: () => [] } },
      setup(props, { slots }) {
        return () => vue.h('ul', (props.modelValue as unknown[]).map((element, index) => slots.item?.({ element, index })));
      },
    }),
  };
});

import WalletLibrary from './WalletLibrary.vue';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network, WalletType } from '@/models/types';

const record = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal, icon: '',
  addresses: [`addr1q${String(id).repeat(40)}`], stakeAddress: `stake1u${id}`, ...extra,
});
const MAIN = record(1, 'Main');
const SECOND = record(2, 'Account #1', { accountIndex: 1, parentWalletId: 1 });
const SAVINGS = record(3, 'Savings', { accountIndex: 2, parentWalletId: 1 });
const DAILY = record(4, 'Daily');
const value = (ada: number, at: number) => ({ ada, usd: ada / 2, eur: ada / 4, at });

beforeEach(() => {
  state.wallets = [MAIN, DAILY];
  state.children = { 1: [SECOND, SAVINGS] };
  state.values = {
    stake1u1: value(2140.37, 300), stake1u2: value(980.21, 100), stake1u3: value(292, 200), stake1u4: value(615.4, 400),
  };
  state.pending = {};
  geroStore.config = {};
  walletStore.config = {};
});

async function render() {
  const view = mount(defineComponent({
    setup() { return () => h(WalletLibrary, { availableWallets: [] }); },
  }), { global: { plugins: [createTestVuetify()], stubs: { 'v-img': true } } });
  await flushPromises();
  return view;
}
const row = (view: Awaited<ReturnType<typeof render>>, id: number) => view.find(`.library-wallet[data-wallet-id="${id}"]`);
const accounts = (view: Awaited<ReturnType<typeof render>>, id: number) => row(view, id).findAll('.account-open').map((account) => ({
  name: account.find('.account-name').text(),
  value: account.find('.account-value').exists() ? account.find('.account-value').text() : null,
  address: account.find('.wallet-address').exists(),
}));

describe('wallet values in the wallet list', () => {
  it('shows a wallet\'s value under its name, with when the server took it', async () => {
    const daily = row(await render(), 4).find('.wallet-value');

    expect(daily.find('.wallet-value__coins').text()).toBe('615.40 ADA');
    expect(daily.text()).toContain('$307.70');
    expect(daily.attributes('title')).toBe('Updated at 400');
  });

  it('totals a wallet\'s accounts and lists each one\'s value, account #0 first', async () => {
    const view = await render();
    const main = row(view, 1);

    expect(main.find('.wallet-value__coins').text()).toBe('3,412.58 ADA');
    expect(main.find('.wallet-value').text()).toContain('$1,706.29');
    expect(accounts(view, 1)).toEqual([
      { name: 'Main', value: '2,140.37 ADA', address: false },
      { name: 'Account #1', value: '980.21 ADA', address: false },
      { name: 'Savings', value: '292.00 ADA', address: false },
    ]);
    // The oldest of the accounts' snapshots dates the total.
    expect(main.find('.library-accounts-note').text()).toBe('Updated at 100');
  });

  it('opens account #0 from its row in the breakdown', async () => {
    const view = await render();
    await row(view, 1).findAll('.account-open')[0].trigger('click');

    expect(view.findComponent(WalletLibrary).emitted('select')).toEqual([[1]]);
  });

  it('shows no total until every account is valued', async () => {
    delete state.values.stake1u3;
    state.pending.stake1u3 = true;
    const view = await render();
    const main = row(view, 1);

    expect(main.find('.wallet-value').exists()).toBe(false);
    expect(main.text()).toContain('walletLibrary.valueCalculating');
    expect(accounts(view, 1)[2]).toEqual({ name: 'Savings', value: null, address: true });
  });

  it('uses euros when the wallet\'s currency is EUR', async () => {
    walletStore.config = { currency: 'eur' };
    const daily = row(await render(), 4).find('.wallet-value');

    expect(daily.text()).toContain('€153.85');
  });

  it.each([
    ['the setting is off', () => { geroStore.config = { walletListBalances: false }; }],
    ['the logged wallet hides its balances', () => { walletStore.config = { hideBalances: true }; }],
  ])('shows no value at all when %s, and the account list as before', async (_case, apply) => {
    apply();
    const view = await render();

    expect(state.enabled?.value).toBe(false);
    expect(view.find('.wallet-value').exists()).toBe(false);
    expect(view.find('.library-accounts-note').exists()).toBe(false);
    expect(accounts(view, 1)).toEqual([
      { name: 'Account #1', value: null, address: true },
      { name: 'Savings', value: null, address: true },
    ]);
  });

  it('leaves testnet wallets as they are', async () => {
    state.wallets = [record(5, 'Test', { network: Network.PREPROD, stakeAddress: 'stake_test1u5' })];
    state.values = { stake_test1u5: value(10, 1) };
    const view = await render();

    expect(view.find('.wallet-value').exists()).toBe(false);
  });
});


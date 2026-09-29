import Vue from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({
  transactions: [], loggedWallet: { chain: 'Cardano', network: 'Mainnet' }, keys: {}, contacts: {}, config: {},
}) }));
vi.mock('@/stores/networkStore', () => ({ networkStore: Vue.observable({ assets: {} }) }));
vi.mock('@/stores/loading', () => ({ loadingState: Vue.observable({ loadingTxs: false }) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: Vue.observable({ adaUsd: null }) }));
vi.mock('@/api/blockchain-api', () => ({ default: { getPoolById: vi.fn() } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({ useCurrencyConverter: () => ({ convertFiat: (n: number) => n, getCurrencySymbol: () => '$' }) }));
vi.mock('@/modules/dashboard/dialogs/TransactionDetailsDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/dialogs/BitcoinTransactionDetailsDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/components/StackedTokens.vue', () => ({ default: { template: '<div />' } }));

import TransactionsCard from './TransactionsCard.vue';
import { walletStore } from '@/stores/walletStore';
// The real validator, so the spec breaks if the two addresses ever collide again
import { DUST_MAPPING_VALIDATOR } from '@/shared/composables/useCnightDustRegistration';
import { Network } from '@/models/types';

// Minswap's published V2 pool address (pool script hash ea07b733…3bde6b)
const MINSWAP_V2_POOL = 'addr1z84q0denmyep98ph3tmzwsmw0j7zau9ljmsqx6a4rvaau66j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq777e2a';
// Minswap V2 order script c3e28c36…, with no stake part and with a wallet's stake key
const MINSWAP_V2_ORDER = 'addr1w8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcnqst2ctf';
const MINSWAP_V2_ORDER_STAKED = 'addr1z8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcn84xmy84q2crvzy6he2j69798923xvt3jk5n3nd9eecmxks7hfyu8';
const OWN = 'addr1qownaddress';
const metadata = (...msg: string[]) => ({ auxiliaryData: { blob: { 674: { msg } } } });

function mountHistory() {
  return mount(TransactionsCard, {
    mocks: { $route: { path: '/transactions' }, $t: (key: string) => key },
    stubs: {
      'v-data-table': { props: ['items'], template: '<div><div v-for="item in items" :key="item.id" :data-id="item.id"><slot name="item.tx_timestamp" :item="item" /></div></div>' },
      'v-tooltip': { template: '<span><slot name="activator" :on="{}" :attrs="{}" /></span>' },
      'v-menu': true, 'v-select': true, 'v-text-field': true, 'v-pagination': true,
    },
  });
}

// Rows render after the component's async onMounted reset
async function rowFor(wrapper: ReturnType<typeof mountHistory>, id: string) {
  await vi.waitFor(() => expect(wrapper.find(`[data-id="${id}"]`).exists()).toBe(true));
  return wrapper.find(`[data-id="${id}"]`);
}

const io = (address: string) => ({ address, amount: [{ unit: 'lovelace', quantity: '2000000' }] });

function tx(id: string, inputs: string[], outputs: string[], extra: Record<string, unknown> = {}) {
  return {
    id, pending: false, tx_timestamp: Math.floor(Date.now() / 1000), ada: -1990000, sentAmount: 1990000, receivedAmount: 0,
    assets: [], sentAssets: [], receivedAssets: [],
    utxo: { inputs: inputs.map(io), outputs: outputs.map(io) },
    body: { inputs: [], outputs: outputs.map((address) => ({ address, value: { coins: 2000000n } })) },
    ...extra,
  };
}

async function rowText(transaction: ReturnType<typeof tx>) {
  walletStore.transactions = [transaction];
  const wrapper = mountHistory();
  try {
    return (await rowFor(wrapper, transaction.id)).text();
  } finally {
    wrapper.destroy();
  }
}

describe('DEX venue tags', () => {
  it('does not take a cNIGHT→DUST registration for a Minswap DEX order', async () => {
    const dustValidator = DUST_MAPPING_VALIDATOR[Network.MAINNET].address;
    walletStore.transactions = [tx('dust-registration', [OWN], [dustValidator, OWN])];
    const wrapper = mountHistory();
    try {
      const row = await rowFor(wrapper, 'dust-registration');
      expect(row.text()).toContain('transactions.dustRegistration');
      expect(row.text()).not.toContain('transactions.minswap');
      expect(row.text()).not.toContain('transactions.dexOrder');
    } finally {
      wrapper.destroy();
    }
  });

  it('still tags a Minswap V2 pool operation as a Minswap DEX order', async () => {
    walletStore.transactions = [tx('minswap-pool-swap', [MINSWAP_V2_POOL, OWN], [MINSWAP_V2_POOL, OWN])];
    const wrapper = mountHistory();
    try {
      const row = await rowFor(wrapper, 'minswap-pool-swap');
      expect(row.text()).toContain('transactions.minswap');
      expect(row.text()).toContain('transactions.dexOrder');
      expect(row.text()).not.toContain('transactions.dustRegistration');
    } finally {
      wrapper.destroy();
    }
  });

  it('tags a Gero Swap order on Minswap V2 as Minswap and Gero Swap, never SteelSwap (tx e113f7f1…)', async () => {
    const text = await rowText(tx('gero-swap-order', [OWN], [MINSWAP_V2_ORDER, OWN], metadata('Gero Swap')));
    expect(text).toContain('transactions.dexOrder');
    expect(text).toContain('transactions.minswap');
    expect(text).toContain('transactions.geroSwap');
    expect(text).not.toContain('transactions.steelswap');
  });

  it('titles an order spent without its pool a cancellation, not a DEX order (tx cf268634…)', async () => {
    const text = await rowText(tx('order-cancel', [MINSWAP_V2_ORDER, OWN], [OWN], {
      ada: 13194754, sentAmount: 0, receivedAmount: 13194754,
    }));
    expect(text).toContain('transactions.orderCancelled');
    expect(text).toContain('transactions.minswap');
    expect(text).not.toContain('transactions.dexOrder');
    expect(text).not.toContain('transactions.steelswap');
  });

  it('tags SteelSwap from its own 674 message only', async () => {
    const text = await rowText(tx('steelswap-order', [OWN], [MINSWAP_V2_ORDER, OWN], metadata('CarDeM', 'SteelSwap: 1.18.0')));
    expect(text).toContain('transactions.steelswap');
    expect(text).not.toContain('transactions.geroSwap');
  });

  it('does not take a wallet\'s own staked Minswap order address for DexHunter', async () => {
    const text = await rowText(tx('staked-minswap-order', [OWN], [MINSWAP_V2_ORDER_STAKED, OWN]));
    expect(text).toContain('transactions.minswap');
    expect(text).not.toContain('transactions.dexhunter');
  });
});

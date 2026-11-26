import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { Blockchain, Network } from '@/models/types';

const route = vi.hoisted(() => ({ params: { id: '' } as Record<string, string> }));
vi.mock('vue-router', () => ({ useRoute: () => route }));
vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({ loggedWallet: null, keys: { payment: [], change: [] }, contacts: {}, transactions: [] }),
}));
vi.mock('@/shared/utils/resolver', () => ({ resolveAsset: () => ({ name: 'Resolved', img: 'resolved.png', metadata: { decimals: '2' } }) }));
vi.mock('@/modules/market/composables/useMarketData', () => ({ getTokenByUnit: (unit: string) => (unit === 'listed' ? { img: 'market.png' } : undefined) }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { template: '<span />' } }));
vi.mock('@/shared/components/TxFlowDiagram.vue', () => ({ default: { name: 'TxFlowDiagram', props: ['model', 'tokenInfo', 'currencySymbol'], template: '<div class="flow" />' } }));

import TxFlowWindow from './TxFlowWindow.vue';
import { walletStore } from '@/stores/walletStore';

const OWN = 'addr_own';
const io = (address: string, lovelace: number, tokens: Record<string, number> = {}) => ({
  address,
  amount: [{ unit: 'lovelace', quantity: lovelace }, ...Object.entries(tokens).map(([unit, quantity]) => ({ unit, quantity }))],
});
const record = {
  id: 'ab'.repeat(32),
  isValid: true,
  body: { fee: 200_000 },
  utxo: { inputs: [io(OWN, 10_000_000, { listed: 1 })], outputs: [io('addr_other', 9_800_000, { listed: 1 })] },
};

const mountWindow = (id: string) => {
  route.params = { id };
  return mount(TxFlowWindow, { global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } } });
};

enableAutoUnmount(afterEach);
beforeEach(() => {
  Object.assign(walletStore, {
    loggedWallet: { chain: Blockchain.CARDANO, network: Network.MAINNET },
    keys: { payment: [{ address: OWN }], change: [] },
    transactions: [record],
  });
});

describe('TxFlowWindow', () => {
  it('draws the flow of the logged wallet\'s transaction named in the URL', () => {
    const wrapper = mountWindow(record.id);
    const flow = wrapper.findComponent({ name: 'TxFlowDiagram' });
    expect(flow.exists()).toBe(true);
    expect(flow.props('model').inputs.map((node: { kind: string }) => node.kind)).toEqual(['own']);
    expect(flow.props('model').outputs.map((node: { kind: string }) => node.kind)).toEqual(['other', 'fee']);
    expect(wrapper.text()).toContain('transactions.flow.ariaLabel');
  });

  it('names tokens from the asset store, with the market image first', () => {
    const tokenInfo = mountWindow(record.id).findComponent({ name: 'TxFlowDiagram' }).props('tokenInfo');
    expect(tokenInfo('listed')).toEqual({ name: 'Resolved', img: 'market.png', decimals: 2 });
    expect(tokenInfo('other')).toEqual({ name: 'Resolved', img: 'resolved.png', decimals: 2 });
  });

  it('shows "not found" for an id the logged wallet does not hold', () => {
    const wrapper = mountWindow('cd'.repeat(32));
    expect(wrapper.findComponent({ name: 'TxFlowDiagram' }).exists()).toBe(false);
    expect(wrapper.text()).toContain('mempool.txNotFound');
  });

  it('draws nothing on another chain', () => {
    walletStore.loggedWallet = { chain: Blockchain.MIDNIGHT, network: Network.PREPROD } as never;
    expect(mountWindow(record.id).findComponent({ name: 'TxFlowDiagram' }).exists()).toBe(false);
  });
});

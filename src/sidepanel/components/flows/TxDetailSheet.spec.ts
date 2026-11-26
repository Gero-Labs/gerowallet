import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { Blockchain, Network } from '@/models/types';

vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({ loggedWallet: null, keys: { payment: [], change: [] }, contacts: {} }),
}));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }),
}));
vi.mock('@/shared/composables/useExplorer', () => ({ useExplorer: () => ({ explorerUrl: () => '' }) }));
vi.mock('@/chains/midnight/midnightSponsorLinks', () => ({ loadSponsoredTxs: vi.fn(async () => []), sponsoredTxFor: vi.fn(() => null) }));
vi.mock('@/shared/utils/resolver', () => ({ resolveAsset: () => ({ name: 'Resolved', metadata: { decimals: 2 } }) }));
vi.mock('@/modules/market/composables/useMarketData', () => ({ getTokenByUnit: () => undefined }));
vi.mock('../../composables/useChainContext', async () => {
  const { computed } = await import('vue');
  const { walletStore } = await import('@/stores/walletStore');
  const { Blockchain: Chains } = await import('@/models/types');
  return {
    useChainContext: () => ({
      themeColors: computed(() => ({ primary: '#fff' })),
      isCardano: computed(() => walletStore.loggedWallet?.chain === Chains.CARDANO),
    }),
  };
});
vi.mock('../BottomSheet.vue', () => ({ default: { template: '<div><slot /></div>' } }));

import TxDetailSheet from './TxDetailSheet.vue';
import TxFlowDiagram from '@/shared/components/TxFlowDiagram.vue';
import { walletStore } from '@/stores/walletStore';

const address = (digit: string) =>
  Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Mainnet,
    { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(digit.repeat(56)) },
    { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16('f'.repeat(56)) },
  ).toAddress().toBech32();
const OWN = address('1');
const OTHER = address('2');

const io = (addr: string, lovelace: number, tokens: Record<string, number> = {}) => ({
  address: addr,
  amount: [{ unit: 'lovelace', quantity: lovelace }, ...Object.entries(tokens).map(([unit, quantity]) => ({ unit, quantity }))],
});

const tx = (overrides: Record<string, unknown> = {}) => ({
  id: 'ab'.repeat(32),
  ada: -5_200_000,
  tx_timestamp: 1_700_000_000,
  isValid: true,
  body: { fee: 200_000 },
  assets: [{ unit: 'tok', quantity: -3, name: 'Held', decimals: 0 }],
  utxo: { inputs: [io(OWN, 10_000_000, { tok: 3 })], outputs: [io(OTHER, 5_000_000, { tok: 3 }), io(OWN, 4_800_000)] },
  ...overrides,
});

const mountSheet = async (record: Record<string, unknown> | null) => {
  const wrapper = mount(TxDetailSheet, {
    props: { modelValue: true, tx: record as never },
    global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
  await flushPromises();
  return wrapper;
};

enableAutoUnmount(afterEach);
beforeEach(() => {
  Object.assign(walletStore, {
    loggedWallet: { chain: Blockchain.CARDANO, network: Network.MAINNET },
    keys: { payment: [{ address: OWN }], change: [] },
  });
});

describe('TxDetailSheet flow diagram', () => {
  it('draws the vertical flow of a Cardano transaction, own addresses marked', async () => {
    const wrapper = await mountSheet(tx());
    const flow = wrapper.findComponent(TxFlowDiagram);
    expect(flow.exists()).toBe(true);
    expect(flow.props('orientation')).toBe('vertical');
    const model = flow.props('model');
    expect(model.inputs.map((node) => node.kind)).toEqual(['own']);
    expect(model.outputs.map((node) => node.kind)).toEqual(['other', 'own', 'fee']);
    expect(flow.props('currencySymbol')).toBeTruthy();
  });

  it('names tokens from the row first, then the asset store', async () => {
    const wrapper = await mountSheet(tx());
    const tokenInfo = wrapper.findComponent(TxFlowDiagram).props('tokenInfo');
    expect(tokenInfo('tok')).toMatchObject({ name: 'Held', decimals: 0 });
    expect(tokenInfo('other')).toMatchObject({ name: 'Resolved', decimals: 2 });
  });

  it('draws none for a pending transaction without inputs', async () => {
    const wrapper = await mountSheet(tx({ pending: true, utxo: null }));
    expect(wrapper.findComponent(TxFlowDiagram).exists()).toBe(false);
    expect(wrapper.find('.tx-detail').exists()).toBe(true);
  });

  it('draws none for a transaction whose scripts failed', async () => {
    const wrapper = await mountSheet(tx({ isValid: false }));
    expect(wrapper.findComponent(TxFlowDiagram).exists()).toBe(false);
  });

  it('draws none on other chains', async () => {
    walletStore.loggedWallet = { chain: Blockchain.MIDNIGHT, network: Network.PREPROD } as never;
    const wrapper = await mountSheet(tx());
    expect(wrapper.findComponent(TxFlowDiagram).exists()).toBe(false);
  });
});

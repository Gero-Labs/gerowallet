import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import NetworkSelector from './NetworkSelector.vue';
import networks from '@/utils/networks';
import { Blockchain, Network } from '@/models/types';

vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isBitcoinEnabled: () => false } }));

const mountSelector = () => mount(NetworkSelector, {
  props: { network: networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET) },
  global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
});

describe('NetworkSelector', () => {
  it('marks a chain that cannot be picked yet with the corner ribbon, read as part of its name', () => {
    const wrapper = mountSelector();
    const bitcoin = wrapper.findAll('button.chain-tile').find((tile) => tile.text().startsWith(Blockchain.BITCOIN))!;

    expect(bitcoin.attributes('disabled')).toBeDefined();
    const ribbon = bitcoin.find('.chain-tile__ribbon');
    expect(ribbon.text()).toBe('welcome.soon');
    expect(ribbon.attributes('aria-hidden')).toBeUndefined();
    expect(wrapper.findAll('.chain-tile__ribbon')).toHaveLength(wrapper.findAll('button.chain-tile:disabled').length);
  });
});

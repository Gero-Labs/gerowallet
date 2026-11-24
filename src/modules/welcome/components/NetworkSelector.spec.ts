import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NetworkSelector from './NetworkSelector.vue';
import networks from '@/utils/networks';
import { Blockchain, Network } from '@/models/types';

const flags = vi.hoisted(() => ({ solana: false }));
vi.mock('@/stores/featureFlagsStore', () => ({
  featureFlagsStore: { isBitcoinEnabled: () => false, isSolanaEnabled: () => flags.solana },
}));

const mountSelector = (devMode = false, chain: string = Blockchain.CARDANO, network: string = Network.MAINNET) => mount(NetworkSelector, {
  props: { network: networks.resolveNetwork(chain, network), devMode },
  global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
});

const tileFor = (wrapper: ReturnType<typeof mountSelector>, chain: string) =>
  wrapper.findAll('button.chain-tile').find((tile) => tile.text().startsWith(chain));

afterEach(() => {
  flags.solana = false;
});

describe('NetworkSelector', () => {
  it('marks a chain that cannot be picked yet with the corner ribbon, read as part of its name', () => {
    const wrapper = mountSelector();
    const bitcoin = tileFor(wrapper, Blockchain.BITCOIN)!;

    expect(bitcoin.attributes('disabled')).toBeDefined();
    const ribbon = bitcoin.find('.chain-tile__ribbon');
    expect(ribbon.text()).toBe('welcome.soon');
    expect(ribbon.attributes('aria-hidden')).toBeUndefined();
    expect(wrapper.findAll('.chain-tile__ribbon')).toHaveLength(wrapper.findAll('button.chain-tile:disabled').length);
  });

  it('shows no Solana tile at all while isSolanaEnabled is off', () => {
    expect(tileFor(mountSelector(), Blockchain.SOLANA)).toBeUndefined();
    expect(tileFor(mountSelector(true), Blockchain.SOLANA)).toBeUndefined();
  });

  it('with isSolanaEnabled on, Solana is pickable in dev mode only (mainnet is not live yet)', () => {
    flags.solana = true;
    expect(tileFor(mountSelector(), Blockchain.SOLANA)?.attributes('disabled')).toBeDefined();
    expect(tileFor(mountSelector(true), Blockchain.SOLANA)?.attributes('disabled')).toBeUndefined();
  });

  it('labels Midnight Preview read-only in GeroWallet for now, and no other network', () => {
    const preview = mountSelector(true, Blockchain.MIDNIGHT, Network.PREVIEW);
    expect(preview.get('[data-test="network-read-only"]').text()).toBe('midnight.readOnly.label');
    const pills = preview.findAll('button.net-pill');
    const previewPill = pills.find((pill) => pill.text().includes('Preview'))!;
    expect(previewPill.attributes('title')).toBe('midnight.readOnly.label');
    expect(previewPill.attributes('aria-describedby')).toBe('network-read-only-note');
    expect(previewPill.find('.net-pill__read-only').exists()).toBe(true);
    for (const pill of pills.filter((p) => p !== previewPill)) {
      expect(pill.attributes('title')).toBeUndefined();
      expect(pill.find('.net-pill__read-only').exists()).toBe(false);
    }

    for (const [chain, network] of [[Blockchain.MIDNIGHT, Network.PREPROD], [Blockchain.MIDNIGHT, Network.MAINNET], [Blockchain.CARDANO, Network.PREVIEW]]) {
      expect(mountSelector(true, chain, network).find('[data-test="network-read-only"]').exists()).toBe(false);
    }
  });
});

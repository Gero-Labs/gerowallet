import { describe, expect, it, vi } from 'vitest';
import * as Vue from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { Psbt } from 'bitcoinjs-lib';
import { createRequire } from 'node:module';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

// bitcoinjs-lib is externalized to Node by Vitest and checks keys against Node's Buffer,
// while the sources get the polyfill. Hand the sources Node's Buffer too.
vi.mock('vite-plugin-node-polyfills/shims/buffer', async () => {
  const { createRequire: requireFrom } = await import('node:module');
  const { Buffer } = requireFrom(import.meta.url)('node:buffer');
  return { default: Buffer, Buffer };
});
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.reactive({
  loggedWallet: { id: 1, chain: 'Bitcoin', network: 'Mainnet', publicKey: 'not-an-xpub', baseAddress: '' },
  keys: { payment: [], change: [] },
}) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: Vue.reactive({ btcUsd: { lastPrice: 100_000 } }) }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }),
}));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({
  useCurrencyConverter: () => ({ convertFiat: (n: number) => n, getCurrencySymbol: () => '$' }),
}));

import BitcoinPsbtReview from './BitcoinPsbtReview.vue';
import TransactionDetailsCard from './TransactionDetailsCard.vue';
import { walletStore } from '@/stores/walletStore';

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');
const SHOP = 'bc1qenxvenxvenxvenxvenxvenxvenxvenxvx46avd';

const mountReview = async (psbtHex: string) => {
  const wrapper = mount(BitcoinPsbtReview, {
    props: { psbtHex },
    global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
  // The review loads bitcoinjs-lib and the key derivation on demand
  await vi.waitFor(() => {
    if (!wrapper.findComponent(TransactionDetailsCard).exists() && !wrapper.find('[role="alert"]').exists()) throw new Error('still loading');
  });
  await flushPromises();
  return wrapper;
};

describe('Bitcoin PSBT review', () => {
  it('puts every output, the fee and the total on the approval card', async () => {
    const change = 'bc1qhwamhwamhwamhwamhwamhwamhwamhwame6jz2r';
    walletStore.keys = { payment: [], change: [{ address: change }] } as never;
    const psbt = new Psbt()
      .addInput({ hash: '01'.repeat(32), index: 0, witnessUtxo: { script: NodeBuffer.from('0014' + 'aa'.repeat(20), 'hex'), value: 100_000 } })
      .addOutput({ address: SHOP, value: 60_000 })
      .addOutput({ address: change, value: 39_000 });

    const wrapper = await mountReview(psbt.toHex());
    const card = wrapper.getComponent(TransactionDetailsCard);

    expect(card.props('outputs').map((output: { kind: string; ada: string }) => [output.kind, output.ada])).toEqual([
      ['external', '0.00060000'],
      ['change', '0.00039000'],
    ]);
    expect(card.props('totals')).toMatchObject({
      totalSendingAda: '0.00060000',
      feeAda: '0.00001000',
      youPayAda: '0.00061000',
      isInternal: false,
    });
    expect(card.props('unit')).toBe('BTC');
    expect(wrapper.text()).toContain('≈ $61');
  });

  it('says the fee is unknown when an input does not carry its value', async () => {
    const psbt = new Psbt().addInput({ hash: '01'.repeat(32), index: 0 }).addOutput({ address: SHOP, value: 1_000 });
    const wrapper = await mountReview(psbt.toHex());
    expect(wrapper.getComponent(TransactionDetailsCard).props('totals')).toMatchObject({ feeAda: '—', youPayAda: '—' });
    expect(wrapper.text()).toContain('bitcoin.psbtFeeUnknown');
  });

  it('warns instead of showing a card when the PSBT cannot be read', async () => {
    const wrapper = await mountReview('not a psbt');
    expect(wrapper.findComponent(TransactionDetailsCard).exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').text()).toContain('bitcoin.psbtUnreadable');
  });
});

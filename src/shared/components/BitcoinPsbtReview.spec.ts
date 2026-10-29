import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { describe, expect, it, vi } from 'vitest';
import * as Vue from 'vue';
import { mount } from '@vue/test-utils';
import type { PsbtReview } from '@/chains/bitcoin/psbtReview';

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, args?: { index?: unknown }) => `${key}:${args?.index ?? ''}`, tc: (key: string) => key }),
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.reactive({
  loggedWallet: { id: 1, chain: 'Bitcoin', network: 'Testnet' },
}) }));
vi.mock('@/stores/priceStore', () => ({ priceStore: Vue.reactive({ btcUsd: { lastPrice: 100_000 } }) }));
vi.mock('@/shared/composables/useCurrencyConverter', () => ({
  useCurrencyConverter: () => ({ convertFiat: (n: number) => n, getCurrencySymbol: () => '$' }),
}));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import BitcoinPsbtReview from './BitcoinPsbtReview.vue';
// @ts-ignore: as above.
import TransactionDetailsCard from './TransactionDetailsCard.vue';

const ATTACKER = 'tb1qattackeraddressxxxxxxxxxxxxxxxxxxxxxxxx';
const OWN = 'tb1qownwalletaddressxxxxxxxxxxxxxxxxxxxxxxx';
const CHANGE = 'tb1qownchangeaddressxxxxxxxxxxxxxxxxxxxxxx';

const drain: PsbtReview = {
  inputs: [
    { index: 0, address: OWN, valueSats: 40_000n, own: true, willSign: true },
    { index: 1, address: OWN, valueSats: 60_000n, own: true, willSign: true },
  ],
  outputs: [{ index: 0, address: ATTACKER, valueSats: 99_000n, own: false, change: false }],
  signIndices: [0, 1],
  spentSats: 100_000n,
  receivedSats: 0n,
  netSats: 100_000n,
  feeSats: 1_000n,
  problems: [],
};

const mountWith = (review: PsbtReview | null, result = '') => mount(BitcoinPsbtReview, {
  props: { review, result },
  global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { 'v-icon': true } },
});

describe('BitcoinPsbtReview', () => {
  it('puts every output, what leaves the wallet and the fee on the approval card', () => {
    const payment: PsbtReview = {
      ...drain,
      inputs: [{ index: 0, address: OWN, valueSats: 100_000n, own: true, willSign: true }],
      outputs: [
        { index: 0, address: ATTACKER, valueSats: 60_000n, own: false, change: false },
        { index: 1, address: CHANGE, valueSats: 39_000n, own: true, change: true },
      ],
      receivedSats: 39_000n,
      netSats: 61_000n,
    };
    const w = mountWith(payment, 'bitcoin.signedPsbt');
    const card = w.getComponent(TransactionDetailsCard);

    expect(card.props('outputs').map((o: { kind: string; ada: string }) => [o.kind, o.ada])).toEqual([
      ['external', '0.00060000'],
      ['change', '0.00039000'],
    ]);
    expect(card.props('totals')).toMatchObject({ totalSendingAda: '0.00060000', feeAda: '0.00001000', youPayAda: '0.00061000', isInternal: false });
    expect(w.text()).toContain('bitcoin.signedPsbt');
    expect(w.findAll('[data-testid="bitcoin-psbt-signed-input"]')).toHaveLength(1);
    expect(w.find('[data-testid="bitcoin-psbt-problem"]').exists()).toBe(false);
  });

  it('counts a drain to a foreign output as leaving the wallet in full, with the full address', () => {
    const w = mountWith(drain);
    const card = w.getComponent(TransactionDetailsCard);
    expect(card.props('outputs')[0].kind).toBe('external');
    expect(card.props('totals')).toMatchObject({ totalSendingAda: '0.00099000', youPayAda: '0.00100000' });
    // The card shortens addresses; the recipient is also shown in full.
    const recipients = w.findAll('[data-testid="bitcoin-psbt-output"]');
    expect(recipients).toHaveLength(1);
    expect(recipients[0].text()).toContain(ATTACKER);
  });

  it('says the fee is unknown, rather than showing a wrong one, for a partial PSBT', () => {
    const w = mountWith({ ...drain, feeSats: -5_000n });
    expect(w.getComponent(TransactionDetailsCard).props('totals').feeAda).toBe('—');
    expect(w.text()).toContain('bitcoin.psbtFeeUnknown');
  });

  it('names the first problem, above the card', () => {
    const w = mountWith({ ...drain, problems: [{ code: 'notOwn', index: 1 }] });

    expect(w.find('[data-testid="bitcoin-psbt-problem"]').text()).toContain('bitcoin.psbtReview.problemNotOwn:1');
  });

  it('shows only the problem for a PSBT it cannot decode', () => {
    const w = mountWith({ ...drain, inputs: [], outputs: [], problems: [{ code: 'unparseable' }] });

    expect(w.find('[data-testid="bitcoin-psbt-problem"]').text()).toContain('bitcoin.psbtReview.problemUnparseable');
    expect(w.findComponent(TransactionDetailsCard).exists()).toBe(false);
  });

  it('shows nothing while the review is loading', () => {
    const w = mountWith(null);
    expect(w.findComponent(TransactionDetailsCard).exists()).toBe(false);
    expect(w.find('[data-testid="bitcoin-psbt-problem"]').exists()).toBe(false);
  });
});

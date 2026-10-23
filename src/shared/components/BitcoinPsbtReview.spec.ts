import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { PsbtReview } from '@/chains/bitcoin/psbtReview';

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, args?: { index?: unknown }) => `${key}:${args?.index ?? ''}` }),
}));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import BitcoinPsbtReview from './BitcoinPsbtReview.vue';

const ATTACKER = 'tb1qattackeraddressxxxxxxxxxxxxxxxxxxxxxxxx';
const OWN = 'tb1qownwalletaddressxxxxxxxxxxxxxxxxxxxxxxx';

const drain: PsbtReview = {
  inputs: [
    { index: 0, address: OWN, valueSats: 40_000n, own: true, willSign: true },
    { index: 1, address: OWN, valueSats: 60_000n, own: true, willSign: true },
  ],
  outputs: [{ index: 0, address: ATTACKER, valueSats: 99_000n, own: false }],
  signIndices: [0, 1],
  spentSats: 100_000n,
  receivedSats: 0n,
  netSats: 100_000n,
  feeSats: 1_000n,
  problems: [],
};

const mountWith = (review: PsbtReview | null) => mount(BitcoinPsbtReview, {
  props: { review },
  global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { 'v-icon': true } },
});

describe('BitcoinPsbtReview', () => {
  it('shows what leaves the wallet, the fee, and every output with its full address', () => {
    const w = mountWith(drain);

    expect(w.find('[data-testid="bitcoin-psbt-net"]').text()).toBe('0.00100000 BTC');
    const outputs = w.findAll('[data-testid="bitcoin-psbt-output"]');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].text()).toContain(ATTACKER);
    expect(outputs[0].text()).toContain('dashboard.external');
    expect(outputs[0].text()).toContain('0.00099000 BTC');
    expect(w.findAll('[data-testid="bitcoin-psbt-signed-input"]')).toHaveLength(2);
    expect(w.text()).toContain('0.00001000 BTC');
    expect(w.find('[data-testid="bitcoin-psbt-problem"]').exists()).toBe(false);
  });

  it('names the first problem', () => {
    const w = mountWith({ ...drain, problems: [{ code: 'notOwn', index: 1 }] });

    expect(w.find('[data-testid="bitcoin-psbt-problem"]').text()).toContain('bitcoin.psbtReview.problemNotOwn:1');
  });

  it('shows only the problem for a PSBT it cannot decode', () => {
    const w = mountWith({ ...drain, inputs: [], outputs: [], problems: [{ code: 'unparseable' }] });

    expect(w.find('[data-testid="bitcoin-psbt-problem"]').exists()).toBe(true);
    expect(w.find('[data-testid="bitcoin-psbt-net"]').exists()).toBe(false);
  });
});

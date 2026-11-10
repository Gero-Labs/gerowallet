// Issue 1440: the Babylon stake dialog runs in a page, where the worker's fee
// estimator and its API don't exist. It used to price and build the staking
// transaction at its own 50/25/10 sat/vB. These pin that the fee step shows the
// network's rates and the PSBT is built at the chosen one, and that the built-in
// fallback is never used without saying so.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import * as Vue from 'vue';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import type { BitcoinFeeEstimates } from '@/api/bitcoin-api';
import type { BabylonFinalityProvider, BabylonParamVersion } from '@/api/babylon-api';

const getFeeEstimates = vi.hoisted(() => vi.fn<() => Promise<BitcoinFeeEstimates>>());
const apiNetworks = vi.hoisted(() => [] as unknown[]);
vi.mock('@/api/bitcoin-api', () => ({
  BitcoinApi: class {
    getFeeEstimates = getFeeEstimates;
    constructor(wallet: { network: string }) { apiNetworks.push(wallet.network); }
  },
}));
const buildPsbt = vi.hoisted(() => vi.fn(async (_args: Record<string, unknown>) => ({ psbtHex: '70736274ff' })));
vi.mock('@/chains/bitcoin/babylonStakingBuilder', () => ({ buildBabylonStakingPsbt: buildPsbt }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return {
    walletStore: reactive({
      loggedWallet: { id: 1, chain: 'Bitcoin', network: 'Mainnet', type: 'Normal', encryptionMethod: 'password' },
      utxos: [{ txHash: 'aa'.repeat(32), outputIndex: 0, value: 1_000_000n, confirmed: true }] as unknown[],
    }),
  };
});
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// `<script setup>` imports are not registered by name, so they are mocked as modules.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: { name: 'BaseDialogStub', setup: (_p: unknown, { slots }: { slots: Vue.Slots }) => () => Vue.h('div', slots['default']?.()) },
}));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: {
    name: 'GButtonStub',
    props: ['disabled', 'loading', 'tier', 'block'],
    emits: ['click'],
    setup(props: { disabled?: boolean }, { slots, emit }: { slots: Vue.Slots; emit: (event: string) => void }) {
      return () => Vue.h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots['default']?.());
    },
  },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import BabylonStakeDialog from './BabylonStakeDialog.vue';
import { Messaging } from '@/chrome/messaging';
import { getBitcoinFeeEstimatorFor } from '@/chains/bitcoin/bitcoinFeeEstimator';

const send = vi.mocked(Messaging.sendToBackgroundFromOptions);

// Esplora's rates: next block 42, ~3 blocks 17, ~6 blocks 3, ~24 blocks 1.
const LIVE: BitcoinFeeEstimates = { fastestFee: 42, halfHourFee: 17, hourFee: 3, economyFee: 1, minimumFee: 1 };

const PARAMS = {
  min_staking_amount: 50_000,
  max_staking_amount: 5_000_000_000,
  min_staking_time: 64_000,
  max_staking_time: 64_000,
} as BabylonParamVersion;

const PROVIDER = {
  btc_pk: 'cd'.repeat(32),
  description: { moniker: 'Provider' },
  commission: '0.05',
  active_tvl: 0,
  active_delegations: 0,
} as BabylonFinalityProvider;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

let wrapper: VueWrapper;

function mountDialog() {
  wrapper = mount(BabylonStakeDialog, {
    props: {
      modelValue: true,
      params: PARAMS,
      selectedProvider: PROVIDER,
      btcAddress: 'bc1qstaker',
      isTestnet: false,
      stakerBtcPk: 'ef'.repeat(32),
    },
    global: {
      config: {
        globalProperties: mockGlobalProperties({
          $t: (key: string, params?: { value?: unknown }) => (params?.value !== undefined ? `${key}:${params.value}` : key),
        }),
      },
      stubs: {
        'v-icon': true,
        'v-btn': true,
        'v-slider': true,
        'v-progress-circular': true,
        'v-card-text': { setup: (_p: unknown, { slots }: { slots: Vue.Slots }) => () => Vue.h('div', slots['default']?.()) },
      },
    },
  });
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await Vue.nextTick();
}

const button = (label: string) => wrapper.findAll('button').find((b) => b.text().includes(label))!;

/** Fills a valid amount on step 1 and moves to the fee step. */
async function toFeeStep() {
  await wrapper.find('input.bab-input__control--amount').setValue('0.001');
  await button('common.continue').trigger('click');
  await settle();
}

/** The estimator is imported on demand; waits until the fee step has rates to show. */
async function ratesShown() {
  await vi.waitFor(() => expect(wrapper.text()).not.toContain('bitcoin.feeRatesLoading'));
}

beforeEach(() => {
  getFeeEstimates.mockReset();
  apiNetworks.length = 0;
  buildPsbt.mockClear();
  send.mockReset();
  getBitcoinFeeEstimatorFor('Mainnet').clearCache();
});

afterEach(() => {
  wrapper?.unmount();
});

describe('BabylonStakeDialog fee rates (issue 1440)', () => {
  it('shows the network fee rates and builds the stake at the chosen one', async () => {
    getFeeEstimates.mockResolvedValue(LIVE);
    mountDialog();
    await toFeeStep();
    await ratesShown();

    const text = wrapper.text();
    expect(text).toContain('bitcoin.feeRateValue:42');
    expect(text).toContain('bitcoin.feeRateValue:17');
    expect(text).toContain('bitcoin.feeRateValue:3');
    expect(text).not.toContain('bitcoin.feeRateValue:25');
    expect(text).not.toContain('bitcoin.feeRatesFallback');
    expect(apiNetworks).toContain('Mainnet');

    await button('common.continue').trigger('click');
    await wrapper.find('input[type="password"]').setValue('pw');
    send.mockResolvedValue({ data: { success: true, txId: 'ab'.repeat(32) } });
    await button('babylon.stakeDialog.stakeNow').trigger('click');
    await settle();

    expect(buildPsbt).toHaveBeenCalledTimes(1);
    expect(buildPsbt.mock.calls[0][0]).toMatchObject({ stakingAmountSat: 100_000, feeRate: 17, network: 'Mainnet' });
  });

  it('keeps the fee step closed until the rates arrive', async () => {
    const rates = deferred<BitcoinFeeEstimates>();
    getFeeEstimates.mockReturnValue(rates.promise);
    mountDialog();
    await toFeeStep();

    expect(wrapper.text()).toContain('bitcoin.feeRatesLoading');
    expect(wrapper.text()).not.toContain('bitcoin.feeRateValue');
    expect(button('common.continue').attributes('disabled')).toBeDefined();

    rates.resolve(LIVE);
    await ratesShown();
    expect(wrapper.text()).toContain('bitcoin.feeRateValue:17');
    expect(button('common.continue').attributes('disabled')).toBeUndefined();
  });

  it('says so when it falls back to the built-in rates', async () => {
    getFeeEstimates.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mountDialog();
    await toFeeStep();
    await ratesShown();

    expect(wrapper.text()).toContain('bitcoin.feeRatesFallback');
    expect(wrapper.text()).toContain('bitcoin.feeRateValue:10');
  });
});

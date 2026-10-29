// A quote names the THORChain inbound address and memo the user pays to, so it must answer the
// inputs the form shows now. These pin that a reply to an older request, success or failure,
// lands in a race where the user already changed the destination, amount or direction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import * as Vue from 'vue';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import type { ThorQuote } from '@/api/thorchain-api';

vi.mock('@/api/thorchain-api', () => ({ default: { getSwapQuote: vi.fn() } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// `<script setup>` imports are not registered by name, so they are mocked as modules.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: { name: 'BaseDialogStub', render: () => null } }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { name: 'CopyButtonStub', render: () => null } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: {
    name: 'GButtonStub',
    props: ['disabled'],
    setup(props: { disabled?: boolean }, { slots }: { slots: Vue.Slots }) {
      return () => Vue.h('button', { 'data-testid': 'swap', disabled: props.disabled }, slots['default']?.());
    },
  },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import ThorchainSwap from './ThorchainSwap.vue';
import thorchainApi from '@/api/thorchain-api';

const getSwapQuote = vi.mocked(thorchainApi.getSwapQuote);
const ADDRESS_A = 'addr1qxaaaaaaaaaaaaaaaaaaaaaa';
const ADDRESS_B = 'addr1qxbbbbbbbbbbbbbbbbbbbbbb';

function quoteFor(expectedOutSats: string): ThorQuote {
  return {
    inbound_address: 'bc1qinbound',
    memo: `=:ADA.ADA:${expectedOutSats}`,
    expected_amount_out: expectedOutSats,
    total_swap_seconds: 600,
    fees: { asset: 'ADA.ADA', affiliate: '0', outbound: '0', liquidity: '0', total: '0', slippage_bps: 10, total_bps: 10 },
  } as ThorQuote;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let wrapper: VueWrapper;

function mountSwap() {
  wrapper = mount(ThorchainSwap, {
    global: {
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
      stubs: { 'v-icon': true, 'v-btn': true, 'v-card-text': true, 'v-progress-circular': true },
    },
  });
}

async function settle() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await Vue.nextTick();
}

/** Edits a field, then lets the 600 ms debounce send the request. */
async function edit(selector: string, value: string) {
  await wrapper.find(selector).setValue(value);
  vi.advanceTimersByTime(600);
  await settle();
}

const quoteOut = () => wrapper.find('.thor-quote__out');
const spinner = () => wrapper.find('v-progress-circular-stub');
const swapButton = () => wrapper.find('[data-testid="swap"]');

beforeEach(() => {
  vi.useFakeTimers();
  getSwapQuote.mockReset();
});

afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
});

describe('ThorchainSwap quotes', () => {
  it('drops a quote that answers a destination the form no longer shows', async () => {
    const first = deferred<ThorQuote>();
    const second = deferred<ThorQuote>();
    getSwapQuote.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mountSwap();

    await edit('[aria-label="thorchain.amount"]', '0.01');
    await edit('input.g-mono', ADDRESS_A);
    await edit('input.g-mono', ADDRESS_B);
    expect(getSwapQuote.mock.calls.map(call => call[3])).toEqual([ADDRESS_A, ADDRESS_B]);

    first.resolve(quoteFor('111'));
    await settle();
    expect(quoteOut().exists()).toBe(false);
    expect(spinner().exists()).toBe(true);
    expect(swapButton().attributes('disabled')).toBeDefined();

    second.resolve(quoteFor('222'));
    await settle();
    expect(quoteOut().text()).toContain('0.00000222');
    expect(spinner().exists()).toBe(false);
    expect(swapButton().attributes('disabled')).toBeUndefined();
  });

  it('drops a failure that answers an amount the form no longer shows', async () => {
    const first = deferred<ThorQuote>();
    const second = deferred<ThorQuote>();
    getSwapQuote.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mountSwap();

    await wrapper.find('input.g-mono').setValue(ADDRESS_A);
    await edit('[aria-label="thorchain.amount"]', '0.01');
    await edit('[aria-label="thorchain.amount"]', '0.02');
    expect(getSwapQuote.mock.calls.map(call => call[2])).toEqual([1_000_000, 2_000_000]);

    second.resolve(quoteFor('222'));
    await settle();
    first.reject(new Error('stale'));
    await settle();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(quoteOut().text()).toContain('0.00000222');
  });

  it('drops a quote still in flight when the direction is flipped', async () => {
    const pending = deferred<ThorQuote>();
    getSwapQuote.mockReturnValueOnce(pending.promise);
    mountSwap();

    await wrapper.find('input.g-mono').setValue(ADDRESS_A);
    await edit('[aria-label="thorchain.amount"]', '0.01');
    await wrapper.find('.thor__flip v-btn-stub').trigger('click');

    pending.resolve(quoteFor('111'));
    await settle();
    expect(quoteOut().exists()).toBe(false);
    expect(spinner().exists()).toBe(false);
  });
});

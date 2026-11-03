// A top-up the largest UTxOs one request carries cannot cover: the review plans the sweep and
// shows it before the user approves; a sweep found only at signing is shown before it is signed.
import * as Vue from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';

const state = vi.hoisted(() => ({
  build: vi.fn(),
  reset: vi.fn(),
  canSweep: true,
  refs: null as null | { sweep: { value: unknown }; payment: { value: unknown }; preparing: { value: unknown } },
  signSection: null as null | { prepare: () => Promise<unknown>; prerequisites: unknown; disabled: boolean },
}));

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/usePaymentSweep', async () => {
  const { computed, ref, shallowRef } = await import('vue');
  const sweep = shallowRef<{ mergeCbors: string[] } | null>(null);
  const payment = shallowRef(null);
  const preparing = ref(null);
  state.refs = { sweep, payment, preparing };
  return {
    usePaymentSweep: () => ({
      sweep, payment, preparing,
      prerequisites: computed(() => (sweep.value ? { cbors: sweep.value.mergeCbors, outputs: [] } : null)),
      build: state.build,
      reset: () => { state.reset(); sweep.value = null; payment.value = null; preparing.value = null; },
    }),
  };
});
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({
    loggedWallet: { baseAddress: 'own', network: 'Preprod', type: 'Normal' },
    utxos: [] as unknown[], collateral: null, transactions: [],
  }) };
});
vi.mock('@/stores/modules/card', () => ({ default: {
  state: { exchangeRate: { buy: '0.5' } },
  fetchFreshDepositAddress: vi.fn(async () => 'card-address'),
  getSelectedCard: () => null,
  fetchCardBalance: vi.fn(),
  fetchCardHistory: vi.fn(async () => undefined),
} }));
vi.mock('@/modules/wallet/utils/cardDepositAddress', () => ({ isCardDepositAddress: () => true, networkIdOfAddress: () => 0 }));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: { render(this: { $slots: { default?: () => Vue.VNode[] } }) { return Vue.h('div', this.$slots.default?.()); } } }));
vi.mock('@/shared/components/iso/IsoScene.vue', () => ({ default: { render: () => Vue.h('div') } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: {
  emits: ['click'],
  render(this: { $slots: { default?: () => Vue.VNode[] }; $emit: (event: string) => void }) {
    return Vue.h('button', { onClick: () => this.$emit('click') }, this.$slots.default?.());
  },
} }));
vi.mock('./top-up/AmountInputStep.vue', () => ({ default: {
  emits: ['update:modelValue'],
  render(this: { $emit: (event: string, value: unknown) => void }) {
    return Vue.h('button', { 'data-amount': '', onClick: () => this.$emit('update:modelValue', { adaAmount: '203', eurAmount: '100' }) });
  },
} }));
vi.mock('./top-up/SummaryStep.vue', () => ({ default: { render: () => Vue.h('div') } }));
vi.mock('./top-up/SuccessStep.vue', () => ({ default: { render: () => Vue.h('div') } }));
vi.mock('@/modules/dashboard/components/sweep/SweepPlanCard.vue', () => ({ default: { render: () => Vue.h('div', { 'data-plan-card': '' }) } }));
vi.mock('@/modules/dashboard/components/sweep/SweepProgressPanel.vue', () => ({ default: { render: () => Vue.h('div') } }));
vi.mock('@/modules/dashboard/components/sweep/SweepTimeline.vue', () => ({ default: {
  props: ['steps', 'utxoCount', 'mergeFee', 'paymentFee'],
  render(this: { steps: number; mergeFee: string; paymentFee: string }) {
    return Vue.h('div', { 'data-timeline': '' }, `${this.steps} ${this.mergeFee} ${this.paymentFee}`);
  },
} }));
vi.mock('../ui/CardSignSection.vue', () => ({ default: {
  props: ['label', 'prepare', 'disabled', 'prerequisites'],
  setup(props: { prepare: () => Promise<unknown>; prerequisites: unknown; disabled: boolean }, { expose }: { expose: (exposed: Record<string, unknown>) => void }) {
    state.signSection = props;
    expose({ reset: vi.fn(), canSweep: state.canSweep });
    return () => Vue.h('div');
  },
} }));

import TopUpModal from './TopUpModal.vue';
import { walletStore } from '@/stores/walletStore';

const txId = (n: number) => n.toString(16).padStart(64, '0');
const utxos = (count: number) =>
  Array.from({ length: count }, (_, n) => [{ txId: txId(n), index: 0 }, { address: 'own', value: { coins: 1_000_000 } }]) as never;
const PAYMENT = { body: { fee: 250_000n } } as unknown as Cardano.Tx;

/** What the composable does when it sends the top-up as a sweep. */
function planASweep() {
  state.refs!.sweep.value = { merges: [{}, {}], mergeCbors: ['m1', 'm2'], utxoCount: 205, mergeFee: 400_000n };
  state.refs!.payment.value = { key: 'top-up', tx: PAYMENT };
  return PAYMENT;
}

async function openReview() {
  const wrapper = mount(TopUpModal, { props: { open: true }, attachTo: document.body });
  await wrapper.get('[data-amount]').trigger('click');
  const continueButton = wrapper.findAll('button').find((button) => button.text() === 'card.continueButton')!;
  await continueButton.trigger('click');
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  state.canSweep = true;
  walletStore.utxos = utxos(205);
  state.build.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('TopUpModal, a top-up sent as a sweep', () => {
  it('plans the sweep at review and shows it, fees included, before the user approves', async () => {
    state.build.mockImplementation(async () => planASweep());
    const wrapper = await openReview();
    expect(state.build).toHaveBeenCalledTimes(1);
    const [request, candidates, canSweep] = state.build.mock.calls[0];
    expect(request).toEqual({ outputs: [expect.objectContaining({ address: 'card-address', lovelace: '203000000' })], changeAddress: 'own' });
    expect(candidates).toHaveLength(205);
    expect(canSweep).toBe(true);
    expect(wrapper.get('[data-timeline]').text()).toBe('3 ₳0.4 ₳0.25');
    expect(state.signSection?.prerequisites).toEqual({ cbors: ['m1', 'm2'], outputs: [] });
    expect(state.signSection?.disabled).toBe(false);
  });

  it('signs the planned payment, the same one the review built', async () => {
    state.build.mockImplementation(async () => planASweep());
    await openReview();
    await expect(state.signSection!.prepare()).resolves.toBe(PAYMENT);
  });

  it('plans nothing for a wallet one request carries, or one that cannot sign a sweep', async () => {
    walletStore.utxos = utxos(150);
    await openReview();
    expect(state.build).not.toHaveBeenCalled();

    walletStore.utxos = utxos(205);
    state.canSweep = false;
    await openReview();
    expect(state.build).not.toHaveBeenCalled();
  });

  it('stops a sweep found only at signing, so its plan is approved before it is signed', async () => {
    state.build.mockRejectedValueOnce(new Error('network down'));
    const wrapper = await openReview();
    expect(wrapper.find('[data-timeline]').exists()).toBe(false);

    state.build.mockImplementation(async () => planASweep());
    await expect(state.signSection!.prepare()).rejects.toThrow('card.topUpSweepReview');
    await flushPromises();
    expect(wrapper.find('[data-timeline]').exists()).toBe(true);
    await expect(state.signSection!.prepare()).resolves.toBe(PAYMENT);
  });

  it('forgets the plan when the user goes back to the amount', async () => {
    state.build.mockImplementation(async () => planASweep());
    const wrapper = await openReview();
    state.reset.mockClear();
    const back = wrapper.findAll('button').find((button) => button.text() === 'common.back')!;
    await back.trigger('click');
    expect(state.reset).toHaveBeenCalled();
    expect(state.refs!.sweep.value).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, markRaw, nextTick, reactive, ref, toRaw } from 'vue';
import { VStepperWindowItem } from 'vuetify/components';
import type { Cardano } from '@cardano-sdk/core';
import { createTestVuetify } from '@test/helpers/vuetify';

const mocks = vi.hoisted(() => ({ scan: vi.fn() }));
vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({
    loggedWallet: { id: 1, chain: 'Cardano', network: 'Mainnet', baseAddress: 'own-address' },
    keys: { payment: [], change: [] }, isLocked: false,
  }),
}));
vi.mock('@/api/cardano-shield-api', () => ({ default: { scanTx: mocks.scan } }));
vi.mock('@/chrome/cardanoJsSdkCbor', () => ({
  serializeCardanoJsSdkTx: (tx: Cardano.Tx) => JSON.stringify(tx, (_, value) => typeof value === 'bigint' ? String(value) : value),
}));
vi.mock('@/shared/utils/filters', () => ({ default: { toCurrency: (value: number) => String(value / 1_000_000) } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }) }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { template: '<button>Copy</button>' } }));

import SummaryStep from './SummaryStep.vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import TransactionDetailsCard from '@/shared/components/TransactionDetailsCard.vue';
import { walletStore } from '@/stores/walletStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function transaction(coins = 10_000_000n, address = 'external-address'): Cardano.Tx {
  return reactive({ body: { outputs: [{ address, value: { coins } }], fee: 310_525n } }) as unknown as Cardano.Tx;
}
function mountSummary(tx = transaction()) {
  return mount(SummaryStep, {
    props: { txData: tx, recipients: [], active: true },
    global: { plugins: [createTestVuetify()] },
  });
}

enableAutoUnmount(afterEach);
beforeEach(() => {
  mocks.scan.mockReset().mockImplementation(() => new Promise(() => {}));
  walletStore.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet', baseAddress: 'own-address' };
  walletStore.isLocked = false;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Quick Send transaction review with native lazy stepper windows', () => {
  it('renders details on the first transition, before the optional risk request resolves', async () => {
    const step = ref(1);
    const tx = transaction();
    const Harness = defineComponent({
      setup: () => () => h(CustomStepper, { steps: ['Recipients', 'Summary'], currentStep: step.value }, {
        default: () => [
          h(VStepperWindowItem, { value: 1 }, { default: () => h('button', { onClick: () => step.value = 2 }, 'Continue') }),
          h(VStepperWindowItem, { value: 2 }, { default: () => h(SummaryStep, { txData: tx, recipients: [], active: step.value === 2 }) }),
        ],
      }),
    });
    const wrapper = mount(Harness, { global: { plugins: [createTestVuetify()] } });
    expect(wrapper.findComponent(SummaryStep).exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    const summary = wrapper.getComponent(SummaryStep);
    expect(summary.get('.tx-details').isVisible()).toBe(true);
    expect(summary.get('.tx-output-row').text()).toContain('10');
    expect(summary.text()).toContain('0.310525');
    expect(summary.text()).toContain('10.310525');
    expect(summary.vm.isReadyFor(tx)).toBe(true);
    expect(mocks.scan).toHaveBeenCalledTimes(1);
    expect(summary.getComponent(TransactionDetailsCard).props('riskLoading')).toBe(true);
  });

  it('updates reviewed outputs and discards an obsolete risk response after replacement', async () => {
    const oldScan = deferred<{ score: number }>();
    const newScan = deferred<{ score: number }>();
    mocks.scan.mockReturnValueOnce(oldScan.promise).mockReturnValueOnce(newScan.promise);
    const oldTx = transaction();
    const replacement = transaction(20_000_000n, 'new-recipient');
    const wrapper = mountSummary(oldTx);
    await flushPromises();
    await wrapper.setProps({ txData: replacement });
    await flushPromises();
    expect(wrapper.vm.isReadyFor(oldTx)).toBe(false);
    expect(wrapper.vm.isReadyFor(replacement)).toBe(true);
    expect(wrapper.get('.tx-output-row').text()).toContain('new-recipient');
    expect(wrapper.get('.tx-output-row').text()).toContain('20');
    newScan.resolve({ score: 2 });
    await flushPromises();
    expect(wrapper.getComponent(TransactionDetailsCard).props('riskBadge')?.label).toBe('high');
    oldScan.resolve({ score: 0 });
    await flushPromises();
    expect(wrapper.getComponent(TransactionDetailsCard).props('riskBadge')?.label).toBe('high');
  });

  it('invalidates review when going back and rechecks when the summary is shown again', async () => {
    const pending = deferred<{ score: number }>();
    mocks.scan.mockReturnValueOnce(pending.promise);
    const tx = transaction();
    const wrapper = mountSummary(tx);
    await flushPromises();
    expect(wrapper.vm.isReadyFor(tx)).toBe(true);
    await wrapper.setProps({ active: false });
    expect(wrapper.vm.isReadyFor(tx)).toBe(false);
    pending.resolve({ score: 2 });
    await flushPromises();
    expect(wrapper.getComponent(TransactionDetailsCard).props('riskBadge')).toBeNull();
    await wrapper.setProps({ active: true });
    await flushPromises();
    expect(wrapper.vm.isReadyFor(tx)).toBe(true);
    expect(mocks.scan).toHaveBeenCalledTimes(2);
  });

  it('never authorizes mutated raw transaction bytes that were not rendered', async () => {
    const tx = markRaw(toRaw(transaction()));
    const wrapper = mountSummary(tx);
    await flushPromises();
    expect(wrapper.vm.isReadyFor(tx)).toBe(true);
    tx.body.fee = 1_000_000n as Cardano.Lovelace;
    expect(wrapper.vm.isReadyFor(tx)).toBe(false);
    expect(wrapper.text()).toContain('0.310525');
  });

  it.each(['wallet', 'network', 'lock'] as const)('invalidates review synchronously on %s changes', async change => {
    const tx = transaction();
    const wrapper = mountSummary(tx);
    await flushPromises();
    if (change === 'wallet') walletStore.loggedWallet.id = 2;
    if (change === 'network') walletStore.loggedWallet.network = 'Preprod';
    if (change === 'lock') walletStore.isLocked = true;
    expect(wrapper.vm.isReadyFor(tx)).toBe(false);
    await flushPromises();
    expect(wrapper.vm.isReadyFor(tx)).toBe(change !== 'lock');
  });

  it('renders a later transaction when mounted before one is available', async () => {
    const wrapper = mountSummary();
    await wrapper.setProps({ txData: undefined });
    expect(wrapper.find('.tx-details').exists()).toBe(false);
    expect(wrapper.vm.isReadyFor(undefined)).toBe(false);
    const tx = transaction(4_000_000n, 'own-address');
    await wrapper.setProps({ txData: tx });
    await nextTick();
    expect(wrapper.get('.tx-internal-banner').text()).toContain('signTx.internalTransfer');
    expect(wrapper.getComponent(TransactionDetailsCard).props('totals').youPayAda).toBe('0.310525');
    expect(wrapper.vm.isReadyFor(tx)).toBe(true);
  });

  it('keeps transaction details and readiness when the optional scan times out', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tx = transaction();
    const wrapper = mountSummary(tx);
    await nextTick();
    await vi.advanceTimersByTimeAsync(5000);
    expect(wrapper.find('.tx-details').exists()).toBe(true);
    expect(wrapper.getComponent(TransactionDetailsCard).props('riskLoading')).toBe(false);
    expect(wrapper.vm.isReadyFor(tx)).toBe(true);
    vi.restoreAllMocks();
  });
});

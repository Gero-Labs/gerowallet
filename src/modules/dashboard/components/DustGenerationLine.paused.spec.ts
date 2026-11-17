import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';

const mocks = vi.hoisted(() => ({ latest: vi.fn() }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getLatestBlock: mocks.latest }) }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive({ loggedWallet: { network: 'Mainnet', stakeAddress: 'stake1' } }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: reactive({ tip: { hash: null, height: 0, timestamp: 0 } }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/shared/composables/useDustPending', () => ({ getDustPending: () => null, dustPendingRevision: ref(0) }));
vi.mock('@/shared/composables/useCnightDustRegistration', () => ({
  useCnightDustRegistration: () => ({ registrationStatus: ref('Pending'), refreshStatus: vi.fn(), status: ref(null) }),
}));
vi.mock('@/shared/components/DustParticleCanvas.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return { default: defineComponent({ render: () => h('canvas') }) };
});

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import DustGenerationLine from './DustGenerationLine.vue';
import { resetMidnightDataFreshnessForTests } from '@/shared/composables/useMidnightDataFreshness';

// `/api/blocks/latest` `time` is epoch seconds.
const block = (ageMs: number) => ({ hash: 'b', height: 77, time: Math.floor((Date.now() - ageMs) / 1000), slot: 0, epoch: 0, epochSlot: 0 });
const stubs = { 'v-btn': { template: '<button><slot /></button>' }, 'v-icon': true };

enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.useFakeTimers();
  resetMidnightDataFreshnessForTests();
  mocks.latest.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('cNIGHT pending line while Midnight data is paused', () => {
  it('keeps "a few hours" while data is fresh', async () => {
    mocks.latest.mockResolvedValue(block(6_000));
    const w = mount(DustGenerationLine, { global: { stubs } });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(w.find('.dust-line-label').text()).toBe('midnight.dustLinePending');
  });

  it('switches while paused, and switches back once data catches up', async () => {
    mocks.latest.mockResolvedValue(block(30 * 60_000));
    const w = mount(DustGenerationLine, { global: { stubs } });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(mocks.latest).toHaveBeenCalledTimes(1);
    const label = w.find('.dust-line-label');
    expect(label.text()).toBe('midnight.dataPaused.dustLinePending');

    mocks.latest.mockResolvedValue(block(3_000));
    await vi.advanceTimersByTimeAsync(61_000);
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(w.find('.dust-line-label').text()).toBe('midnight.dustLinePending');
  });
});

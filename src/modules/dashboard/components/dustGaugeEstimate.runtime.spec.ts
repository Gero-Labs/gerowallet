import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';

// While Midnight data is paused the DUST balance is a held reading, labelled an
// estimate. That label belongs to a registered wallet's generating balance:
// for an unregistered or registration-pending wallet the registration state
// says more, and must not be replaced by "Estimate · As of block …".
const live = vi.hoisted(() => ({
  status: 'Unregistered' as string,
  paused: false,
  cnightRegistered: false,
}));

vi.mock('@/shared/composables/useMidnightDustLive', () => ({
  useMidnightDustLive: () => ({
    dustBalance: computed(() => 5n * 10n ** 15n),
    dustGenerating: computed(() => (live.status === 'Registered' ? 10n ** 12n : 0n)),
    dustCap: computed(() => 10n ** 16n),
    registrationStatus: computed(() => live.status),
    nightRegistered: computed(() => (live.status === 'Registered' ? 10n ** 6n : 0n)),
    estimate: computed(() => live.paused),
  }),
}));
vi.mock('@/shared/composables/useMidnightDataFreshness', () => ({
  useMidnightDataFreshness: () => ({ heightLabel: ref('1,000'), ageLabel: ref('12 min') }),
}));
vi.mock('@/shared/composables/useDustPathB', () => ({
  useDustPathB: () => ({
    pathBRegistered: computed(() => live.cnightRegistered),
    pathBStakes: computed(() => live.cnightRegistered ? ['active-stake'] : []), pathBIncomingStakes: ref([]),
  }),
}));
vi.mock('@/shared/composables/useDustPending', () => ({
  getDustPendingForDestination: () => [],
  reconcileDustPendingForDestination: vi.fn(async () => {}),
}));
vi.mock('@/shared/composables/useMidnightLoading', () => ({ useMidnightLoading: () => ref(false) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/walletStore', () => ({
  walletStore: { loggedWallet: { id: 1, name: 'W', network: 'Preprod' }, config: { hideBalances: false } },
}));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: { addresses: { dust: '' } } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ cardanoTxExists: vi.fn() }) }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@/modules/dashboard/dialogs/MidnightFeeWalletDialog.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/components/MidnightSponsorStatus.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/dashboard/components/MidnightBattery.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/shared/components/DustParticleCanvas.vue', () => ({ default: { template: '<div />' } }));

import MiniDustGauge from '@/sidepanel/components/MiniDustGauge.vue';
import MidnightDustGauge from './MidnightDustGauge.vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
beforeEach(() => {
  live.status = 'Unregistered';
  live.paused = false;
  live.cnightRegistered = false;
  Object.assign(walletStore.loggedWallet, { network: 'Preprod', baseAddress: '', createdAt: undefined });
});

async function render(component: typeof MiniDustGauge | typeof MidnightDustGauge) {
  const wrapper = mount(component, {
    global: {
      plugins: [createTestVuetify()],
      mocks: { $t: (key: string, params?: Record<string, string>) => (params ? `${key} ${Object.values(params).join(' ')}` : key) },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('dashboard DUST upgrade notice', () => {
  it('shows the mainnet refill notice to a synced, older cNIGHT wallet once', async () => {
    Object.assign(walletStore.loggedWallet, { network: 'Mainnet', baseAddress: 'refill-gauge', createdAt: '2026-11-01' });
    Object.assign(midnightStore, { networkStatus: 'connected', lastSync: Date.now(), tip: { height: 3_400_000 }, transactions: [] });
    live.cnightRegistered = true;
    const view = await render(MidnightDustGauge);
    expect(view.text()).toContain('midnight.dustUpgrade.cnightRefill');
    view.unmount();
    const reopened = await render(MidnightDustGauge);
    expect(reopened.text()).not.toContain('midnight.dustUpgrade.cnightRefill');
  });
});

describe('side panel DUST battery while data is paused', () => {
  it('an unregistered wallet still reads "Not registered", not an estimate', async () => {
    live.paused = true;
    const wrapper = await render(MiniDustGauge);
    expect(wrapper.find('[data-test="dust-estimate"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('midnight.statusUnregistered');
  });

  it('a registration-pending wallet still reads "DUST battery pending"', async () => {
    live.paused = true;
    live.status = 'Pending';
    const wrapper = await render(MiniDustGauge);
    expect(wrapper.find('[data-test="dust-estimate"]').exists()).toBe(false);
    expect(wrapper.find('.mini-dust__pending').text()).toBe('midnight.dustBatteryPending');
  });

  it('a registered wallet shows the estimate caption in place of the rate', async () => {
    live.paused = true;
    live.status = 'Registered';
    const wrapper = await render(MiniDustGauge);
    expect(wrapper.get('[data-test="dust-estimate"]').text()).toContain('midnight.dataPaused.estimateCaption 1,000 12 min');
    expect(wrapper.text()).not.toContain('/s');
  });

  it('a registered wallet shows its rate when data is live', async () => {
    live.status = 'Registered';
    const wrapper = await render(MiniDustGauge);
    expect(wrapper.find('[data-test="dust-estimate"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('tDUST/s');
  });
});

describe('dashboard DUST battery while data is paused', () => {
  it('no "Estimate" label beside an unregistered or pending balance', async () => {
    live.paused = true;
    for (const status of ['Unregistered', 'Pending']) {
      live.status = status;
      const wrapper = await render(MidnightDustGauge);
      expect(wrapper.find('[data-test="dust-estimate"]').exists()).toBe(false);
      wrapper.unmount();
    }
  });

  it('a registered balance is labelled an estimate', async () => {
    live.paused = true;
    live.status = 'Registered';
    const wrapper = await render(MidnightDustGauge);
    expect(wrapper.get('[data-test="dust-estimate"]').text()).toBe('midnight.dataPaused.estimate');
  });
});

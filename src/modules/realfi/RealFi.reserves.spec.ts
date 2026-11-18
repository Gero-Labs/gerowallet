import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealFiOrder, RealFiReservesReport } from './types';

// The page's composable, mocked as in RealFi.spec.ts, plus the reserves report.
const state = {
  isLoading: ref(false),
  unavailableReason: ref<string | null>(null),
  position: ref<Record<string, unknown> | null>(null),
  points: ref({ pointsBalance: null, potentialPoints: null, multiplier: null }),
  referrals: ref({ code: null, invitedCount: 0, rewardPoints: 0 }),
  orders: ref<RealFiOrder[]>([]),
  protocol: ref<Record<string, unknown> | null>(null),
  reserves: ref<RealFiReservesReport | null>(null),
  actionableOrders: ref<RealFiOrder[]>([]),
  reviewOrders: ref<RealFiOrder[]>([]),
  failedOrders: ref<RealFiOrder[]>([]),
  hasPosition: ref(false),
  hasPointsRecord: ref(false),
  usdrBalance: ref(0),
  hasUsdr: ref(false),
  canTransact: ref(false),
  isRequestingCode: ref(false),
  load: vi.fn(),
  requestReferralCode: vi.fn(),
};

vi.mock('./composables/useRealFi', () => ({ useRealFi: () => state }));

vi.mock('@/stores/walletStore', () => ({
  default: { state: { loggedWallet: { network: 'Mainnet', chain: 'Cardano' } } },
}));
vi.mock('@/plugins/i18n', () => ({
  default: {
    locale: 'us',
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}${JSON.stringify(values)}` : key,
    tc: (key: string, n: number) => `${key}(${n})`,
  },
  getLocaleCode: () => 'en-US',
}));

import RealFiSfc from './RealFi.vue';

const RealFi = RealFiSfc as unknown as Parameters<typeof mount>[0];

function mountPage() {
  return mount(RealFi, {
    global: {
      config: {
        globalProperties: mockGlobalProperties({
          $t: (key: string, values?: Record<string, unknown> | number) =>
            typeof values === 'number' ? `${key}(${values})` : values ? `${key}${JSON.stringify(values)}` : key,
        }),
      },
      stubs: {
        'v-row': { template: '<div><slot /></div>' },
        'v-col': { template: '<div><slot /></div>' },
        'v-btn': { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
        'v-icon': { template: '<i />' },
        IsoScene: true,
      },
    },
  });
}

/** Made-up figures: RealFi's own feed is private. */
const NAV_ONLY: RealFiReservesReport = {
  publishedAt: null,
  reserves: null,
  supply: null,
  nav: { asOf: '2026-01-02', totalUsd: 1_000_000, perToken: 1.002, tokensOutstanding: null, source: 'NFS' },
  coverage: null,
  history: { supply: [], nav: [] },
};

describe('RealFi Earn page: reserves', () => {
  beforeEach(() => {
    state.reserves.value = null;
  });

  it('has no reserves section while Nexus has no feed for the network', () => {
    expect(mountPage().find('.realfi-reserves').exists()).toBe(false);
  });

  it('has no section for a report with neither custody nor NAV', () => {
    state.reserves.value = { ...NAV_ONLY, nav: null };
    expect(mountPage().find('.realfi-reserves').exists()).toBe(false);
  });

  it('shows the section before anything is staked', () => {
    state.reserves.value = NAV_ONLY;
    const page = mountPage();
    expect(page.find('.realfi-start').exists()).toBe(true);
    expect(page.find('.realfi-reserves').text()).toContain('$1.0020');
  });
});

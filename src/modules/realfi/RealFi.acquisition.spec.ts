import { reactive, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const swapEnabled = ref(false);
const openSpy = vi.fn();
const wallet = reactive<Record<string, unknown>>({
  id: 1,
  network: 'Mainnet',
  chain: 'Cardano',
  baseAddress: 'addr_main_a',
});
const state = {
  isLoading: ref(false),
  unavailableReason: ref<string | null>(null),
  position: ref<Record<string, unknown> | null>(null),
  points: ref({ pointsBalance: null, potentialPoints: null, multiplier: null }),
  referrals: ref({ code: null, invitedCount: 0, rewardPoints: 0 }),
  orders: ref<unknown[]>([]),
  protocol: ref<Record<string, unknown> | null>(null),
  actionableOrders: ref<unknown[]>([]),
  reviewOrders: ref<unknown[]>([]),
  failedOrders: ref<unknown[]>([]),
  hasPosition: ref(false),
  hasPointsRecord: ref(false),
  usdrBalance: ref(0),
  hasUsdr: ref(false),
  usdrUnits: ref('0'),
  susdrUnits: ref('0'),
  susdrBalance: ref(0),
  canTransact: ref(true),
  currentSlot: ref<number | null>(1),
  isRequestingCode: ref(false),
  load: vi.fn(),
  requestReferralCode: vi.fn(),
};

vi.mock('./composables/useRealFi', () => ({ useRealFi: () => state }));
vi.mock('./components/RealFiOrderFlow.vue', () => ({
  __esModule: true,
  default: { name: 'RealFiOrderFlow', render: (h: (tag: string) => unknown) => h('div') },
}));
vi.mock('./components/RealFiAmountDialog.vue', () => ({
  __esModule: true,
  default: { name: 'RealFiAmountDialog', render: (h: (tag: string) => unknown) => h('div') },
}));
vi.mock('@/stores/featureFlagsStore', () => ({
  default: { isSwapEnabled: () => swapEnabled.value },
}));
vi.mock('@/stores/walletStore', () => ({
  default: {
    state: {
      get loggedWallet() {
        return wallet;
      },
    },
  },
}));
vi.mock('@/plugins/i18n', () => ({
  default: { locale: 'en-US', t: (key: string) => key },
}));
vi.mock('@/modules/dashboard/dialogs/SwapDialog.vue', () => ({
  __esModule: true,
  default: {
    name: 'SwapDialog',
    props: ['isOpen', 'sellTokenUnit', 'buyTokenUnit'],
    render: (h: (tag: string) => unknown) => h('div'),
  },
}));

import RealFiSfc from './RealFi.vue';

const RealFi = RealFiSfc as unknown as Parameters<typeof mount>[0];
const USDCX = '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378';
const USDRF = '7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae55534472';

async function settle(page: { vm: { $nextTick(): Promise<void> } }) {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await page.vm.$nextTick();
  }
}

async function mountPage() {
  const page = mount(RealFi, {
    mocks: {
      $t: (key: string, values?: Record<string, unknown>) =>
        values ? `${key}${JSON.stringify(values)}` : key,
      $tc: (key: string, n: number) => `${key}(${n})`,
    },
    stubs: {
      'v-layout': { template: '<div><slot /></div>' },
      'v-row': { template: '<div><slot /></div>' },
      'v-col': { template: '<div><slot /></div>' },
      'v-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
      'v-progress-circular': true,
    },
  });
  await settle(page);
  return page;
}

type Page = Awaited<ReturnType<typeof mountPage>>;

function button(page: Page, label: string) {
  const found = page.findAll('button').wrappers.find((item) => item.text() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

describe('RealFi acquisition', () => {
  beforeEach(() => {
    wallet.id = 1;
    wallet.network = 'Mainnet';
    wallet.chain = 'Cardano';
    wallet.baseAddress = 'addr_main_a';
    swapEnabled.value = false;
    state.isLoading.value = false;
    state.unavailableReason.value = null;
    state.position.value = null;
    state.hasPosition.value = false;
    state.hasUsdr.value = false;
    state.usdrBalance.value = 0;
    state.usdrUnits.value = '0';
    state.canTransact.value = true;
    state.orders.value = [];
    state.protocol.value = null;
    state.load.mockReset();
    openSpy.mockReset();
    vi.stubGlobal('open', openSpy);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows eligibility before either acquisition option and never marks an external click complete', async () => {
    swapEnabled.value = true;
    const page = await mountPage();
    const labels = page.findAll('.realfi-getting-started__step .t-label').wrappers.map((item) => item.text());
    expect(labels.slice(0, 3)).toEqual([
      'realfi.gettingStarted.eligibilityTitle',
      'realfi.gettingStarted.acquireTitle',
      'realfi.gettingStarted.stakeTitle',
    ]);
    const policy = page.find('.realfi-getting-started__policy');
    expect(policy.attributes('href')).toBe('https://docs.realfi.co/compliance/jurisdictional-eligibility');
    expect(policy.attributes('target')).toBe('_blank');
    expect(policy.attributes('rel')).toBe('noopener noreferrer');
    expect(page.text()).not.toContain('realfi.gettingStarted.eligibilityComplete');
    await button(page, 'realfi.gettingStarted.eligibilityCta').trigger('click');
    expect(openSpy).toHaveBeenCalledWith('https://app.realfi.co', '_blank', 'noopener,noreferrer');
    expect(page.text()).not.toContain('realfi.gettingStarted.eligibilityComplete');
    expect(page.text()).toContain('realfi.gettingStarted.getUsdrf');
  });

  it('preselects USDCx to USDrf in the mainnet acquisition dialog', async () => {
    swapEnabled.value = true;
    const page = await mountPage();
    await button(page, 'realfi.gettingStarted.getUsdrf').trigger('click');
    await settle(page);
    const dialog = page.findComponent({ name: 'SwapDialog' });
    expect(dialog.exists()).toBe(true);
    expect(dialog.props('sellTokenUnit')).toBe(USDCX);
    expect(dialog.props('buyTokenUnit')).toBe(USDRF);
  });

  it('preselects ADA to USDCx as a separate swap and quietly refreshes on close', async () => {
    swapEnabled.value = true;
    const page = await mountPage();
    await button(page, 'realfi.gettingStarted.getUsdcx').trigger('click');
    await settle(page);
    const dialog = page.findComponent({ name: 'SwapDialog' });
    expect(dialog.props('sellTokenUnit')).toBe('lovelace');
    expect(dialog.props('buyTokenUnit')).toBe(USDCX);
    dialog.vm.$emit('close');
    await page.vm.$nextTick();
    expect(state.load).toHaveBeenCalledWith({ quiet: true });
    expect(state.hasUsdr.value).toBe(false);
  });

  it('does not expose wallet acquisition off mainnet or while swaps are disabled', async () => {
    swapEnabled.value = true;
    wallet.network = 'Preprod';
    const page = await mountPage();
    expect(page.text()).toContain('realfi.gettingStarted.preprodCta');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdcx');
    expect(page.findComponent({ name: 'SwapDialog' }).exists()).toBe(false);
    expect(page.text()).toContain('realfi.gettingStarted.preprodAcquireBody');
  });

  it('keeps the mainnet onboarding guide when the swap flag is off', async () => {
    const page = await mountPage();
    expect(page.text()).toContain('realfi.gettingStarted.eligibilityTitle');
    expect(page.text()).toContain('realfi.gettingStarted.swapUnavailable');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdrf');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdcx');
  });

  it('closes the swap dialog when the live swap flag is disabled', async () => {
    swapEnabled.value = true;
    const page = await mountPage();
    await button(page, 'realfi.gettingStarted.getUsdrf').trigger('click');
    await settle(page);
    expect(page.findComponent({ name: 'SwapDialog' }).exists()).toBe(true);
    state.load.mockClear();
    swapEnabled.value = false;
    await page.vm.$nextTick();
    expect(page.findComponent({ name: 'SwapDialog' }).exists()).toBe(false);
    expect(state.load).not.toHaveBeenCalled();
  });

  it('closes an open dialog when the wallet changes and does not refresh the new wallet as a close side effect', async () => {
    swapEnabled.value = true;
    const page = await mountPage();
    await button(page, 'realfi.gettingStarted.getUsdrf').trigger('click');
    await settle(page);
    expect(page.findComponent({ name: 'SwapDialog' }).exists()).toBe(true);
    state.load.mockClear();
    wallet.baseAddress = 'addr_main_b';
    await page.vm.$nextTick();
    expect(page.findComponent({ name: 'SwapDialog' }).exists()).toBe(false);
    expect(state.load).not.toHaveBeenCalled();
  });

  it('keeps a top-up action for existing positions while preserving transaction gates', async () => {
    swapEnabled.value = true;
    state.hasPosition.value = true;
    state.position.value = { totalSUSDr: '1000000', totalUSDrValue: '1000000', principal: '1000000', earned: '0', yieldPercent: 0 };
    state.hasUsdr.value = true;
    state.usdrBalance.value = 1;
    state.canTransact.value = false;
    const page = await mountPage();
    expect(page.text()).toContain('realfi.gettingStarted.getUsdrf');
    expect(page.findAll('button').wrappers.map((item) => item.text())).not.toContain('realfi.stakeAction');
    expect(page.find('.realfi-guide-disclosure').exists()).toBe(true);
  });
});

import { reactive, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const swapEnabled = ref(false);
const usdrfSwapFlag = ref(true);
const openSpy = vi.fn();
const tokenCatalogStore = vi.hoisted(() => {
  const store: {
    tokens: Record<string, unknown>;
    state: { tokens: Record<string, unknown> };
    loadTokens: ReturnType<typeof vi.fn>;
  } = { tokens: {}, state: { tokens: {} }, loadTokens: vi.fn() };
  store.state = store;
  return store;
});
const mountedPages: Array<{ destroy: () => void }> = [];
const wallet = reactive<{ id: number; network: string; chain: string; baseAddress: string }>({
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
  default: {
    isSwapEnabled: () => swapEnabled.value,
    isRealFiUsdrfSwapEnabled: () => usdrfSwapFlag.value,
  },
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
vi.mock('@/stores/tokenMetadataStore', () => ({ default: tokenCatalogStore }));
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
import WalletStoreMock from '@/stores/walletStore';

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
  mountedPages.push(page);
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
    usdrfSwapFlag.value = true;
    tokenCatalogStore.tokens = {};
    tokenCatalogStore.state.tokens = tokenCatalogStore.tokens;
    tokenCatalogStore.loadTokens.mockReset().mockImplementation(async (shouldApply?: () => boolean) => {
      const next = {
        '7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae55534472': {
          unit: '7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae55534472',
          decimals: 6,
        },
        '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378': {
          unit: '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378',
          decimals: 6,
        },
      };
      if (shouldApply && !shouldApply()) return false;
      tokenCatalogStore.tokens = next;
      tokenCatalogStore.state.tokens = next;
      return true;
    });
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
    mountedPages.splice(0).forEach((page) => page.destroy());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows eligibility before either acquisition option and never marks an external click complete', async () => {
    swapEnabled.value = true;
    const page = await mountPage();
    const labels = page.findAll('.realfi-getting-started__step .t-label').wrappers.map((item) => item.text());
    expect(labels.slice(0, 4)).toEqual([
      'realfi.gettingStarted.eligibilityTitle',
      'realfi.gettingStarted.usdcxTitle',
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
    expect(tokenCatalogStore.loadTokens).toHaveBeenCalled();
    expect(tokenCatalogStore.tokens[USDRF]).toEqual({ unit: USDRF, decimals: 6 });
  });

  it('keeps USDCx acquisition but holds the USDCx to USDrf swap while its flag is off', async () => {
    swapEnabled.value = true;
    usdrfSwapFlag.value = false;
    state.hasPosition.value = true;
    state.position.value = { totalSUSDr: '1000000', totalUSDrValue: '1000000', principal: '1000000', earned: '0', yieldPercent: 0 };
    const page = await mountPage();
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdrf');
    expect(page.text()).toContain('realfi.gettingStarted.usdrfSwapPending');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdcxNote');
    await button(page, 'realfi.gettingStarted.getUsdcx').trigger('click');
    await settle(page);
    const dialog = page.findComponent({ name: 'SwapDialog' });
    expect(dialog.props('sellTokenUnit')).toBe('lovelace');
    expect(dialog.props('buyTokenUnit')).toBe(USDCX);
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
    expect(tokenCatalogStore.loadTokens).not.toHaveBeenCalled();
  });

  it('keeps the mainnet onboarding guide when the swap flag is off', async () => {
    const page = await mountPage();
    expect(page.text()).toContain('realfi.gettingStarted.eligibilityTitle');
    expect(page.text()).toContain('realfi.gettingStarted.swapStatus.disabled');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdrf');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdcx');
    expect(tokenCatalogStore.loadTokens).not.toHaveBeenCalled();
  });

  it('fails closed while availability is loading and when USDrf is absent from the catalogue', async () => {
    swapEnabled.value = true;
    let resolveLoad!: (loaded: boolean) => void;
    tokenCatalogStore.loadTokens.mockImplementation(() => new Promise((resolve) => {
      resolveLoad = resolve;
    }));
    const page = await mountPage();
    expect(page.text()).toContain('realfi.gettingStarted.swapStatus.loading');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdrf');
    resolveLoad(true);
    await settle(page);
    expect(page.text()).toContain('realfi.gettingStarted.swapStatus.unavailable');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdrf');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdcx');
  });

  it('fails closed when the fixed USDCx-to-USDrf pair is missing USDCx from the catalogue', async () => {
    swapEnabled.value = true;
    tokenCatalogStore.loadTokens.mockImplementation(async (shouldApply?: () => boolean) => {
      if (shouldApply && !shouldApply()) return false;
      tokenCatalogStore.tokens = { [USDRF]: { unit: USDRF, decimals: 6 } };
      tokenCatalogStore.state.tokens = tokenCatalogStore.tokens;
      return true;
    });
    const page = await mountPage();
    expect(page.text()).toContain('realfi.gettingStarted.swapStatus.unavailable');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdrf');
    expect(page.text()).not.toContain('realfi.gettingStarted.getUsdcx');
  });

  it('does not apply a catalog response after the wallet account changes', async () => {
    swapEnabled.value = true;
    let isCurrent: (() => boolean) | undefined;
    tokenCatalogStore.loadTokens.mockImplementationOnce(async (shouldApply?: () => boolean) => {
      isCurrent = shouldApply;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (shouldApply && !shouldApply()) return false;
      tokenCatalogStore.tokens = {
        [USDRF]: { unit: USDRF, decimals: 6 },
      };
      tokenCatalogStore.state.tokens = tokenCatalogStore.tokens;
      return true;
    });
    const page = mountPage();
    wallet.baseAddress = 'addr_main_changed_during_fetch';
    await page.then((mounted) => mounted.vm.$nextTick());
    await settle(await page);
    expect(isCurrent?.()).toBe(false);
    expect(tokenCatalogStore.tokens[USDRF]).toEqual({ unit: USDRF, decimals: 6 });
    expect((await page).text()).toContain('realfi.gettingStarted.getUsdrf');
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

  it('closes an open USDrf swap when the USDrf swap flag is switched off', async () => {
    swapEnabled.value = true;
    const page = await mountPage();
    await button(page, 'realfi.gettingStarted.getUsdrf').trigger('click');
    await settle(page);
    expect(page.findComponent({ name: 'SwapDialog' }).exists()).toBe(true);
    state.load.mockClear();
    usdrfSwapFlag.value = false;
    await page.vm.$nextTick();
    expect(page.findComponent({ name: 'SwapDialog' }).exists()).toBe(false);
    expect(state.load).not.toHaveBeenCalled();
  });

  it('keeps an open ADA to USDCx swap when the USDrf swap flag is switched off', async () => {
    swapEnabled.value = true;
    const page = await mountPage();
    await button(page, 'realfi.gettingStarted.getUsdcx').trigger('click');
    await settle(page);
    usdrfSwapFlag.value = false;
    await page.vm.$nextTick();
    const dialog = page.findComponent({ name: 'SwapDialog' });
    expect(dialog.exists()).toBe(true);
    expect(dialog.props('buyTokenUnit')).toBe(USDCX);
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

  describe('holdings-aware acquisition', () => {
    // The walletStore mock above exposes only loggedWallet; these cases add balances.
    const walletState = WalletStoreMock.state as unknown as Record<string, unknown>;
    afterEach(() => {
      delete walletState['tokens'];
    });

    function guideButtons(page: Page): string[] {
      return page.findAll('.realfi-getting-started__actions button').wrappers.map((item) => item.text());
    }

    it('offers ADA to USDCx while USDrf is missing from the swap catalogue', async () => {
      swapEnabled.value = true;
      tokenCatalogStore.loadTokens.mockImplementation(async (shouldApply?: () => boolean) => {
        if (shouldApply && !shouldApply()) return false;
        tokenCatalogStore.tokens = { [USDCX]: { unit: USDCX, decimals: 6 } };
        tokenCatalogStore.state.tokens = tokenCatalogStore.tokens;
        return true;
      });
      const page = await mountPage();
      expect(page.text()).not.toContain('realfi.gettingStarted.swapStatus.unavailable');
      expect(page.text()).toContain('realfi.gettingStarted.needUsdcx');
      expect(guideButtons(page)).toEqual(['realfi.gettingStarted.getUsdcx', 'realfi.start.cta']);
      await button(page, 'realfi.gettingStarted.getUsdcx').trigger('click');
      await settle(page);
      const dialog = page.findComponent({ name: 'SwapDialog' });
      expect(dialog.props('sellTokenUnit')).toBe('lovelace');
      expect(dialog.props('buyTokenUnit')).toBe(USDCX);
      await button(page, 'realfi.start.cta').trigger('click');
      expect(openSpy).toHaveBeenCalledWith('https://app.realfi.co', '_blank', 'noopener,noreferrer');
    });

    it('reads USDCx from the wallet and leads with the USDrf swap', async () => {
      swapEnabled.value = true;
      walletState['tokens'] = { [USDCX]: { quantity: '12500000' } };
      const page = await mountPage();
      expect(page.text()).toContain('realfi.gettingStarted.haveUsdcx');
      expect(page.text()).toContain('12.50 USDCx');
      expect(guideButtons(page)[0]).toBe('realfi.gettingStarted.getUsdrf');
    });
  });
});

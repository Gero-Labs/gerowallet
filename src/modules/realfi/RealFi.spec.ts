import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealFiOrder } from './types';

// Everything the page reads is mocked at the composable, so these tests cover what
// the Earn page SHOWS for each state — the part a launch-day user actually sees.
const state = {
  isLoading: ref(false),
  unavailableReason: ref<string | null>(null),
  position: ref<Record<string, unknown> | null>(null),
  points: ref({ pointsBalance: null, potentialPoints: null, multiplier: null }),
  referrals: ref<{ code: string | null; invitedCount: number; rewardPoints: number }>({
    code: null,
    invitedCount: 0,
    rewardPoints: 0,
  }),
  orders: ref<RealFiOrder[]>([]),
  protocol: ref<Record<string, unknown> | null>(null),
  actionableOrders: ref<RealFiOrder[]>([]),
  reviewOrders: ref<RealFiOrder[]>([]),
  failedOrders: ref<RealFiOrder[]>([]),
  hasPosition: ref(false),
  hasPointsRecord: ref(false),
  usdrBalance: ref(0),
  hasUsdr: ref(false),
  isRequestingCode: ref(false),
  load: vi.fn(),
  requestReferralCode: vi.fn(),
};

vi.mock('./composables/useRealFi', () => ({ useRealFi: () => state }));

const wallet = { network: 'Mainnet' };
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
  default: {
    locale: 'en-US',
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}${JSON.stringify(values)}` : key,
  },
}));

import RealFiSfc from './RealFi.vue';

// test-utils v1's mount() typings predate <script setup> components.
const RealFi = RealFiSfc as unknown as Parameters<typeof mount>[0];

function mountPage() {
  return mount(RealFi, {
    mocks: {
      $t: (key: string, values?: Record<string, unknown>) =>
        values ? `${key}${JSON.stringify(values)}` : key,
      $tc: (key: string, n: number) => `${key}(${n})`,
    },
    stubs: {
      'v-layout': { template: '<div><slot /></div>' },
      'v-row': { template: '<div><slot /></div>' },
      'v-col': { template: '<div><slot /></div>' },
      // GButton renders a v-btn and forwards its listeners to it, so stubbing v-btn
      // keeps GButton's own wiring in the path under test.
      'v-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
    },
  });
}

type Page = ReturnType<typeof mountPage>;

function button(page: Page, label: string) {
  const found = page.findAll('button').wrappers.find((b) => b.text() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

const POSITION = {
  totalSUSDr: '1000000000',
  totalUSDrValue: '1010000000',
  principal: '1000000000',
  earned: '10000000',
  yieldPercent: 1,
};

let nextIndex = 0;

/** Each call is a distinct order (same tx, next output), so row keys never collide. */
function order(status: RealFiOrder['status'], action: RealFiOrder['action'] = 'Stake'): RealFiOrder {
  return {
    txHash: 'd26ab71e901bd3375a77e2674bd17fc487b5cf8be2ac0c33e0cf20a6e80690f6',
    outputIndex: nextIndex++,
    action,
    status,
  };
}

/** Put the page in its dashboard state with the given orders. */
function withOrders(orders: RealFiOrder[]) {
  state.position.value = POSITION;
  state.hasPosition.value = true;
  state.orders.value = orders;
}

describe('RealFi Earn page', () => {
  const openSpy = vi.fn();

  beforeEach(() => {
    wallet.network = 'Mainnet';
    state.position.value = null;
    state.hasPosition.value = false;
    state.orders.value = [];
    state.actionableOrders.value = [];
    state.reviewOrders.value = [];
    state.failedOrders.value = [];
    state.hasUsdr.value = false;
    state.usdrBalance.value = 0;
    state.protocol.value = null;
    state.referrals.value = { code: null, invitedCount: 0, rewardPoints: 0 };
    state.requestReferralCode.mockReset();
    openSpy.mockReset();
    vi.stubGlobal('open', openSpy);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('first look', () => {
    it('greets a wallet with nothing staked instead of rendering $0.00', () => {
      const text = mountPage().text();
      expect(text).toContain('realfi.start.title');
      expect(text).not.toContain('realfi.position.label');
    });

    it('tells a wallet already holding USDrf to stake it, with the amount', () => {
      state.hasUsdr.value = true;
      state.usdrBalance.value = 250;
      const text = mountPage().text();
      expect(text).toContain('realfi.start.readyTitle');
      expect(text).toContain('USDrf');
    });

    it('sends mainnet wallets to RealFi mainnet, never preprod', async () => {
      await button(mountPage(), 'realfi.start.cta').trigger('click');
      expect(openSpy).toHaveBeenCalledWith('https://app.realfi.co', '_blank', 'noopener,noreferrer');
    });

    it('sends preprod wallets to RealFi preprod', async () => {
      wallet.network = 'Preprod';
      await button(mountPage(), 'realfi.start.cta').trigger('click');
      expect(openSpy).toHaveBeenCalledWith('https://preprod.realfi.co', '_blank', 'noopener,noreferrer');
    });

    it('shows the test-funds note on preprod only', () => {
      expect(mountPage().text()).not.toContain('realfi.preview');
      wallet.network = 'Preprod';
      expect(mountPage().text()).toContain('realfi.preview');
    });

    it('shows the position once there is one', () => {
      withOrders([]);
      const text = mountPage().text();
      expect(text).toContain('realfi.position.label');
      expect(text).not.toContain('realfi.start.title');
    });
  });

  describe('referral codes', () => {
    it('fetches a code only when the user taps for it', async () => {
      withOrders([]);
      const page = mountPage();
      expect(state.requestReferralCode).not.toHaveBeenCalled();

      await button(page, 'realfi.referrals.get').trigger('click');
      expect(state.requestReferralCode).toHaveBeenCalledTimes(1);
    });

    it('shows the code, not the button, once there is one', () => {
      withOrders([]);
      state.referrals.value = { code: 'H1FBW1jAV1Z', invitedCount: 2, rewardPoints: 40 };
      const text = mountPage().text();
      expect(text).toContain('H1FBW1jAV1Z');
      expect(text).not.toContain('realfi.referrals.get');
    });
  });

  describe('fund APY', () => {
    it('never shows an APY without its date', () => {
      state.protocol.value = { apyPercent: 14, apyAsOf: null };
      expect(mountPage().text()).not.toContain('realfi.apy');
    });

    it('shows no APY at all while RealFi publishes none — the case at launch', () => {
      state.protocol.value = { apyPercent: null, apyAsOf: null };
      expect(mountPage().text()).not.toContain('realfi.apy');
    });

    it('shows rate and date together when RealFi publishes both', () => {
      state.protocol.value = { apyPercent: 14, apyAsOf: '2026-05-08' };
      const text = mountPage().text();
      expect(text).toContain('realfi.apy');
      expect(text).toContain('14.0');
    });
  });

  describe('order states added in SDK 2.18 and 3.1', () => {
    it('labels and colours every status, new ones included', () => {
      withOrders([
        order('HeldForScreening'),
        order('InvalidatedBlockedScreening'),
        order('Failed'),
        order('Rejected'),
        order('Executed'),
      ]);
      const pills = mountPage().findAll('.realfi-pill').wrappers;
      expect(pills.map((p) => p.text())).toEqual([
        'realfi.statuses.heldForScreening',
        'realfi.statuses.invalidatedBlockedScreening',
        'realfi.statuses.failed',
        'realfi.statuses.rejected',
        'realfi.statuses.executed',
      ]);
      // In review is "still working"; the three failures read as problems.
      expect(pills[0]!.classes()).toContain('realfi-pill--wait');
      expect(pills[1]!.classes()).toContain('realfi-pill--warn');
      expect(pills[2]!.classes()).toContain('realfi-pill--warn');
      expect(pills[3]!.classes()).toContain('realfi-pill--warn');
      expect(pills[4]!.classes()).toContain('realfi-pill--ok');
    });

    it('labels the new DirectMint / DirectBurn actions', () => {
      withOrders([order('Executed', 'DirectMint'), order('Executed', 'DirectBurn')]);
      const text = mountPage().text();
      expect(text).toContain('realfi.actions.directMint');
      expect(text).toContain('realfi.actions.directBurn');
    });

    it('explains an order in compliance review and asks nothing of the user', () => {
      const held = order('HeldForScreening');
      withOrders([held]);
      state.reviewOrders.value = [held];
      const page = mountPage();
      expect(page.text()).toContain('realfi.review.title');
      expect(page.text()).toContain('realfi.review.body(1)');
      // No call to action: there is nothing the user can or should do.
      expect(page.find('.realfi-notice').findAll('button')).toHaveLength(0);
    });

    it('sends a failed order to RealFi support, with the tx id visible to quote', async () => {
      const failed = order('Failed');
      withOrders([failed]);
      state.failedOrders.value = [failed];
      const page = mountPage();

      expect(page.text()).toContain('realfi.failed.body(1)');
      expect(page.text()).toContain('d26ab7…0690f6');
      await button(page, 'realfi.failed.cta').trigger('click');
      expect(openSpy).toHaveBeenCalledWith('https://realfi.co/contact', '_blank', 'noopener,noreferrer');
    });

    it('gives the needs-action banner a way to act, on the right network', async () => {
      const stranded = order('InvalidMinReceived');
      withOrders([stranded]);
      state.actionableOrders.value = [stranded];
      await button(mountPage(), 'realfi.attention.cta').trigger('click');
      expect(openSpy).toHaveBeenCalledWith('https://app.realfi.co', '_blank', 'noopener,noreferrer');
    });

    it('keeps two orders from one transaction apart', () => {
      withOrders([order('Open'), order('Executed')]);
      expect(mountPage().findAll('.realfi-order')).toHaveLength(2);
    });
  });
});

import { computed, reactive, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isClaimable } from './types';
import type { RealFiOrder } from './types';

// The Earn page with in-wallet orders ON. RealFi.spec.ts covers the hand-off to
// RealFi's app that the page falls back to when they are off.

const { run } = vi.hoisted(() => ({ run: vi.fn() }));

const currentSlot = ref<number | null>(2000);
const orders = ref<RealFiOrder[]>([]);
const state = {
  isLoading: ref(false),
  unavailableReason: ref<string | null>(null),
  position: ref<Record<string, unknown> | null>(null),
  points: ref({ pointsBalance: null, potentialPoints: null, multiplier: null }),
  referrals: ref({ code: null, invitedCount: 0, rewardPoints: 0 }),
  orders,
  protocol: ref<Record<string, unknown> | null>({ nextCooldownSlot: '5000' }),
  actionableOrders: ref<RealFiOrder[]>([]),
  reviewOrders: ref<RealFiOrder[]>([]),
  failedOrders: ref<RealFiOrder[]>([]),
  hasPosition: ref(false),
  hasPointsRecord: ref(false),
  usdrBalance: ref(25),
  usdrUnits: ref('25000000'),
  hasUsdr: ref(true),
  susdrBalance: ref(0),
  susdrUnits: ref('0'),
  canTransact: ref(true),
  currentSlot,
  claimableOrders: computed(() => orders.value.filter((o) => isClaimable(o, currentSlot.value))),
  isRequestingCode: ref(false),
  load: vi.fn(),
  requestReferralCode: vi.fn(),
};

vi.mock('./composables/useRealFi', () => ({ useRealFi: () => state }));
// `__esModule` lets Vue 2's async-component resolver unwrap `default`.
vi.mock('./components/RealFiOrderFlow.vue', () => ({
  __esModule: true,
  default: { name: 'RealFiOrderFlow', render: (h: (tag: string) => unknown) => h('div'), methods: { run } },
}));
vi.mock('./components/RealFiAmountDialog.vue', () => ({
  __esModule: true,
  default: {
    name: 'RealFiAmountDialog',
    props: ['isOpen', 'mode', 'balanceUnits', 'unlockDate'],
    render: (h: (tag: string) => unknown) => h('div'),
  },
}));

// Reactive, so a test can switch wallets under a page that stays mounted.
// baseAddress is declared up front: Vue 2 does not track a property added later.
const wallet = reactive<Record<string, unknown>>({ network: 'Preprod', baseAddress: undefined });
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

import RealFiSfc from './RealFi.vue';

const RealFi = RealFiSfc as unknown as Parameters<typeof mount>[0];

/** The flow and the amount dialog are async components: let them resolve and render. */
async function settle(page: { vm: { $nextTick(): Promise<void> } }) {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
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
  const found = page.findAll('button').wrappers.find((b) => b.text() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

function amountDialog(page: Page) {
  return page.findComponent({ name: 'RealFiAmountDialog' });
}

const TX = 'd26ab71e901bd3375a77e2674bd17fc487b5cf8be2ac0c33e0cf20a6e80690f6';
let nextIndex = 0;
function order(partial: Partial<RealFiOrder>): RealFiOrder {
  return { txHash: TX, outputIndex: nextIndex++, action: 'Stake', status: 'Open', ...partial };
}

function withPosition(list: RealFiOrder[]) {
  state.position.value = {
    totalSUSDr: '1000000',
    totalUSDrValue: '1000000',
    principal: '1000000',
    earned: '0',
    yieldPercent: 0,
  };
  state.hasPosition.value = true;
  orders.value = list;
}

describe('RealFi Earn page, in-wallet orders', () => {
  const openSpy = vi.fn();

  beforeEach(() => {
    run.mockReset();
    state.load.mockReset();
    openSpy.mockReset();
    window.open = openSpy as unknown as typeof window.open;
    state.position.value = null;
    state.hasPosition.value = false;
    state.hasUsdr.value = true;
    state.susdrBalance.value = 0;
    state.susdrUnits.value = '0';
    state.protocol.value = { nextCooldownSlot: '5000' };
    state.actionableOrders.value = [];
    orders.value = [];
    currentSlot.value = 2000;
  });

  it('stakes from the start card instead of sending the user to RealFi', async () => {
    const page = await mountPage();

    await button(page, 'realfi.start.stakeCta').trigger('click');
    await settle(page);

    expect(openSpy).not.toHaveBeenCalled();
    expect(amountDialog(page).props()).toMatchObject({ mode: 'stake', balanceUnits: '25000000' });
    expect(page.text()).not.toContain('realfi.start.note');
  });

  it('places a stake for the confirmed amount', async () => {
    const page = await mountPage();
    await button(page, 'realfi.start.stakeCta').trigger('click');
    await settle(page);

    amountDialog(page).vm.$emit('confirm', '12500000');

    expect(run).toHaveBeenCalledWith({ kind: 'stake', amount: '12500000' });
  });

  it("unstakes against the protocol's next cooldown boundary", async () => {
    withPosition([]);
    state.susdrBalance.value = 3;
    state.susdrUnits.value = '3000000';
    const page = await mountPage();

    await button(page, 'staking.unstake').trigger('click');
    await settle(page);
    expect(amountDialog(page).props()).toMatchObject({ mode: 'unstake', balanceUnits: '3000000' });
    amountDialog(page).vm.$emit('confirm', '1000000');

    expect(run).toHaveBeenCalledWith({ kind: 'unstake', amount: '1000000', unlockSlot: '5000' });
  });

  it('offers no unstake while RealFi gives no cooldown boundary to bind to', async () => {
    withPosition([]);
    state.susdrBalance.value = 3;
    state.protocol.value = { nextCooldownSlot: null };
    const page = await mountPage();

    expect(page.findAll('button').wrappers.map((b) => b.text())).not.toContain('staking.unstake');
  });

  it('cancels every stranded order in one transaction', async () => {
    const stranded = [order({ status: 'Invalidated' }), order({ status: 'InvalidMinReceived' })];
    withPosition(stranded);
    state.actionableOrders.value = stranded;
    const page = await mountPage();

    await button(page, 'realfi.attention.cancelCta(2)').trigger('click');

    expect(openSpy).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith({
      kind: 'cancel',
      orderInputs: stranded.map((o) => ({ txHash: o.txHash, index: o.outputIndex })),
    });
  });

  it('claims an unlocked unstake with the slot and output from the order itself', async () => {
    const unlocked = order({
      action: 'Unstake',
      status: 'Executed',
      unlockSlot: '1500',
      resultTxHash: TX,
      resultOutputIndex: 2,
    });
    withPosition([unlocked]);
    const page = await mountPage();

    expect(page.text()).toContain('realfi.claim.title');
    await button(page, 'dashboard.claim').trigger('click');

    expect(run).toHaveBeenCalledWith({
      kind: 'claim',
      resultUtxo: { txHash: TX, index: 2 },
      unlockSlot: '1500',
    });
  });

  it('shows when a cooling-down unstake can be claimed, and no claim yet', async () => {
    withPosition([
      order({
        action: 'Unstake',
        status: 'Executed',
        unlockSlot: '9000',
        resultTxHash: TX,
        resultOutputIndex: 2,
      }),
    ]);
    const page = await mountPage();

    expect(page.text()).toContain('realfi.claim.from');
    expect(page.text()).not.toContain('realfi.claim.title');
    expect(page.findAll('button').wrappers.map((b) => b.text())).not.toContain('dashboard.claim');
  });

  it('lets the owner cancel a single open order from its row', async () => {
    const open = order({ status: 'Open' });
    withPosition([open]);
    const page = await mountPage();

    await button(page, 'realfi.cancel.cta').trigger('click');

    expect(run).toHaveBeenCalledWith({
      kind: 'cancel',
      orderInputs: [{ txHash: TX, index: open.outputIndex }],
    });
  });

  it('reloads once an order is on chain', async () => {
    const page = await mountPage();

    page.findComponent({ name: 'RealFiOrderFlow' }).vm.$emit('placed', 'tx', 'stake');

    expect(state.load).toHaveBeenCalled();
  });
});

describe('RealFi Earn page, right after an order is sent', () => {
  beforeEach(() => {
    state.load.mockReset();
    state.position.value = null;
    state.hasPosition.value = false;
    state.hasUsdr.value = true;
    state.actionableOrders.value = [];
    orders.value = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The Activity row for the order on its way, shown like an unconfirmed home-screen tx. */
  const pendingRow = (page: Page) => page.find('.realfi-order--pending');

  async function placeOrder(txId: string, kind = 'stake') {
    const page = await mountPage();
    state.load.mockClear(); // count only what follows the order, not the page's own first load
    vi.useFakeTimers();
    page.findComponent({ name: 'RealFiOrderFlow' }).vm.$emit('placed', txId, kind);
    await page.vm.$nextTick();
    return page;
  }

  it('says the order was sent and offers no second one while RealFi catches up', async () => {
    const page = await placeOrder('tx-new');

    expect(pendingRow(page).exists()).toBe(true);
    expect(page.findAll('button').wrappers.map((b) => b.text())).not.toContain(
      'realfi.start.stakeCta',
    );
  });

  it('re-checks the order list every 15 s until RealFi lists it, then clears the row', async () => {
    const page = await placeOrder('tx-new');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.load).toHaveBeenLastCalledWith({ quiet: true, ordersOnly: true });
    expect(pendingRow(page).exists()).toBe(true);

    orders.value = [order({ txHash: 'tx-new', status: 'Validating' })];
    await page.vm.$nextTick();

    expect(pendingRow(page).exists()).toBe(false);
    const calls = state.load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.load.mock.calls.length).toBe(calls);
  });

  it('keeps waiting past two minutes, when RealFi can still be indexing', async () => {
    // Preprod took longer than two minutes to list an unstake. Giving up then made
    // the page look as if nothing had been sent.
    withPosition([]);
    const page = await placeOrder('tx-slow');

    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await page.vm.$nextTick();

    expect(pendingRow(page).exists()).toBe(true);
    // The wallet's balance has caught up by now, so new orders are offered again.
    expect(page.findAll('button').wrappers.map((b) => b.text())).toContain('realfi.stakeAction');
  });

  it('gives up after 30 minutes: something else is wrong by then', async () => {
    const page = await placeOrder('tx-never-indexed');

    await vi.advanceTimersByTimeAsync(31 * 60_000);
    await page.vm.$nextTick();

    expect(pendingRow(page).exists()).toBe(false);
    const calls = state.load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.load.mock.calls.length).toBe(calls);
  });

  it("on a first stake, shows the order pending in Activity: no 'ready to earn', no empty position", async () => {
    const page = await placeOrder('tx-first');

    expect(pendingRow(page).exists()).toBe(true);
    expect(pendingRow(page).text()).toContain('realfi.actions.stake');
    expect(pendingRow(page).text()).toContain('common.pending');
    expect(page.text()).not.toContain('realfi.start.readyTitle');
    expect(page.text()).not.toContain('realfi.position.label');
  });

  it('offers no claim or cancel either while an order is pending', async () => {
    withPosition([
      order({ status: 'Open' }),
      order({
        action: 'Unstake',
        status: 'Executed',
        unlockSlot: '1500',
        resultTxHash: TX,
        resultOutputIndex: 2,
      }),
    ]);
    const page = await placeOrder('tx-new');

    const labels = page.findAll('button').wrappers.map((b) => b.text());
    expect(labels).not.toContain('realfi.cancel.cta');
    expect(labels).not.toContain('dashboard.claim');
  });

  it('keeps a row per order in flight, each until RealFi lists it', async () => {
    // Includes the earlier review's sequence: A's check is in flight when B is sent.
    let finishA: () => void = () => {};
    const page = await placeOrder('tx-A');
    state.load.mockImplementationOnce(() => new Promise<void>((r) => (finishA = r)));
    await vi.advanceTimersByTimeAsync(15_000); // A's check starts and hangs

    page.findComponent({ name: 'RealFiOrderFlow' }).vm.$emit('placed', 'tx-B', 'claim');
    finishA();
    await vi.advanceTimersByTimeAsync(0);
    expect(page.findAll('.realfi-order--pending')).toHaveLength(2);

    orders.value = [order({ txHash: 'tx-B', status: 'Open' })];
    await page.vm.$nextTick();
    expect(page.findAll('.realfi-order--pending')).toHaveLength(1);
    expect(pendingRow(page).text()).toContain('tx-A');

    orders.value = [order({ txHash: 'tx-B', status: 'Open' }), order({ txHash: 'tx-A' })];
    await page.vm.$nextTick();
    expect(pendingRow(page).exists()).toBe(false);
  });

  it("keeps each wallet's pending orders under its own key across a wallet switch", async () => {
    // Earn stays alive across a wallet switch, so nothing may be keyed on a live read.
    const txA = 'aa'.repeat(32);
    const keyA = 'realfi.pendingOrders:Preprod:addr_test1_wallet_a';
    const keyB = 'realfi.pendingOrders:Preprod:addr_test1_wallet_b';
    wallet['baseAddress'] = 'addr_test1_wallet_a';
    try {
      const page = await placeOrder(txA);
      expect(JSON.parse(localStorage.getItem(keyA) ?? '[]')).toHaveLength(1);

      wallet['baseAddress'] = 'addr_test1_wallet_b';
      await page.vm.$nextTick();
      expect(pendingRow(page).exists()).toBe(false);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(localStorage.getItem(keyB)).toBeNull();
      expect(JSON.parse(localStorage.getItem(keyA) ?? '[]')).toHaveLength(1);

      wallet['baseAddress'] = 'addr_test1_wallet_a';
      await page.vm.$nextTick();
      expect(pendingRow(page).exists()).toBe(true);
    } finally {
      wallet['baseAddress'] = undefined;
      localStorage.clear();
    }
  });

  it('survives a refresh: an order sent earlier is still shown as pending', async () => {
    const txId = 'e78bc07cd1d99e2ef6b8607beedf02956c5271b890f7816f6f66e3fc2adb7f86';
    const address = 'addr_test1qqmzx7n75w7wnj4cgt5wql2qn2k';
    wallet['baseAddress'] = address;
    localStorage.setItem(
      `realfi.pendingOrders:Preprod:${address}`,
      JSON.stringify([{ txId, kind: 'unstake', at: Date.now() - 90_000 }]),
    );
    try {
      const page = await mountPage();

      expect(pendingRow(page).exists()).toBe(true);
      expect(pendingRow(page).text()).toContain('realfi.actions.unstake');
    } finally {
      wallet['baseAddress'] = undefined;
      localStorage.clear();
    }
  });

  it('words a pending claim or cancel like the row it will become', async () => {
    withPosition([]);
    const claimPage = await placeOrder('tx-claim', 'claim');
    expect(pendingRow(claimPage).text()).toContain('realfi.activity.claimed');
    vi.useRealTimers();

    const cancelPage = await placeOrder('tx-cancel', 'cancel');
    expect(pendingRow(cancelPage).text()).toContain('realfi.statuses.canceled');
  });
});

describe('RealFi Earn page, where unstaked money is', () => {
  // What RealFi's preprod vault reported: 1 sUSDrf = 1.033648 USDrf.
  const RATE_INPUTS = {
    vaultUsdr: '59947920817694',
    circulatingSusdr: '57996439368652',
    pendingYield: '0',
    diffusionStart: '0',
    diffusionEnd: '0',
  };
  const COOLING = {
    action: 'Unstake' as const,
    status: 'Executed' as const,
    amount: '5000000000',
    slot: '1000',
    unlockSlot: '9000',
    resultTxHash: TX,
    resultOutputIndex: 0,
  };

  beforeEach(() => {
    currentSlot.value = 5000;
    state.hasUsdr.value = false;
    state.actionableOrders.value = [];
    state.protocol.value = { nextCooldownSlot: '5000' };
  });

  /** Mount with i18n.t spied, so the values each line is built from can be checked. */
  async function mountSpying(list: RealFiOrder[]) {
    const i18n = (await import('@/plugins/i18n')).default as unknown as {
      t: (k: string, v?: unknown) => string;
    };
    const spy = vi.spyOn(i18n, 't');
    withPosition(list);
    const page = await mountPage();
    const calls = spy.mock.calls.map(([k, v]) => [String(k), v]);
    spy.mockRestore();
    return { page, calls };
  }

  it('lists an unstake with the exact USDrf, what went in, and when it opens', async () => {
    const { page, calls } = await mountSpying([order({ ...COOLING, resultAmount: '5168241487' })]);

    const card = page.find('.realfi-unstaking');
    expect(card.text()).toContain('5,168.24 USDrf');
    expect(calls).toContainEqual(['realfi.unstaking.from', { amount: '5,000.00 sUSDrf' }]);
    // 4,000 slots (seconds) to go: 1h 06m.
    expect(calls).toContainEqual(['realfi.duration.hm', { h: 1, m: 6 }]);
    expect(calls).toContainEqual(['realfi.unstaking.total', { amount: '5,168.24 USDrf' }]);
  });

  it('shows how far through the cooldown each unstake is', async () => {
    const { page } = await mountSpying([order(COOLING)]);

    const bar = page.find('.realfi-unstake__track');
    expect(bar.attributes('aria-valuenow')).toBe('50');
    expect(page.find('.realfi-unstake__fill').attributes('style')).toContain('scaleX(0.5)');
  });

  it("estimates the USDrf at today's rate until Nexus reads the exact amount", async () => {
    state.protocol.value = { nextCooldownSlot: '5000', rateInputs: RATE_INPUTS };
    const { page, calls } = await mountSpying([order(COOLING)]);

    expect(page.find('.realfi-unstaking').text()).toContain('\u2248 5,168.24 USDrf');
    expect(calls).toContainEqual(['realfi.unstaking.total', { amount: '\u2248 5,168.24 USDrf' }]);
  });

  it('falls back to the sUSDrf sent in when there is no rate either', async () => {
    const { page, calls } = await mountSpying([order(COOLING)]);

    expect(page.find('.realfi-unstaking').text()).toContain('5,000.00 sUSDrf');
    expect(calls.map(([k]) => k)).not.toContain('realfi.unstaking.total');
  });

  it('turns into "Ready to claim" with a Claim button once the cooldown has passed', async () => {
    currentSlot.value = 9000;
    const { page, calls } = await mountSpying([order({ ...COOLING, resultAmount: '5168241487' })]);

    const card = page.find('.realfi-unstaking');
    expect(calls).toContainEqual(['realfi.claim.title', undefined]);
    expect(card.findAll('button').wrappers.map((b) => b.text())).toContain('dashboard.claim');
    expect(page.find('.realfi-unstake__fill').classes()).toContain('realfi-unstake__fill--ready');
  });

  it('shows what is held and the rate behind the dollar value', async () => {
    state.protocol.value = { nextCooldownSlot: '5000', rateInputs: RATE_INPUTS };
    const { page, calls } = await mountSpying([]);
    state.position.value = { ...(state.position.value as object), totalSUSDr: '4169640000' };
    await page.vm.$nextTick();

    expect(page.find('.realfi-hero__holding').text()).toContain('4,169.64 sUSDrf');
    expect(calls).toContainEqual(['realfi.rate', { rate: '1.0336' }]);
  });

  it('charts the fund yield once there are two days to draw, and not before', async () => {
    state.protocol.value = {
      nextCooldownSlot: '5000',
      apyAvg90Percent: 8.3,
      apyHistory: [{ date: '2026-09-24', apyPercent: 8.2 }],
    };
    let { page } = await mountSpying([]);
    expect(page.find('.realfi-yield').exists()).toBe(false);

    state.protocol.value = {
      nextCooldownSlot: '5000',
      apyAvg90Percent: 8.3,
      apyHistory: [
        { date: '2026-09-24', apyPercent: 8.2 },
        { date: '2026-09-25', apyPercent: 8.4 },
      ],
    };
    ({ page } = await mountSpying([]));
    expect(page.find('.realfi-yield').exists()).toBe(true);
    expect(page.find('.realfi-hero__body').classes()).toContain('realfi-hero__body--split');
  });

  it('sums what is in cooldown and what the user has at RealFi in total', async () => {
    const { page, calls } = await mountSpying([order({ ...COOLING, resultAmount: '5168241487' })]);

    const stats = page.find('.realfi-stats').text();
    expect(stats).toContain('5,168.24 USDrf');
    // The position's 1.00 plus the 5,168.24 still in cooldown.
    expect(stats).toContain('$5,169.24');
    expect(calls).toContainEqual(['realfi.unstaking.next', { wait: 'realfi.duration.hm' }]);
  });

  it('marks the total as an estimate while an amount is estimated, and omits it when unknown', async () => {
    state.protocol.value = { nextCooldownSlot: '5000', rateInputs: RATE_INPUTS };
    let { page } = await mountSpying([order(COOLING)]);
    expect(page.find('.realfi-stats').text()).toContain('≈ $5,169.24');

    state.protocol.value = { nextCooldownSlot: '5000' };
    ({ page } = await mountSpying([order(COOLING)]));
    expect(page.find('.realfi-stats').text()).not.toContain('realfi.stats.total');
  });

  it('puts the amount on each Activity row, in the token the order put in', async () => {
    const { page } = await mountSpying([
      order({ ...COOLING, resultAmount: '5168241487' }),
      order({ action: 'Stake', status: 'Executed', amount: '9994980280' }),
    ]);

    const rows = page.findAll('.realfi-order').wrappers.map((r) => r.text());
    expect(rows[0]).toContain('5,000.00 sUSDrf');
    expect(rows[1]).toContain('9,994.98 USDrf');
  });
});

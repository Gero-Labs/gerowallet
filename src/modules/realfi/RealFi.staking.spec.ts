import { computed, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const wallet = { network: 'Preprod' };
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

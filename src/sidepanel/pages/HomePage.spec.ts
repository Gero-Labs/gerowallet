// The side panel's token sheet and its CIP-113 Send, opened from a TokenList row (issue 1441).
// A wallet token keeps its decimals in `metadata.decimals`; only the pinned ADA row has them at
// the top level. The sheet read the top level alone, so it divided every token by 10^6, and the
// Send sheet got no decimals at all and counted the typed amount in base units.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({ loggedWallet: { chain: 'Cardano', network: 'Preprod' }, account: null, tokens: {}, programmableTokens: {} }),
}));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: { utxos: [] } }));
vi.mock('@/chains/midnight/midnightTokenBalances', () => ({ midnightTokenBalances: () => ({}) }));
vi.mock('@/modules/market/composables/useMarketData', () => ({ useMarketData: () => ({ getTokenByUnit: () => undefined }) }));
vi.mock('../composables/useAdaLovelace', async () => {
  const { ref } = await import('vue');
  return { useAdaLovelace: () => ({ adaLovelace: ref(5_000_000) }) };
});
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Whether Send is offered (network, flag, wallet type) is programmableTokenDisplay's own subject.
vi.mock('@/shared/utils/programmableTokenDisplay', () => ({
  canSendProgrammable: (row: { isProgrammable?: boolean; cip113Registered?: boolean } | null) => !!row?.isProgrammable && !!row?.cip113Registered,
}));

// Every other piece of the page is out of scope: TokenList hands over a row, the sheets show what they get.
vi.mock('@/modules/portfolio/components/AdaPriceHeroCard.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/portfolio/components/FundingCard.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/modules/portfolio/components/PerkTeasers.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/BalanceSection.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/QuickActions.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/FeaturedCarousel.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/MiniDustGauge.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/MiniProofServerWidget.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/MiniSiteActivity.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/TokenList.vue', () => ({ default: { name: 'TokenList', emits: ['select'], template: '<div />' } }));
vi.mock('../components/BottomSheet.vue', () => ({
  default: { props: ['modelValue', 'title', 'height'], template: '<div v-if="modelValue"><slot /></div>' },
}));
vi.mock('../components/flows/SendSheet.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/flows/MidnightSendSheet.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/flows/ReceiveSheet.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/flows/SwapSheet.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/flows/BuySellSheet.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../components/flows/ProgrammableSendSheet.vue', () => ({
  default: { name: 'ProgrammableSendSheet', props: ['modelValue', 'unit', 'ticker', 'name', 'decimals'], template: '<div />' },
}));

import HomePage from './HomePage.vue';

enableAutoUnmount(afterEach);

const POLICY = 'cd'.repeat(28);
const UNIT = POLICY + '4c4f434b';
/** The e2e suite's seed: 4200 base units of a 2-decimal CIP-113 token, i.e. 42 LOCK. */
const lockRow = (metadata: Record<string, unknown> = { ticker: 'LOCK', decimals: 2 }) => ({
  unit: UNIT, quantity: '4200', name: 'LOCK', policy_id: POLICY, isProgrammable: true, cip113Registered: true, metadata,
});

async function openSheet(row: Record<string, unknown>) {
  const wrapper = mount(HomePage, {
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
  wrapper.getComponent({ name: 'TokenList' }).vm.$emit('select', row);
  await wrapper.vm.$nextTick();
  return wrapper;
}

const detailRow = (wrapper: Awaited<ReturnType<typeof openSheet>>, label: string) =>
  wrapper.findAll('.detail-row').find((r) => r.text().startsWith(label))?.text();

async function sendDecimals(row: Record<string, unknown>) {
  const wrapper = await openSheet(row);
  await wrapper.get('[data-testid="home-programmable-send"]').trigger('click');
  return wrapper.getComponent({ name: 'ProgrammableSendSheet' }).props('decimals');
}

describe('side-panel token sheet', () => {
  it('shows a token\'s balance in the decimals its list row uses', async () => {
    // Was "0.0042 LOCK": 4200 divided by 10^6.
    expect(detailRow(await openSheet(lockRow()), 'miniGero.balance')).toBe('miniGero.balance42 LOCK');
    // The issue's own case: 42 base units at 0 decimals read "0.000042".
    expect(detailRow(await openSheet({ ...lockRow({ decimals: 0 }), quantity: '42' }), 'miniGero.balance')).toBe('miniGero.balance42 LOCK');
  });

  it('shows a token whose metadata states no decimals in base units, as its list row does', async () => {
    expect(detailRow(await openSheet(lockRow({ ticker: 'LOCK' })), 'miniGero.balance')).toBe('miniGero.balance4,200 LOCK');
  });

  it('values a token in its own decimals', async () => {
    // Was "$0.00": 0.0042 LOCK at $0.50.
    expect(detailRow(await openSheet({ ...lockRow(), price: 0.5 }), 'miniGero.value')).toBe('miniGero.value$21.00');
  });

  it('still reads the pinned ADA row\'s top-level decimals', async () => {
    const ada = { unit: 'lovelace', policy_id: '', name: 'ADA', ticker: 'ADA', quantity: 5_000_000, decimals: 6, price: 0.4 };
    const wrapper = await openSheet(ada);
    expect(detailRow(wrapper, 'miniGero.balance')).toBe('miniGero.balance5 ADA');
    expect(detailRow(wrapper, 'miniGero.value')).toBe('miniGero.value$2.00');
  });
});

describe('side-panel token sheet: CIP-113 Send', () => {
  it('hands the Send sheet the token\'s decimals', async () => {
    // Was undefined, which the form counted as 0: "Available: 4200 LOCK", and "42" asked for 0.42 LOCK.
    expect(await sendDecimals(lockRow())).toBe(2);
  });

  it('hands over 0, never nothing, for a token whose metadata states no decimals', async () => {
    // The base units its list row shows; gero-backend's decimals check still refuses a wrong 0.
    expect(await sendDecimals(lockRow({ ticker: 'LOCK' }))).toBe(0);
  });
});

import Vue, { nextTick, reactive, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * How `useMidnightDustLive` combines Path A (native NIGHT, `dust/account-state`) with Path B
 * (`useDustPathB`).
 *
 * Path B's destination-wide figures ALREADY include native NIGHT registered to the same dust
 * address (midnight-ledger emits the same `DustInitialUtxo` for native and cNIGHT registrations and
 * the indexer sums them by owner, no source filter), so adding Path A on top double counts it. Path
 * B alone supplies the battery once it is a registered destination-wide answer; in every other case
 * Path A is still added. Kept apart from `useMidnightDustLive.spec.ts`, which mocks Path B without
 * these fields.
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  pathB: {} as Record<string, { value: unknown }>,
}));

vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getDustAccountState: mocks.get }) }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive({ loggedWallet: { network: 'Mainnet' } }) }));
vi.mock('@/stores/midnightStore', () => ({
  midnightStore: reactive({ addresses: { unshielded: 'wallet-pb' }, dustState: null, balances: {} }),
}));
vi.mock('@/shared/composables/useDustPathB', () => {
  const pathB = {
    pathBBalance: ref(0n), pathBCap: ref(0n), pathBRate: ref(0n), pathBNight: ref(0n),
    pathBRegistered: ref(false), pathBIsDestinationWide: ref(false),
    pathBAsOfMs: ref(0), pathBBatchAsOfMs: ref(0),
  };
  mocks.pathB = pathB;
  return { useDustPathB: () => pathB };
});
import { useMidnightDustLive, type MidnightDustLive } from './useMidnightDustLive';

const setB = (over: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(over)) mocks.pathB[key].value = value;
};
// Path A: 40 DUST now, generating 3/s, cap 1000, 500 NIGHT registered, status Registered.
const pathAState = (status = 'Registered') => ({
  dust_balance: '40', dust_generating: '3', dust_cap: '1000', night_registered: '500',
  dust_registration_status: status,
});
// Path B: 100 DUST now, 7/s, cap 2000, 900 NIGHT. Registered, and read at "now" so nothing extrapolates.
const registeredB = (wide: boolean) => ({
  pathBBalance: 100n, pathBCap: 2000n, pathBRate: 7n, pathBNight: 900n,
  pathBRegistered: true, pathBIsDestinationWide: wide, pathBAsOfMs: Date.now(), pathBBatchAsOfMs: Date.now(),
});

let views: Vue[] = [];
function mount(): MidnightDustLive {
  let live!: MidnightDustLive;
  const view = new Vue({ setup() { live = useMidnightDustLive(); return {}; }, render: (h) => h('div') });
  view.$mount();
  views.push(view);
  return live;
}
async function settle() { await Promise.resolve(); await nextTick(); await Promise.resolve(); }

beforeEach(() => {
  vi.useFakeTimers();
  mocks.get.mockReset().mockResolvedValue(pathAState());
  setB({
    pathBBalance: 0n, pathBCap: 0n, pathBRate: 0n, pathBNight: 0n,
    pathBRegistered: false, pathBIsDestinationWide: false, pathBAsOfMs: 0, pathBBatchAsOfMs: 0,
  });
});
afterEach(() => {
  for (const view of views) view.$destroy();
  views = [];
  vi.useRealTimers();
});

describe('Path A + Path B', () => {
  it('drops Path A once Path B is a registered destination-wide answer (it already contains native NIGHT)', async () => {
    setB(registeredB(true));
    const live = mount();
    await settle();

    expect(live.dustBalance.value).toBe(100n); // not 140n
    expect(live.dustGenerating.value).toBe(7n); // not 10n
    expect(live.dustCap.value).toBe(2000n); // not 3000n
    expect(live.nightRegistered.value).toBe(900n); // not 1400n
    expect(live.registrationStatus.value).toBe('Registered');
  });

  it('adds Path A when Path B is not registered', async () => {
    // A definitive-zero destination answer: destination-wide but nothing registered.
    setB({ pathBIsDestinationWide: true, pathBBatchAsOfMs: Date.now(), pathBAsOfMs: Date.now() });
    const live = mount();
    await settle();

    expect(live.dustBalance.value).toBe(40n);
    expect(live.dustGenerating.value).toBe(3n);
    expect(live.dustCap.value).toBe(1000n);
    expect(live.nightRegistered.value).toBe(500n);
  });

  it('adds Path A when Path B came from the per-stake fallback, which is not known to include native NIGHT', async () => {
    setB(registeredB(false));
    const live = mount();
    await settle();

    expect(live.dustBalance.value).toBe(140n);
    expect(live.dustGenerating.value).toBe(10n);
    expect(live.dustCap.value).toBe(3000n);
    expect(live.nightRegistered.value).toBe(1400n);
  });

  it('a wallet with only cNIGHT (Path A empty) shows Path B whether or not Path B supersedes', async () => {
    mocks.get.mockResolvedValue({
      dust_balance: '0', dust_generating: '0', dust_cap: '0', night_registered: '0',
      dust_registration_status: 'Unregistered',
    });
    setB(registeredB(true));
    const live = mount();
    await settle();

    expect(live.dustBalance.value).toBe(100n);
    expect(live.nightRegistered.value).toBe(900n);
    expect(live.registrationStatus.value).toBe('Registered');
  });

  it('stays Registered when only Path A is registered, even though Path B is a destination answer', async () => {
    setB({ pathBIsDestinationWide: true, pathBBatchAsOfMs: Date.now(), pathBAsOfMs: Date.now() });
    const live = mount();
    await settle();

    expect(live.registrationStatus.value).toBe('Registered');
  });

  it('is Unregistered when neither path is', async () => {
    mocks.get.mockResolvedValue(pathAState('Unregistered'));
    const live = mount();
    await settle();

    expect(live.registrationStatus.value).toBe('Unregistered');
  });
});

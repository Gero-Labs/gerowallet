import Vue, { nextTick, reactive, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), log: vi.fn(),
  pathBAsOfMs: { value: 0 } as { value: number },
  pathBBatchAsOfMs: { value: 0 } as { value: number },
  pathBBalance: { value: 0n } as { value: bigint },
}));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getDustAccountState: mocks.get }) }));
vi.mock('@/utils/debug', () => ({ debugLog: mocks.log }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive({ loggedWallet: { network: 'Stagenet' } }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: reactive({
  addresses: { unshielded: 'wallet-a' }, dustState: null, balances: {},
}) }));
vi.mock('@/shared/composables/useDustPathB', () => {
  // A real ref, so the composable's computeds react when a test moves it.
  // Handed back through the hoisted object so tests can drive it.
  const pathBAsOfMs = ref(0);
  const pathBBatchAsOfMs = ref(0);
  const pathBBalance = ref(0n);
  mocks.pathBAsOfMs = pathBAsOfMs;
  mocks.pathBBatchAsOfMs = pathBBatchAsOfMs;
  mocks.pathBBalance = pathBBalance;
  return { useDustPathB: () => ({
    pathBBalance, pathBCap: ref(0n), pathBRate: ref(0n), pathBNight: ref(0n),
    pathBRegistered: ref(false), pathBAsOfMs, pathBBatchAsOfMs,
  }) };
});
import { midnightStore } from '@/stores/midnightStore';
import { useMidnightDustLive, type MidnightDustLive } from './useMidnightDustLive';

const state = (balance = '42') => ({ dust_balance: balance, dust_generating: '0',
  dust_cap: '1000', night_registered: '1', dust_registration_status: 'Registered' });
let views: Vue[] = [];
function mount() {
  let live!: MidnightDustLive;
  const view = new Vue({ setup() { live = useMidnightDustLive(); return {}; }, render: h => h('div') });
  view.$mount();
  views.push(view);
  return live;
}
async function settle() { await Promise.resolve(); await nextTick(); await Promise.resolve(); }

beforeEach(() => {
  vi.useFakeTimers();
  mocks.get.mockReset().mockResolvedValue(state());
  mocks.log.mockClear();
  midnightStore.addresses.unshielded = '';
  midnightStore.addresses.unshielded = 'wallet-a';
});
afterEach(() => {
  for (const view of views) view.$destroy();
  views = [];
  vi.useRealTimers();
});

describe('DUST account-state polling', () => {
  it.each([JSON.stringify({ status: 501 }), { response: { status: 501 } }])(
    'pauses unavailable reads, logs once and retries when the view is reopened: %j', async error => {
      mocks.get.mockRejectedValue(error);
      mount();
      await settle();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mocks.get).toHaveBeenCalledTimes(1);
      expect(mocks.log).toHaveBeenCalledTimes(1);
      views[0].$destroy();
      views = [];
      mocks.get.mockResolvedValue(state());
      const reopened = mount();
      await settle();
      expect(mocks.get).toHaveBeenCalledTimes(2);
      expect(reopened.dustBalance.value).toBe(42n);
    },
  );

  it('retries transient errors on the next poll', async () => {
    mocks.get.mockRejectedValueOnce(JSON.stringify({ status: 503 }));
    const live = mount();
    await settle();
    expect(live.hasData.value).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(live.dustBalance.value).toBe(42n);
  });

  it('allows another wallet to poll after an unavailable response', async () => {
    mocks.get.mockRejectedValueOnce(JSON.stringify({ status: 501 }));
    const live = mount();
    await settle();
    midnightStore.addresses.unshielded = 'wallet-b';
    await settle();
    expect(mocks.get).toHaveBeenLastCalledWith('wallet-b');
    expect(live.dustBalance.value).toBe(42n);
  });

  it.each(['success', 'unavailable'])('ignores a late %s from the previous wallet', async outcome => {
    let resolve!: (value: ReturnType<typeof state>) => void;
    let reject!: (reason: unknown) => void;
    mocks.get.mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const live = mount();
    midnightStore.addresses.unshielded = 'wallet-b';
    await settle();
    if (outcome === 'success') resolve(state('999')); else reject(JSON.stringify({ status: 501 }));
    await settle();
    expect(live.dustBalance.value).toBe(42n);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('shares one in-flight request between consumers and ignores completion after unmount', async () => {
    let resolve!: (value: ReturnType<typeof state>) => void;
    mocks.get.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const live = mount();
    mount();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    for (const view of views) view.$destroy();
    views = [];
    resolve(state('999'));
    await settle();
    expect(live.hasData.value).toBe(false);
    const reopened = mount();
    await settle();
    expect(reopened.dustBalance.value).toBe(42n);
  });

  describe('settled — both paths have definitively reported', () => {
    beforeEach(() => {
      mocks.pathBAsOfMs.value = 0;
      mocks.pathBBatchAsOfMs.value = 0;
      mocks.pathBBalance.value = 0n;
    });

    it('stays false after Path A answers while Path B is still in flight, even though hasData is true', async () => {
      // This is the window the send guard must not block in: a Path-B
      // wallet reads 0 DUST from Path A until its Cardano-side poll lands.
      mocks.get.mockResolvedValue(state('0'));
      const live = mount();
      await settle();
      expect(live.hasData.value).toBe(true);
      expect(live.settled.value).toBe(false);
    });

    it('becomes true once a Path B batch poll has succeeded', async () => {
      mocks.get.mockResolvedValue(state('0'));
      const live = mount();
      await settle();
      expect(live.settled.value).toBe(false);
      mocks.pathBAsOfMs.value = Date.now();
      mocks.pathBBatchAsOfMs.value = mocks.pathBAsOfMs.value;
      await nextTick();
      expect(live.settled.value).toBe(true);
    });

    it('does NOT settle on the "no enumerable stakes" exit, which stamps pathBAsOfMs but is not a definitive zero', async () => {
      // The extension can only enumerate stakes it holds. A wallet fed by a
      // stake registered from the portal or another wallet has no enumerable
      // stakes and real DUST; refusing it would be the original bug.
      mocks.get.mockResolvedValue(state('0'));
      const live = mount();
      await settle();
      mocks.pathBAsOfMs.value = Date.now(); // the no-stakes exit does this…
      await nextTick();
      expect(live.hasData.value).toBe(true); // …display treats it as a reading…
      expect(live.settled.value).toBe(false); // …but nothing may be refused on it.
    });

    it('stays false when Path B has reported but Path A has not', () => {
      mocks.pathBAsOfMs.value = Date.now();
      mocks.pathBBatchAsOfMs.value = mocks.pathBAsOfMs.value;
      mocks.get.mockReturnValue(new Promise(() => {})); // Path A never answers
      const live = mount();
      expect(live.settled.value).toBe(false);
    });

    it('counts Path A as reported via the store dustState alone, before any poll returns', () => {
      // A brand-new wallet gets the zero-filled dustState from gero-sync
      // AccountInfo before the composable's own poll answers.
      midnightStore.dustState = { current: 0n } as never;
      mocks.pathBBatchAsOfMs.value = Date.now();
      mocks.get.mockReturnValue(new Promise(() => {}));
      const live = mount();
      expect(live.settled.value).toBe(true);
      midnightStore.dustState = null;
    });
  });

  describe('dustBalance includes Path B', () => {
    it('sums the Cardano-registered DUST into the balance the guard reads', async () => {
      // The motivating mainnet case: Path A reads 0 (no native NIGHT), all
      // 3,381 DUST comes from a cNIGHT registration.
      mocks.get.mockResolvedValue(state('0'));
      mocks.pathBBalance.value = 3_381_912_800n;
      mocks.pathBAsOfMs.value = Date.now();
      mocks.pathBBatchAsOfMs.value = mocks.pathBAsOfMs.value;
      const live = mount();
      await settle();
      expect(live.dustBalance.value).toBe(3_381_912_800n);
      expect(live.settled.value).toBe(true);
    });
  });
});

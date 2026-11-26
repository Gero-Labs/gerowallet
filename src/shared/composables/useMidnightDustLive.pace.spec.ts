import * as Vue from 'vue';
import { reactive, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Network } from '@/models/types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), log: vi.fn() }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getDustAccountState: mocks.get }) }));
vi.mock('@/utils/debug', () => ({ debugLog: mocks.log }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive({ loggedWallet: { network: 'Preview' } }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: reactive({
  addresses: { unshielded: 'wallet-a' }, dustState: null, balances: {}, lastMidnightTxId: null, sendProgress: null,
}) }));
vi.mock('@/shared/composables/useDustPathB', () => ({ useDustPathB: () => ({
  pathBBalance: ref(0n), pathBCap: ref(0n), pathBRate: ref(0n), pathBNight: ref(0n), pathBRegistered: ref(false),
  pathBIsDestinationWide: ref(false), pathBIncomingStakes: ref<string[]>([]), pathBAsOfMs: ref(0), pathBBatchAsOfMs: ref(0),
}) }));
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { DUST_POLL_FAST_MS, DUST_POLL_SLOW_MS, useMidnightDustLive, type MidnightDustLive } from './useMidnightDustLive';

const store = midnightStore as unknown as { lastMidnightTxId: number | null; sendProgress: object | null; addresses: { unshielded: string } };
const reading = (balance = '42', generating = '0') => ({
  dust_balance: balance, dust_generating: generating, dust_cap: '1000000', night_registered: '1',
  dust_registration_status: 'Registered', dust_generation_status: 'refilling', dust_time_remaining_seconds: 100,
});

let views: Vue.App[] = [];
let mountedAt = 0;
function mount(): MidnightDustLive {
  let live!: MidnightDustLive;
  const view = Vue.createApp({ setup() { live = useMidnightDustLive(); return {}; }, render: () => Vue.h('div') });
  view.mount(document.createElement('div'));
  views.push(view);
  mountedAt = Date.now();
  return live;
}
/** Advance to `seconds` after the mount. */
async function at(seconds: number) {
  await vi.advanceTimersByTimeAsync(mountedAt + seconds * 1000 - Date.now());
}
const polls = () => mocks.get.mock.calls.length;

let visibility: DocumentVisibilityState = 'visible';
function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.get.mockReset().mockImplementation(async () => reading());
  mocks.log.mockClear();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  walletStore.loggedWallet.network = Network.PREVIEW;
  Object.assign(midnightStore, { balances: {}, dustState: null, networkStatus: 'connected', refreshing: null, tip: null,
    lastMidnightTxId: null, sendProgress: null });
  store.addresses.unshielded = '';
  store.addresses.unshielded = 'wallet-a';
});
afterEach(() => {
  for (const view of views) view.unmount();
  views = [];
  delete (document as unknown as { visibilityState?: string }).visibilityState;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DUST account-state poll pace', () => {
  it('starts at 5 s and the pace bounds are 5 s and 60 s', () => {
    expect(DUST_POLL_FAST_MS).toBe(5_000);
    expect(DUST_POLL_SLOW_MS).toBe(60_000);
  });

  it.each([
    // The first reading is news; each later one that says nothing new doubles the gap: 5, 5, 10, 20, 40, then 60 s.
    ['say nothing new', [5, 10, 20, 40, 80, 140, 200, 260]],
    // Every failure doubles it: 5, 10, 20, 40, then 60 s.
    ['fail', [5, 15, 35, 75, 135, 195, 255]],
  ])('slows to every 60 s while the readings %s', async (outcome, schedule) => {
    if (outcome === 'fail') mocks.get.mockImplementation(async () => { throw JSON.stringify({ status: 503 }); });
    mount();
    await at(0);
    expect(polls()).toBe(1);
    for (const [i, second] of schedule.entries()) {
      await at(second - 0.001);
      expect(polls()).toBe(i + 1);
      await at(second);
      expect(polls()).toBe(i + 2);
    }
  });

  it('cuts a day with the view left open from 17,280 requests to about 1,440', async () => {
    mount();
    await at(24 * 60 * 60);
    expect(polls()).toBeLessThanOrEqual(1_445);
    expect(polls()).toBeGreaterThanOrEqual(1_435);
  });

  it('treats a generating wallet whose balance follows the extrapolation as nothing new', async () => {
    // The server's balance rises 10 a second, exactly as the gauge extrapolates it.
    mocks.get.mockImplementation(async () => reading(String(1_000 + Math.floor((Date.now() - mountedAt) / 1000) * 10), '10'));
    const live = mount();
    await at(80);
    expect(polls()).toBe(6);
    await at(139);
    expect(polls()).toBe(6);
    expect(live.dustBalance.value).toBe(1_000n + 139n * 10n);
  });

  it('goes back to the 5 s pace when a reading brings news, such as a spend', async () => {
    const live = mount();
    await at(80);
    expect(polls()).toBe(6);
    mocks.get.mockImplementation(async () => reading('30'));
    await at(140);
    expect(polls()).toBe(7);
    expect(live.dustBalance.value).toBe(30n);
    await at(145);
    expect(polls()).toBe(8);
    await at(150);
    expect(polls()).toBe(9);
    await at(160);
    expect(polls()).toBe(10);
  });

  it('does not poll while the view is hidden, and fetches at once when it is shown again', async () => {
    mount();
    await at(0);
    setVisibility('hidden');
    await at(10 * 60);
    expect(polls()).toBe(1);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(polls()).toBe(2);
    await at(10 * 60 + 5);
    expect(polls()).toBe(3);
  });

  it('keeps polling a visible view that has lost focus', async () => {
    mount();
    window.dispatchEvent(new Event('blur'));
    await at(80);
    expect(polls()).toBe(6);
  });

  it('fetches at once when the user acts, and steady input neither floods nor starves the poll', async () => {
    mount();
    await at(100);
    expect(polls()).toBe(6); // last poll at 80 s, the next due at 140 s
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(0);
    expect(polls()).toBe(7);
    // A key press every second for 30 s: one poll every 5 s, never more.
    for (let second = 101; second <= 130; second++) {
      await at(second);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(polls()).toBe(13);
  });

  it('a click right after a poll waits for the 5 s pace instead of asking again', async () => {
    mount();
    await at(80);
    await at(81);
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(0);
    expect(polls()).toBe(6);
    await at(85);
    expect(polls()).toBe(7);
  });

  it.each([
    ['a send starts', () => { store.sendProgress = { phase: 'proving', percent: 10 }; }],
    ['a new transaction reaches sync', () => { store.lastMidnightTxId = 7; }],
    ['the registration status changes', () => { Object.assign(midnightStore, { dustState: { registrationStatus: 'Registered' } }); }],
  ])('fetches at once when %s', async (_name, act) => {
    mount();
    await at(100);
    expect(polls()).toBe(6);
    act();
    await vi.advanceTimersByTimeAsync(0);
    expect(polls()).toBe(7);
    await at(105);
    expect(polls()).toBe(8);
  });

  describe('views of one wallet share one poller', () => {
    type Listener = ((event: MessageEvent) => void) | null;
    const bus: { channel: FakeChannel; data: unknown }[] = [];
    class FakeChannel {
      static open: FakeChannel[] = [];
      onmessage: Listener = null;
      constructor(readonly name: string) { FakeChannel.open.push(this); }
      postMessage(data: unknown) { bus.push({ channel: this, data }); }
      close() { FakeChannel.open = FakeChannel.open.filter(channel => channel !== this); }
    }
    /** A message from another of the extension's views. */
    function fromOtherView(data: unknown) {
      for (const channel of FakeChannel.open) channel.onmessage?.({ data } as MessageEvent);
    }
    const held = new Set<string>();
    beforeEach(() => {
      bus.length = 0;
      FakeChannel.open = [];
      held.clear();
      vi.stubGlobal('BroadcastChannel', FakeChannel);
      Object.defineProperty(navigator, 'locks', { configurable: true, value: {
        request: async (name: string, options: { ifAvailable?: boolean }, callback: (lock: object | null) => unknown) => {
          if (options.ifAvailable && held.has(name)) return callback(null);
          held.add(name);
          try { return await callback({ name }); } finally { held.delete(name); }
        },
      } });
    });
    afterEach(() => { delete (navigator as unknown as { locks?: unknown }).locks; });

    it('sends its own readings to the other views', async () => {
      mount();
      await at(0);
      expect(bus).toHaveLength(1);
      expect(bus[0].data).toMatchObject({ identity: `${Network.PREVIEW}|wallet-a`, state: reading() });
    });

    it('applies a reading another view fetched and pushes back its own next poll', async () => {
      const live = mount();
      await at(3);
      fromOtherView({ identity: `${Network.PREVIEW}|wallet-a`, startedAt: Date.now(), asOf: Date.now(), state: reading('77') });
      expect(live.dustBalance.value).toBe(77n);
      await at(7.999);
      expect(polls()).toBe(1);
      await at(8);
      expect(polls()).toBe(2);
    });

    it('ignores a reading for another wallet', async () => {
      const live = mount();
      await at(1);
      fromOtherView({ identity: `${Network.PREVIEW}|wallet-b`, startedAt: Date.now(), asOf: Date.now(), state: reading('77') });
      expect(live.dustBalance.value).toBe(42n);
    });

    it('does not fetch while another view is fetching the same reading', async () => {
      held.add(`gero-dust-account-state|${Network.PREVIEW}|wallet-a`);
      const live = mount();
      await at(0);
      expect(polls()).toBe(0);
      fromOtherView({ identity: `${Network.PREVIEW}|wallet-a`, startedAt: Date.now(), asOf: Date.now(), state: reading('55') });
      expect(live.dustBalance.value).toBe(55n);
      held.clear();
      await at(5);
      expect(polls()).toBe(1);
    });
  });
});

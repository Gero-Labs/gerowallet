import * as Vue from 'vue';
import { reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ latest: vi.fn(), log: vi.fn() }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getLatestBlock: mocks.latest }) }));
vi.mock('@/utils/debug', () => ({ debugLog: mocks.log }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: reactive({ tip: { hash: null, height: 0, timestamp: 0 } }) }));

import { midnightStore } from '@/stores/midnightStore';
import {
  resetMidnightDataFreshnessForTests,
  useFetchedMidnightTip,
  useMidnightDataFreshness,
  type MidnightDataFreshness,
} from './useMidnightDataFreshness';

let apps: Vue.App[] = [];
function mountWith<T>(setup: () => T): T {
  let result!: T;
  const app = Vue.createApp({ setup() { result = setup(); return {}; }, render: () => Vue.h('div') });
  app.mount(document.createElement('div'));
  apps.push(app);
  return result;
}
// The API module is imported lazily, so let that import and the read settle.
const settle = async () => {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await Vue.nextTick();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-01-01T12:00:00Z'));
  resetMidnightDataFreshnessForTests();
  mocks.latest.mockReset();
  midnightStore.tip = { hash: null, height: 0, timestamp: 0 };
});
afterEach(() => {
  for (const app of apps) app.unmount();
  apps = [];
  vi.useRealTimers();
});

describe('useMidnightDataFreshness', () => {
  it('reads the wallet\'s tip: fresh is not paused, and the age says so', () => {
    midnightStore.tip = { hash: 'h', height: 1234, timestamp: Date.now() - 6_000 };
    const f: MidnightDataFreshness = mountWith(() => useMidnightDataFreshness());
    expect(f.paused.value).toBe(false);
    expect(f.height.value).toBe(1234);
    expect(f.ageLabel.value).toBe('6s ago');
  });

  it('turns paused, and ages the label, as time passes without a new sync message', async () => {
    midnightStore.tip = { hash: 'h', height: 1234, timestamp: Date.now() - 9 * 60_000 };
    const f = mountWith(() => useMidnightDataFreshness());
    expect(f.paused.value).toBe(false);
    expect(f.ageLabel.value).toBe('9m ago');
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(f.paused.value).toBe(true);
    expect(f.ageLabel.value).toBe('11m ago');
  });

  it('switches back when a fresh tip arrives', async () => {
    midnightStore.tip = { hash: 'h', height: 1234, timestamp: Date.now() - 30 * 60_000 };
    const f = mountWith(() => useMidnightDataFreshness());
    expect(f.paused.value).toBe(true);
    midnightStore.tip = { hash: 'h2', height: 1500, timestamp: Date.now() };
    await Vue.nextTick();
    expect(f.paused.value).toBe(false);
  });
});

describe('useFetchedMidnightTip (Cardano-side views)', () => {
  const block = (ageMs: number) => ({ hash: 'b', height: 77, time: Date.now() - ageMs, slot: 0, epoch: 0, epochSlot: 0 });

  it('reads nothing until a view needs it', async () => {
    mountWith(() => useFetchedMidnightTip(() => 'Mainnet', () => false));
    await settle();
    expect(mocks.latest).not.toHaveBeenCalled();
  });

  it('reads the latest block once a minute across every caller, and reports paused', async () => {
    mocks.latest.mockResolvedValue(block(20 * 60_000));
    const [a, b] = mountWith(() => {
      const tipA = useFetchedMidnightTip(() => 'Mainnet', () => true);
      const tipB = useFetchedMidnightTip(() => 'Mainnet', () => true);
      return [useMidnightDataFreshness(() => tipA.value), useMidnightDataFreshness(() => tipB.value)] as const;
    });
    await settle();
    expect(mocks.latest).toHaveBeenCalledTimes(1);
    expect(a.paused.value).toBe(true);
    expect(b.height.value).toBe(77);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.latest).toHaveBeenCalledTimes(1);
    mocks.latest.mockResolvedValue(block(5_000));
    await vi.advanceTimersByTimeAsync(31_000);
    await settle();
    expect(mocks.latest).toHaveBeenCalledTimes(2);
    expect(a.paused.value).toBe(false);
  });

  it('a failed read is not a stale answer', async () => {
    mocks.latest.mockRejectedValue(new Error('down'));
    const f = mountWith(() => {
      const tip = useFetchedMidnightTip(() => 'Preprod', () => true);
      return useMidnightDataFreshness(() => tip.value);
    });
    await settle();
    expect(f.paused.value).toBe(false);
  });
});

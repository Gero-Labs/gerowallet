import * as Vue from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIDNIGHT_WRITE_GATE_KEY,
  RESPONSE_GATE_TTL_MS,
  STATUS_GATE_TTL_MS,
  clearMidnightStatusPause,
  isMidnightNetworkUpgrading,
  isPausedIn,
  nextGateRecord,
  noteMidnightNetworkUpgrading,
  noteMidnightWritesOpen,
  resetMidnightWriteGateForTests,
  useMidnightNetworkUpgrading,
  type MidnightWriteGateRecord,
} from './midnightWriteGate';

const NOW = Date.parse('2026-01-01T12:00:00Z');

describe('write gate rules', () => {
  it('is per network', () => {
    const record: MidnightWriteGateRecord = { mainnet: { source: 'status', at: NOW } };
    expect(isPausedIn(record, 'Mainnet', NOW)).toBe(true);
    expect(isPausedIn(record, 'Preprod', NOW)).toBe(false);
    expect(isPausedIn(record, '', NOW)).toBe(false);
  });

  it('lets a status-read pause lapse when no read confirms it for 15 minutes', () => {
    const record: MidnightWriteGateRecord = { preprod: { source: 'status', at: NOW } };
    expect(STATUS_GATE_TTL_MS).toBe(15 * 60_000);
    expect(isPausedIn(record, 'Preprod', NOW + STATUS_GATE_TTL_MS - 1)).toBe(true);
    expect(isPausedIn(record, 'Preprod', NOW + STATUS_GATE_TTL_MS)).toBe(false);
  });

  it('remembers a 501 for a while, then lets the next attempt ask the server', () => {
    const record: MidnightWriteGateRecord = { preprod: { source: 'response', at: NOW } };
    expect(isPausedIn(record, 'Preprod', NOW + RESPONSE_GATE_TTL_MS - 1)).toBe(true);
    expect(isPausedIn(record, 'Preprod', NOW + RESPONSE_GATE_TTL_MS)).toBe(false);
  });

  it('a status read outranks a remembered 501, and an open answer clears either', () => {
    let record = nextGateRecord({}, 'Mainnet', { paused: true, source: 'status', at: NOW });
    record = nextGateRecord(record, 'Mainnet', { paused: true, source: 'response', at: NOW + 5 });
    expect(record['mainnet']).toEqual({ source: 'status', at: NOW });
    record = nextGateRecord(record, 'Preprod', { paused: true, source: 'response', at: NOW });
    expect(nextGateRecord(record, 'Mainnet', { paused: false })).toEqual({ preprod: { source: 'response', at: NOW } });
    const unchanged = nextGateRecord(record, 'Stagenet', { paused: false });
    expect(unchanged).toBe(record);
  });

  it('an expired status pause does not outrank a fresh 501', () => {
    const record: MidnightWriteGateRecord = { preprod: { source: 'status', at: NOW } };
    const later = NOW + STATUS_GATE_TTL_MS + 1;
    const next = nextGateRecord(record, 'Preprod', { paused: true, source: 'response', at: later });
    expect(next).toEqual({ preprod: { source: 'response', at: later } });
    expect(isPausedIn(next, 'Preprod', later)).toBe(true);
    // While the status pause is live, it still wins.
    expect(nextGateRecord(record, 'Preprod', { paused: true, source: 'response', at: NOW + 60_000 })).toBe(record);
  });

  it('clearing the status pause leaves a remembered 501 alone', () => {
    const record: MidnightWriteGateRecord = { preprod: { source: 'response', at: NOW }, mainnet: { source: 'status', at: NOW } };
    expect(nextGateRecord(record, 'Preprod', { paused: false, onlySource: 'status' })).toBe(record);
    expect(nextGateRecord(record, 'Mainnet', { paused: false, onlySource: 'status' })).toEqual({ preprod: { source: 'response', at: NOW } });
  });
});

/** chrome.storage.session, shared by every context of the extension. */
function fakeSessionStorage() {
  let store: Record<string, unknown> = {};
  const listeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];
  const session = {
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, store[k]]),
    )),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Record<string, { newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) { store[k] = v; changes[k] = { newValue: v }; }
      for (const l of listeners) l(changes, 'session');
    }),
    remove: vi.fn(async (key: string) => {
      delete store[key];
      for (const l of listeners) l({ [key]: { newValue: undefined } }, 'session');
    }),
  };
  const chromeStub = { storage: { session, onChanged: { addListener: (l: typeof listeners[number]) => listeners.push(l) } } };
  return {
    chromeStub,
    session,
    /** Another context (the worker, the side panel) writes one network's entry. */
    writeFromElsewhere: (network: string, value: unknown) => session.set({ [`${MIDNIGHT_WRITE_GATE_KEY}:${network}`]: value }),
    removeFromElsewhere: (network: string) => session.remove(`${MIDNIGHT_WRITE_GATE_KEY}:${network}`),
    keys: () => Object.keys(store),
    reset: () => { store = {}; },
  };
}

describe('write gate state across extension contexts', () => {
  const fake = fakeSessionStorage();
  let apps: Vue.App[] = [];
  const mountGate = (network: () => string) => {
    let paused!: Vue.ComputedRef<boolean>;
    const app = Vue.createApp({ setup() { paused = useMidnightNetworkUpgrading(network); return {}; }, render: () => Vue.h('div') });
    app.mount(document.createElement('div'));
    apps.push(app);
    return paused;
  };
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await Vue.nextTick(); };

  beforeEach(() => {
    fake.reset();
    vi.stubGlobal('chrome', fake.chromeStub);
    resetMidnightWriteGateForTests();
  });
  afterEach(() => {
    for (const app of apps) app.unmount();
    apps = [];
    vi.unstubAllGlobals();
  });

  it('a 501 seen in one context pauses the network everywhere, and only that network', async () => {
    const mainnet = mountGate(() => 'Mainnet');
    const preprod = mountGate(() => 'Preprod');
    await settle();
    expect(mainnet.value).toBe(false);
    await noteMidnightNetworkUpgrading('Preprod', 'response');
    await settle();
    expect(preprod.value).toBe(true);
    expect(mainnet.value).toBe(false);
    await expect(isMidnightNetworkUpgrading('Preprod')).resolves.toBe(true);
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(false);
  });

  it('re-enables without a reload when another context reports writes open', async () => {
    const preprod = mountGate(() => 'Preprod');
    await fake.writeFromElsewhere('preprod', { source: 'status', at: Date.now() });
    await settle();
    expect(preprod.value).toBe(true);
    await fake.removeFromElsewhere('preprod');
    await settle();
    expect(preprod.value).toBe(false);
  });

  it('stores each network under its own key', async () => {
    await noteMidnightNetworkUpgrading('Preprod', 'response');
    await noteMidnightNetworkUpgrading('Mainnet', 'status');
    expect(fake.keys().sort()).toEqual([`${MIDNIGHT_WRITE_GATE_KEY}:mainnet`, `${MIDNIGHT_WRITE_GATE_KEY}:preprod`]);
    await noteMidnightWritesOpen('Preprod');
    expect(fake.keys()).toEqual([`${MIDNIGHT_WRITE_GATE_KEY}:mainnet`]);
  });

  it('picks up entries stored before the view opened, reading only its own keys', async () => {
    await fake.writeFromElsewhere('preprod', { source: 'status', at: Date.now() });
    await fake.session.set({ unrelatedSecret: 'never read into this page' });
    fake.session.get.mockClear();
    const preprod = mountGate(() => 'Preprod');
    await settle();
    expect(preprod.value).toBe(true);
    const reads = fake.session.get.mock.calls.map(([keys]) => keys);
    expect(reads.length).toBeGreaterThan(0);
    for (const keys of reads) {
      expect(keys).not.toBeNull();
      for (const key of [keys].flat()) expect(key).toMatch(new RegExp(`^${MIDNIGHT_WRITE_GATE_KEY}:`));
    }
    expect([reads].flat(2)).toContain(`${MIDNIGHT_WRITE_GATE_KEY}:preprod`);
  });

  it('re-enables on its own when a status pause lapses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const preprod = mountGate(() => 'Preprod');
      await noteMidnightNetworkUpgrading('Preprod', 'status');
      await settle();
      expect(preprod.value).toBe(true);
      await vi.advanceTimersByTimeAsync(STATUS_GATE_TTL_MS + 100);
      await settle();
      expect(preprod.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clearMidnightStatusPause clears a status pause, not a 501', async () => {
    await noteMidnightNetworkUpgrading('Mainnet', 'status');
    await noteMidnightNetworkUpgrading('Preprod', 'response');
    await clearMidnightStatusPause('Mainnet');
    await clearMidnightStatusPause('Preprod');
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(false);
    await expect(isMidnightNetworkUpgrading('Preprod')).resolves.toBe(true);
  });

  it('a successful write clears the pause', async () => {
    await noteMidnightNetworkUpgrading('Mainnet', 'response');
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(true);
    await noteMidnightWritesOpen('Mainnet');
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(false);
  });

  it('ignores a malformed stored record', async () => {
    await fake.writeFromElsewhere('mainnet', { source: 'nonsense', at: 'x' });
    await fake.writeFromElsewhere('preprod', null);
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(false);
    await expect(isMidnightNetworkUpgrading('Preprod')).resolves.toBe(false);
  });
});

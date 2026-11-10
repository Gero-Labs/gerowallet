import * as Vue from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIDNIGHT_WRITE_GATE_KEY,
  RESPONSE_GATE_TTL_MS,
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

  it('holds a status-read pause until the status says otherwise', () => {
    const record: MidnightWriteGateRecord = { preprod: { source: 'status', at: NOW } };
    expect(isPausedIn(record, 'Preprod', NOW + 10 * RESPONSE_GATE_TTL_MS)).toBe(true);
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
});

/** chrome.storage.session, shared by every context of the extension. */
function fakeSessionStorage() {
  let store: Record<string, unknown> = {};
  const listeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];
  const session = {
    get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Record<string, { newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) { store[k] = v; changes[k] = { newValue: v }; }
      for (const l of listeners) l(changes, 'session');
    }),
  };
  const chromeStub = { storage: { session, onChanged: { addListener: (l: typeof listeners[number]) => listeners.push(l) } } };
  return {
    chromeStub,
    session,
    /** Another context (the worker, the side panel) writes the record. */
    writeFromElsewhere: (value: unknown) => session.set({ [MIDNIGHT_WRITE_GATE_KEY]: value }),
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
    await fake.writeFromElsewhere({ preprod: { source: 'status', at: Date.now() } });
    await settle();
    expect(preprod.value).toBe(true);
    await fake.writeFromElsewhere({});
    await settle();
    expect(preprod.value).toBe(false);
  });

  it('a successful write clears the pause', async () => {
    await noteMidnightNetworkUpgrading('Mainnet', 'response');
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(true);
    await noteMidnightWritesOpen('Mainnet');
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(false);
  });

  it('ignores a malformed stored record', async () => {
    await fake.writeFromElsewhere({ mainnet: { source: 'nonsense', at: 'x' }, preprod: null });
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(false);
    await expect(isMidnightNetworkUpgrading('Preprod')).resolves.toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drives syncDustWalletAndBalanceFees' stall/restart loop against a fake
// DustWallet. The fake mirrors the one SDK behaviour these tests hinge on
// (dust-wallet 4.2.0, RunningV1Variant.startSync): state is only published
// after a SUCCESSFUL applyUpdate, so a restored blob whose events all fail
// to apply emits its initial state and then nothing at all.

type Progress = { appliedIndex: bigint; highestRelevantWalletIndex: bigint; isConnected: boolean };
type Script = {
  /** States emitted synchronously on subscribe. */
  initial: Progress[];
  /** States emitted one per second afterwards. */
  later?: Progress[];
  /** Resolve waitForSyncedState once `later` is exhausted. */
  syncs?: boolean;
  /** What serializeState returns. */
  blob: string;
};

const store = new Map<string, string>();
const saved: string[] = [];
const scripts: Script[] = [];
const restoreCalls: string[] = [];
let coldStarts = 0;

vi.mock('./midnightLedger', () => ({
  midnightLedgerVersion: () => 8,
  requireMidnightLedger8: () => undefined,
}));

vi.mock('@midnight-ntwrk/ledger-v8', () => ({
  LedgerParameters: { initialParameters: () => ({ dust: {} }) },
  DustSecretKey: { fromSeed: () => ({ clear: () => undefined }) },
}));

vi.mock('@/chains/midnight/midnightWalletStatePersistence', () => ({
  loadWalletState: vi.fn(async () => store.get('dust') ?? null),
  saveWalletState: vi.fn(async (_n: string, _k: string, _s: Uint8Array, blob: string) => {
    store.set('dust', blob);
    saved.push(blob);
  }),
  clearWalletState: vi.fn(async () => { store.delete('dust'); }),
}));

vi.mock('@/services/nexusDevice.service', () => ({
  getNexusAccessToken: vi.fn(async () => 'token'),
  reauthenticateNexus: vi.fn(async () => 'token'),
}));

function fakeWallet(script: Script) {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let syncedResolve: (() => void) | undefined;
  const synced = new Promise<void>((resolve) => { syncedResolve = resolve; });
  return {
    state: {
      subscribe(cb: (s: unknown) => void) {
        for (const p of script.initial) cb({ progress: p });
        const later = script.later ?? [];
        later.forEach((p, i) => {
          timers.push(setTimeout(() => {
            cb({ progress: p });
            if (i === later.length - 1 && script.syncs) syncedResolve?.();
          }, (i + 1) * 1_000));
        });
        if (later.length === 0 && script.syncs) syncedResolve?.();
        return { unsubscribe: () => { timers.forEach(clearTimeout); timers = []; } };
      },
    },
    start: async () => undefined,
    stop: async () => { timers.forEach(clearTimeout); timers = []; },
    waitForSyncedState: () => synced,
    serializeState: async () => script.blob,
    balanceTransactions: async () => 'FEE_TX',
  };
}

function nextScript(): Script {
  const s = scripts.shift();
  if (!s) throw new Error('test ran out of wallet scripts');
  return s;
}

vi.mock('@midnightntwrk/wallet-sdk-dust-wallet', () => ({
  DustWallet: () => ({
    restore: (blob: string) => { restoreCalls.push(blob); return fakeWallet(nextScript()); },
    startWithSecretKey: () => { coldStarts += 1; return fakeWallet(nextScript()); },
  }),
}));

const p = (applied: number, connected = true): Progress => ({
  appliedIndex: BigInt(applied),
  highestRelevantWalletIndex: 200_000n,
  isConnected: connected,
});

const baseArgs = {
  sdkNetworkId: 'mainnet',
  endpoints: {
    nexusBaseUrl: 'https://nexus.test',
    publicIndexerUrl: 'https://indexer.test',
    publicIndexerWsUrl: 'wss://indexer.test',
  },
  dustSecretSeed: new Uint8Array(32),
  ttl: new Date('2026-10-01T00:00:00Z'),
} as unknown as Parameters<typeof import('./midnightTxBuilder').syncDustWalletAndBalanceFees>[0];

async function run(args = baseArgs) {
  const { syncDustWalletAndBalanceFees } = await import('./midnightTxBuilder');
  const promise = syncDustWalletAndBalanceFees(args, []);
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 200 && !settled; i += 1) await vi.advanceTimersByTimeAsync(5_000);
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers();
  store.clear();
  saved.length = 0;
  scripts.length = 0;
  restoreCalls.length = 0;
  coldStarts = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('syncDustWalletAndBalanceFees: unusable restored state', () => {
  it('falls back to a cold replay when a Nexus snapshot emits nothing after restore', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ serialized_state: 'SNAPSHOT' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    scripts.push(
      // Snapshot restore: one initial state, disconnected, then silence (every apply fails).
      { initial: [p(176_660, false)], blob: 'POISONED' },
      // Cold replay from genesis applies and syncs.
      { initial: [p(0)], later: [p(1_000), p(2_000)], syncs: true, blob: 'COLD_SYNCED' },
    );

    await expect(run({ ...baseArgs, dustRegisteredAt: new Date('2026-09-01T00:00:00Z') })).resolves.toBe('FEE_TX');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(restoreCalls).toEqual(['SNAPSHOT']);
    expect(coldStarts).toBe(1);
    expect(saved).not.toContain('POISONED');
    expect(store.get('dust')).toBe('COLD_SYNCED');
  });

  it('never re-saves a poisoned local checkpoint and keeps it only until the cold replay overwrites it', async () => {
    vi.stubGlobal('fetch', vi.fn());
    store.set('dust', 'OLD_CHECKPOINT');
    scripts.push(
      { initial: [p(176_660, false)], blob: 'OLD_CHECKPOINT_RESAVED' },
      { initial: [p(0)], later: [p(500)], syncs: true, blob: 'COLD_SYNCED' },
    );

    await expect(run()).resolves.toBe('FEE_TX');

    expect(saved).not.toContain('OLD_CHECKPOINT_RESAVED');
    expect(store.get('dust')).toBe('COLD_SYNCED');
  });

  it('resumes the cold replay from its own checkpoint after a mid-replay stall', async () => {
    vi.stubGlobal('fetch', vi.fn());
    store.set('dust', 'OLD_CHECKPOINT');
    scripts.push(
      // Poisoned restore: connected, updates arrive, cursor frozen.
      { initial: [p(176_660)], later: Array.from({ length: 12 }, () => p(176_660)), blob: 'OLD_CHECKPOINT_RESAVED' },
      // Cold replay makes progress, then the subscription dies (backpressure stall).
      { initial: [p(0)], later: [p(10_000), p(20_000)], blob: 'COLD_20000' },
      // Resumed from COLD_20000, finishes.
      { initial: [p(20_000)], later: [p(30_000)], syncs: true, blob: 'COLD_SYNCED' },
    );

    await expect(run()).resolves.toBe('FEE_TX');

    expect(coldStarts).toBe(1);
    expect(restoreCalls).toEqual(['OLD_CHECKPOINT', 'COLD_20000']);
    expect(saved).not.toContain('OLD_CHECKPOINT_RESAVED');
    expect(store.get('dust')).toBe('COLD_SYNCED');
  });

  it('keeps a healthy checkpoint when nothing applies at all (indexer unreachable)', async () => {
    vi.stubGlobal('fetch', vi.fn());
    store.set('dust', 'HEALTHY');
    scripts.push(
      { initial: [p(150_000, false)], blob: 'HEALTHY' },
      { initial: [], blob: 'EMPTY' },
      { initial: [], blob: 'EMPTY' },
    );

    await expect(run()).rejects.toThrow(/not receiving events/);

    expect(saved).toEqual([]);
    expect(store.get('dust')).toBe('HEALTHY');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, nextTick } from 'vue';

// A first-time wallet's P&L answers 202 PENDING until its full history is fetched. The
// composable must show that state (no numbers), ask again after the server's hint while
// anything still shows P&L, and stop on unmount, on a wallet switch, or after 30 minutes.

const STAKE = 'stake1u83ax56dkxw2zsc7320hqmpszys6z66scvsmmv9837yqxzsqdqs0s';
const OTHER = 'stake1uy0hdsvl4pl0w8nfsy3ewzrxfr3sd04y6xj4sf8u7ncd3wsfyavm2';

// The composable keeps module-level state and a module-level wallet watcher, so every test
// gets fresh module instances AND fresh mocks (vi.mock factories are cached across
// vi.resetModules; a shared walletStore would wake earlier tests' watchers).
function freshMocks() {
  vi.doMock('@/api/market-api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/api/market-api')>();
    return { ...actual, default: { getWalletPnl: vi.fn() } };
  });
  vi.doMock('@/stores/walletStore', async () => {
    const { reactive } = await import('vue');
    return { walletStore: reactive({ loggedWallet: { stakeAddress: STAKE } as { stakeAddress: string } | null }) };
  });
}

const pending = (retryAfterSeconds = 30) => ({ state: 'pending' as const, retryAfterSeconds });
const ready = (stakeAddress: string) => ({
  state: 'ready' as const,
  data: { stakeAddress, totalPnlAda: 3, totalRealizedPnlAda: 1, totalUnrealizedPnlAda: 2, tokens: [] },
});

async function load() {
  freshMocks();
  const api = (await import('@/api/market-api')).default as unknown as { getWalletPnl: ReturnType<typeof vi.fn> };
  const { walletStore } = await import('@/stores/walletStore');
  const { useWalletPnl } = await import('./useWalletPnl');
  const scope = effectScope();
  const pnl = scope.run(() => useWalletPnl())!;
  return { getWalletPnl: api.getWalletPnl, walletStore, pnl, scope };
}

describe('useWalletPnl: 202 PENDING', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows pending with no numbers, then the P&L once the history is ready', async () => {
    const { getWalletPnl, pnl } = await load();
    getWalletPnl.mockResolvedValueOnce(pending(30)).mockResolvedValueOnce(ready(STAKE));

    await pnl.fetchPnl();
    expect(pnl.pnlPending.value).toBe(true);
    expect(pnl.pnlSummary.value).toBeNull();
    expect(pnl.pnlLoading.value).toBe(false);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(getWalletPnl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(getWalletPnl).toHaveBeenCalledTimes(2);
    expect(pnl.pnlPending.value).toBe(false);
    expect(pnl.pnlSummary.value?.stakeAddress).toBe(STAKE);
  });

  it('stops asking once nothing shows P&L any more', async () => {
    const { getWalletPnl, pnl, scope } = await load();
    getWalletPnl.mockResolvedValue(pending(30));

    await pnl.fetchPnl();
    scope.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(getWalletPnl).toHaveBeenCalledTimes(1);
  });

  it('gives up polling after 30 minutes and stays pending', async () => {
    const { getWalletPnl, pnl } = await load();
    getWalletPnl.mockResolvedValue(pending(300));

    await pnl.fetchPnl();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    const calls = getWalletPnl.mock.calls.length;

    expect(calls).toBeLessThanOrEqual(1 + 30 / 5);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(getWalletPnl).toHaveBeenCalledTimes(calls);
    expect(pnl.pnlPending.value).toBe(true);
  });

  it('a wallet switch cancels the old wallet\'s retry', async () => {
    const { getWalletPnl, pnl, walletStore } = await load();
    getWalletPnl.mockResolvedValueOnce(pending(30)).mockResolvedValue(ready(OTHER));

    await pnl.fetchPnl();
    walletStore.loggedWallet = { stakeAddress: OTHER };
    await nextTick();
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(getWalletPnl.mock.calls.map(c => c[0])).toEqual([STAKE, OTHER]);
    expect(pnl.pnlPending.value).toBe(false);
    expect(pnl.pnlSummary.value?.stakeAddress).toBe(OTHER);
  });

  it('an answer for a wallet that is no longer selected is dropped', async () => {
    const { getWalletPnl, pnl, walletStore } = await load();
    let resolveOld!: (v: unknown) => void;
    getWalletPnl.mockImplementationOnce(() => new Promise(r => { resolveOld = r; }));
    getWalletPnl.mockResolvedValue(pending(30));

    const first = pnl.fetchPnl();
    walletStore.loggedWallet = { stakeAddress: OTHER };
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    resolveOld(ready(STAKE));
    await first;

    expect(pnl.pnlSummary.value).toBeNull();
    expect(pnl.pnlPending.value).toBe(true);
  });
});

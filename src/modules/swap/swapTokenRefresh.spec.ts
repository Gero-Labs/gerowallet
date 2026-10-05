import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ loadTokens: vi.fn() }));
vi.mock('@/stores/tokenMetadataStore', () => ({ default: store }));

import { refreshSwapTokensIfStale, resetSwapTokenRefresh, SWAP_TOKEN_LIST_MAX_AGE_MS } from './swapTokenRefresh';

describe('refreshSwapTokensIfStale', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T14:30:00Z'));
    store.loadTokens.mockReset().mockResolvedValue(true);
    resetSwapTokenRefresh();
  });
  afterEach(() => vi.useRealTimers());

  it('fetches the list the first time the swap opens on a page', async () => {
    await refreshSwapTokensIfStale();
    expect(store.loadTokens).toHaveBeenCalledTimes(1);
  });

  it('reuses a fresh list, and fetches again once it is older than the limit', async () => {
    await refreshSwapTokensIfStale();
    vi.setSystemTime(Date.now() + SWAP_TOKEN_LIST_MAX_AGE_MS - 1);
    await refreshSwapTokensIfStale();
    expect(store.loadTokens).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2);
    await refreshSwapTokensIfStale();
    expect(store.loadTokens).toHaveBeenCalledTimes(2);
  });

  it('shares one request between swaps opened at the same time', async () => {
    let finish!: (loaded: boolean) => void;
    store.loadTokens.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = refreshSwapTokensIfStale();
    const second = refreshSwapTokensIfStale();
    finish(true);
    await Promise.all([first, second]);
    expect(store.loadTokens).toHaveBeenCalledTimes(1);
  });

  it('retries on the next open after a failed load, without ever throwing', async () => {
    store.loadTokens.mockResolvedValueOnce(false);
    await refreshSwapTokensIfStale();
    store.loadTokens.mockRejectedValueOnce(new Error('network'));
    await expect(refreshSwapTokensIfStale()).resolves.toBeUndefined();
    await refreshSwapTokensIfStale();
    expect(store.loadTokens).toHaveBeenCalledTimes(3);
  });
});

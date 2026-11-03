// The top-200 collections, read once and shared. The collectibles table enriches the wallet's
// collections from it and the market page's lookalike warning compares names against it, so both
// read this one list instead of each asking the market API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getNftCollections = vi.hoisted(() => vi.fn());
vi.mock('@/api/market-api', () => ({ default: { getNftCollections } }));

import { loadTopNftCollections, resetTopNftCollections, TOP_NFT_COLLECTIONS_LIMIT } from './useTopNftCollections';

const LIST = [{ policyId: 'aa'.repeat(28), name: 'SpaceBudz' }];

beforeEach(() => {
  resetTopNftCollections();
  getNftCollections.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('loadTopNftCollections', () => {
  it('asks for the 200 biggest by volume', async () => {
    getNftCollections.mockResolvedValue(LIST);
    await loadTopNftCollections();
    expect(TOP_NFT_COLLECTIONS_LIMIT).toBe(200);
    expect(getNftCollections).toHaveBeenCalledExactlyOnceWith('volume', 200);
  });

  it('shares one request between callers that ask at the same time', async () => {
    getNftCollections.mockResolvedValue(LIST);
    const [a, b] = await Promise.all([loadTopNftCollections(), loadTopNftCollections()]);
    expect(a).toEqual(LIST);
    expect(b).toEqual(LIST);
    expect(getNftCollections).toHaveBeenCalledTimes(1);
  });

  it('keeps an answer for ten minutes, then asks again', async () => {
    getNftCollections.mockResolvedValue(LIST);
    await loadTopNftCollections();
    vi.advanceTimersByTime(9 * 60_000);
    await loadTopNftCollections();
    expect(getNftCollections).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 60_000);
    await loadTopNftCollections();
    expect(getNftCollections).toHaveBeenCalledTimes(2);
  });

  it('answers null on a failure and does not keep it: the next caller asks again', async () => {
    getNftCollections.mockRejectedValueOnce(new Error('503'));
    expect(await loadTopNftCollections()).toBeNull();
    getNftCollections.mockResolvedValueOnce(LIST);
    expect(await loadTopNftCollections()).toEqual(LIST);
    expect(getNftCollections).toHaveBeenCalledTimes(2);
  });

  it('answers null for a body that is not a list', async () => {
    getNftCollections.mockResolvedValue({ error: 'x' });
    expect(await loadTopNftCollections()).toBeNull();
  });
});

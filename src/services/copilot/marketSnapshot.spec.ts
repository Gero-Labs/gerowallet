import { describe, it, expect, vi } from 'vitest';
import * as market from '@/api/market-api';
import { fetchSnapshots, type TokenRef } from './marketSnapshot';

describe('fetchSnapshots', () => {
  it('fetches a price snapshot per token and marks held vs watched', async () => {
    vi.spyOn(market.default, 'getTokenPrice').mockImplementation(async (assetId: string) => ({
      assetId, priceChange24h: assetId === 'a' ? 22 : 3, priceChange7d: -5,
    }) as never);

    const refs: TokenRef[] = [
      { unit: 'a', ticker: 'SNEK', held: true },
      { unit: 'b', ticker: 'GERO', held: false },
    ];
    const snaps = await fetchSnapshots(refs);

    expect(snaps).toEqual([
      { unit: 'a', ticker: 'SNEK', held: true, priceChange24h: 22, priceChange7d: -5 },
      { unit: 'b', ticker: 'GERO', held: false, priceChange24h: 3, priceChange7d: -5 },
    ]);
  });

  it('skips tokens whose price lookup fails (no throw)', async () => {
    vi.spyOn(market.default, 'getTokenPrice').mockRejectedValue(new Error('404') as never);
    const snaps = await fetchSnapshots([{ unit: 'x', ticker: 'X', held: true }]);
    expect(snaps).toEqual([]);
  });
});

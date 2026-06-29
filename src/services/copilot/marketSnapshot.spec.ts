import { describe, it, expect, vi } from 'vitest';
import * as market from '@/api/market-api';
import { fetchSnapshots, type TokenRef } from './marketSnapshot';

describe('fetchSnapshots', () => {
  it('matches refs against the bulk price list and marks held vs watched', async () => {
    vi.spyOn(market.default, 'getAllPrices').mockResolvedValue([
      { assetId: 'a', priceChange24h: 22, priceChange7d: -5 },
      { assetId: 'b', priceChange24h: 3, priceChange7d: -5 },
      { assetId: 'c', priceChange24h: 99, priceChange7d: 99 }, // not requested -> ignored
    ] as never);

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

  it('skips refs not present in the price list', async () => {
    vi.spyOn(market.default, 'getAllPrices').mockResolvedValue([
      { assetId: 'a', priceChange24h: 5, priceChange7d: 5 },
    ] as never);
    const snaps = await fetchSnapshots([{ unit: 'x', ticker: 'X', held: true }]);
    expect(snaps).toEqual([]);
  });

  it('returns [] when the bulk fetch fails (no throw)', async () => {
    vi.spyOn(market.default, 'getAllPrices').mockRejectedValue(new Error('500') as never);
    const snaps = await fetchSnapshots([{ unit: 'x', ticker: 'X', held: true }]);
    expect(snaps).toEqual([]);
  });

  it('returns [] for no refs without calling the API', async () => {
    const spy = vi.spyOn(market.default, 'getAllPrices');
    expect(await fetchSnapshots([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

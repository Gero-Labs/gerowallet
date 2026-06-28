// src/services/copilot/feedEngine.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { buildFeedItems } from './feedEngine';
import type { TokenRef } from './marketSnapshot';

describe('buildFeedItems', () => {
  it('fetches, detects, and narrates into FeedItems with a stable id/key', async () => {
    const fetchSnapshots = vi.fn().mockResolvedValue([
      { unit: 'u1', ticker: 'SNEK', held: true, priceChange24h: 22, priceChange7d: -5 },
      { unit: 'u2', ticker: 'GERO', held: false, priceChange24h: 4, priceChange7d: 3 },
    ]);
    const refs: TokenRef[] = [
      { unit: 'u1', ticker: 'SNEK', held: true },
      { unit: 'u2', ticker: 'GERO', held: false },
    ];

    const items = await buildFeedItems(refs, { pct24h: 15 }, 'day-1', 1000, fetchSnapshots);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'priceUp:24h:u1:day-1',
      id: 'priceUp:24h:u1:day-1',
      ts: 1000,
      textKey: 'copilot.feed.heldPriceUp',
      params: { ticker: 'SNEK', pct: 22, window: '24h' },
    });
  });

  it('returns no items when there are no refs', async () => {
    const fetchSnapshots = vi.fn();
    expect(await buildFeedItems([], { pct24h: 15 }, 'day-1', 1000, fetchSnapshots)).toEqual([]);
    expect(fetchSnapshots).not.toHaveBeenCalled();
  });

  it('threads the vibe through to the narration key', async () => {
    const fetchSnapshots = vi.fn().mockResolvedValue([
      { unit: 'u1', ticker: 'SNEK', held: true, priceChange24h: 22, priceChange7d: -5 },
    ]);
    const refs: TokenRef[] = [{ unit: 'u1', ticker: 'SNEK', held: true }];

    const items = await buildFeedItems(refs, { pct24h: 15 }, 'day-1', 1000, fetchSnapshots, 'spicy');

    expect(items[0].textKey).toBe('copilot.feed.spicy.heldPriceUp');
  });
});

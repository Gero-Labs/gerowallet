// src/services/copilot/feedReducer.spec.ts
import { describe, it, expect } from 'vitest';
import { addFeedItems, type FeedItem } from './feedReducer';

function item(key: string, ts: number): FeedItem {
  return { id: key, key, ts, textKey: 'copilot.feed.priceUp', params: {} };
}

describe('addFeedItems', () => {
  it('appends new items and keeps newest-first order', () => {
    const out = addFeedItems({ items: [], seen: [] }, [item('a', 1), item('b', 2)], 50);
    expect(out.items.map((i) => i.key)).toEqual(['b', 'a']);
    expect(out.seen).toEqual(['a', 'b']);
  });

  it('drops items whose key was already seen', () => {
    const start = addFeedItems({ items: [], seen: [] }, [item('a', 1)], 50);
    const out = addFeedItems(start, [item('a', 9), item('c', 3)], 50);
    expect(out.items.map((i) => i.key)).toEqual(['c', 'a']);
    expect(out.seen).toEqual(['a', 'c']);
  });

  it('caps items and the seen-set to max (newest kept)', () => {
    const out = addFeedItems({ items: [], seen: [] }, [item('a', 1), item('b', 2), item('c', 3)], 2);
    expect(out.items.map((i) => i.key)).toEqual(['c', 'b']);
    expect(out.seen).toEqual(['b', 'c']);
  });
});

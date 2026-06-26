// src/sidepanel/composables/useCopilotFeed.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createCopilotFeed } from './useCopilotFeed';
import type { FeedItem, FeedState } from '@/services/copilot/feedReducer';

function fakeStore() {
  const state: FeedState = { items: [], seen: [] };
  return {
    state,
    get items() { return state.items; },
    merge(incoming: FeedItem[]) {
      const seen = new Set(state.seen);
      const fresh = incoming.filter((i) => !seen.has(i.key));
      state.items = [...fresh].concat(state.items);
      state.seen = [...state.seen, ...fresh.map((i) => i.key)];
    },
  };
}

describe('useCopilotFeed', () => {
  it('refresh() builds items and merges them into the store', async () => {
    const store = fakeStore();
    const build = vi.fn().mockResolvedValue([
      { id: 'k1', key: 'k1', ts: 1, textKey: 'copilot.feed.heldPriceUp', params: {} },
    ]);
    const feed = createCopilotFeed({
      store,
      build,
      getRefs: () => [{ unit: 'u1', ticker: 'SNEK', held: true }],
    });

    await feed.refresh();

    expect(build).toHaveBeenCalledTimes(1);
    expect(store.items.map((i) => i.key)).toEqual(['k1']);
    expect(feed.busy.value).toBe(false);
  });

  it('refresh() is a no-op while already busy', async () => {
    const store = fakeStore();
    let resolve!: (v: FeedItem[]) => void;
    const build = vi.fn().mockReturnValue(new Promise<FeedItem[]>((r) => { resolve = r; }));
    const feed = createCopilotFeed({ store, build, getRefs: () => [{ unit: 'u', ticker: 'T', held: true }] });

    const first = feed.refresh();
    await feed.refresh(); // should be ignored while busy
    resolve([]);
    await first;

    expect(build).toHaveBeenCalledTimes(1);
  });
});

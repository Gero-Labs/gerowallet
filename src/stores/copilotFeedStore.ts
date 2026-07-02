// src/stores/copilotFeedStore.ts
import Vue from 'vue';
import { addFeedItems, type FeedItem, type FeedState } from '@/services/copilot/feedReducer';

const STORE_KEY = 'copilotFeedStore';
const MAX_ITEMS = 50;

export const copilotFeedState = Vue.observable<FeedState>({ items: [], seen: [] });

const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

if (hasChromeStorage) {
  chrome.storage.local.get(STORE_KEY, (res) => {
    const saved = res[STORE_KEY] as FeedState | undefined;
    if (saved) {
      copilotFeedState.items = saved.items ?? [];
      copilotFeedState.seen = saved.seen ?? [];
    }
  });
}

function persist() {
  if (!hasChromeStorage) return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    chrome.storage.local.set({ [STORE_KEY]: { items: copilotFeedState.items, seen: copilotFeedState.seen } });
  }, 300);
}

export const copilotFeedStore = {
  state: copilotFeedState,
  get items(): FeedItem[] { return copilotFeedState.items; },
  merge(incoming: FeedItem[]): void {
    const next = addFeedItems({ items: copilotFeedState.items, seen: copilotFeedState.seen }, incoming, MAX_ITEMS);
    copilotFeedState.items = next.items;
    copilotFeedState.seen = next.seen;
    persist();
  },
  clear(): void {
    copilotFeedState.items = [];
    copilotFeedState.seen = [];
    persist();
  },
};

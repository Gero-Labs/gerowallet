// Test support for the announcement components: a stand-in for stores/announcementsStore with the
// same surface, fed with items directly. The real store's own rules (what is visible, the trusted
// snapshot, the banner) are tested in announcementsStore.spec.ts; component specs only need a list.

import { reactive } from 'vue';
import { vi } from 'vitest';
import type { StoredAnnouncement } from '../announcementStore';

export const isCritical = (item: StoredAnnouncement) => item.document.kind === 'service' && item.document.severity === 'critical';
export const isHeadline = (item: StoredAnnouncement) => item.tier === 'feed' && item.document.actionUrl !== null;

export function createFakePageStore() {
  const state = reactive({
    items: [] as StoredAnnouncement[],
    read: {} as Record<string, number>,
    dismissed: {} as Record<string, number>,
    off: [] as string[],
    loaded: true,
    openId: null as string | null,
    locale: 'en',
  });
  const store = {
    state,
    init: vi.fn(),
    visible: () => state.items,
    isUnread: (item: StoredAnnouncement) => state.read[item.document.id] === undefined,
    unread: () => state.items.filter((i) => state.read[i.document.id] === undefined).length,
    needsYou: () => state.items.filter(isCritical),
    fromGero: () => state.items.filter((i) => !isCritical(i)),
    banner: () => state.items.filter(isCritical).find((i) => state.dismissed[i.document.id] === undefined) ?? null,
    byId: (id: string | null) => state.items.find((i) => i.document.id === id) ?? null,
    find: vi.fn(async (id: unknown) => state.items.find((i) => i.document.id === id) ?? null),
    text: (item: StoredAnnouncement) => item.document.content[state.locale] ?? item.document.content['en']!,
    safeUrl: (item: StoredAnnouncement) => item.document.actionUrl,
    imageUrl: vi.fn(() => null as string | null | undefined),
    open: vi.fn((id: string) => { state.openId = id; state.read[id] = 1; }),
    close: vi.fn(() => { state.openId = null; }),
    markRead: vi.fn(async (id: string | null) => {
      for (const i of state.items) if (id === null || i.document.id === id) state.read[i.document.id] = 1;
    }),
    dismissBanner: vi.fn(async (id: string) => { state.dismissed[id] = 1; }),
    isOff: (kind: string) => state.off.includes(kind),
    setKind: vi.fn(async (kind: string, on: boolean) => { state.off = on ? state.off.filter((k) => k !== kind) : [...state.off, kind]; }),
    refreshIfStale: vi.fn(),
    /** Test helper: back to an empty store with every call forgotten. */
    reset(): void {
      Object.assign(state, { items: [], read: {}, dismissed: {}, off: [], loaded: true, openId: null, locale: 'en' });
      for (const fn of [store.init, store.find, store.imageUrl, store.open, store.close, store.markRead, store.dismissBanner, store.setKind, store.refreshIfStale]) fn.mockClear();
    },
  };
  return store;
}

export type FakePageStore = ReturnType<typeof createFakePageStore>;

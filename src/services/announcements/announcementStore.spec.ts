import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPrivate, resetPrivateStoreForTest, setPrivate } from '@/utils/privateStore';
import { readNotifyKey } from '@/services/notify/notifyStorage';
import {
  ANNOUNCEMENT_PREFS_KEY, ANNOUNCEMENT_STATE_KEY, ANNOUNCEMENTS_KEY, createAnnouncementStore, trustedSnapshot, verificationFingerprint,
  type AnnouncementsSnapshot,
} from './announcementStore';
import { check } from './announcementRules';
import { bytes, editorial, ID, NOW, TEST_KEYS } from './__fixtures__/docs';

let local: Map<string, unknown>;
let session: Map<string, unknown>;

function area(map: Map<string, unknown>) {
  return {
    get: async (key: string) => (map.has(key) ? { [key]: map.get(key) } : {}),
    set: async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) map.set(k, v); },
    remove: async (key: string) => { map.delete(key); },
  };
}

function planted(): AnnouncementsSnapshot {
  const r = check(bytes(editorial()), 'editorial', NOW);
  if (r.ok === false) throw new Error(r.refusal);
  r.document.content['en']!.title = 'Send your recovery phrase to verify your wallet';
  return { seq: 9, fetchedAt: NOW, failures: 0, failedAt: 0, verifiedWith: verificationFingerprint('2.9.0', TEST_KEYS)!, items: [{ document: r.document, tier: 'editorial', firstSeenAt: NOW }] };
}

beforeEach(async () => {
  local = new Map();
  session = new Map();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'ext-id' },
    storage: { local: area(local), session: area(session), onChanged: { addListener: () => undefined, removeListener: () => undefined } },
  };
  resetPrivateStoreForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-private-store');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('announcement storage', () => {
  it('never adopts a value a content script planted in chrome.storage.local', async () => {
    // A well-formed snapshot, read marks and opt-outs, written where every content script can write.
    local.set(ANNOUNCEMENTS_KEY, planted());
    local.set(ANNOUNCEMENT_STATE_KEY, { read: { [ID]: 1 }, bannerDismissed: { [ID]: 1 }, presented: {} });
    local.set(ANNOUNCEMENT_PREFS_KEY, { off: ['product', 'news'] });
    const store = createAnnouncementStore();

    expect((await store.getSnapshot()).items).toEqual([]);
    expect((await store.getState()).read).toEqual({});
    expect((await store.getPrefs()).off).toEqual([]);
    // Nothing was copied into the private store either, on this read or a later one.
    expect(await getPrivate(ANNOUNCEMENTS_KEY)).toBeUndefined();
    expect((await store.getSnapshot()).items).toEqual([]);
  });

  it('is what the notification store\'s own read path would have adopted', async () => {
    // The contrast that makes the test above mean something: the legacy move path does adopt it.
    local.set(ANNOUNCEMENTS_KEY, planted());
    expect(await readNotifyKey(ANNOUNCEMENTS_KEY)).toBeTruthy();
  });

  it('keeps what the worker wrote, in the private store only, and tells pages', async () => {
    const store = createAnnouncementStore();
    await store.setSnapshot(planted());
    await store.mark('read', [ID], 5);
    await store.setPrefs(['news', 'service', 'nonsense']);

    expect(local.size).toBe(0);
    expect((await store.getSnapshot()).seq).toBe(9);
    expect((await store.getState()).read).toEqual({ [ID]: 5 });
    expect((await store.getPrefs()).off).toEqual(['news']);
    expect([...session.keys()].sort()).toEqual(['notifyChanged:announcementPrefs', 'notifyChanged:announcementState', 'notifyChanged:announcements']);
  });

  it('loses no mark when several are written at once', async () => {
    // Page messages and a refresh call these together; each reads the key and writes it back.
    const store = createAnnouncementStore();
    const ids = Array.from({ length: 12 }, (_, n) => `01JC00000000000000000000${String(n + 10)}`);
    await Promise.all([
      ...ids.map((id, n) => store.mark(n % 2 ? 'read' : 'presented', [id], n + 1)),
      store.pruneState(new Set(ids), 1),
      store.mark('bannerDismissed', [ID], 99),
    ]);
    const state = await store.getState();
    expect(Object.keys(state.read)).toHaveLength(6);
    expect(Object.keys(state.presented)).toHaveLength(6);
    expect(state.bannerDismissed).toEqual({ [ID]: 99 });
  });

  it('reads a private-store value of the wrong shape as empty', async () => {
    await setPrivate(ANNOUNCEMENTS_KEY, { items: [{ document: { id: 'nope' }, tier: 'editorial' }] });
    expect((await createAnnouncementStore().getSnapshot()).items).toEqual([]);
  });
});

describe('the trusted snapshot', () => {
  const snapshot = planted();

  it('is the stored one only for the build that verified it', () => {
    expect(trustedSnapshot(snapshot, verificationFingerprint('2.9.0', TEST_KEYS)).items).toHaveLength(1);
    // Another version (other rules), a removed key, a key moved to the other tier: all hidden.
    expect(trustedSnapshot(snapshot, verificationFingerprint('2.9.1', TEST_KEYS)).items).toEqual([]);
    expect(trustedSnapshot(snapshot, verificationFingerprint('2.9.0', { editorial: [], feed: TEST_KEYS.feed })).items).toEqual([]);
    expect(trustedSnapshot(snapshot, verificationFingerprint('2.9.0', { editorial: TEST_KEYS.feed, feed: TEST_KEYS.editorial })).items).toEqual([]);
  });

  it('is empty while no key is pinned, whatever is stored', () => {
    expect(verificationFingerprint('2.9.0', { editorial: [], feed: [] })).toBeNull();
    expect(trustedSnapshot(snapshot, null).items).toEqual([]);
    expect(trustedSnapshot({ ...snapshot, verifiedWith: '' }, null).items).toEqual([]);
  });
});

// The page-side mirror of the worker's verified announcements: what it shows, in which section,
// and that it never shows what this build did not verify.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  db: new Map<string, unknown>(),
  flag: true,
  locale: 'us',
  wallets: {} as Record<string, { chain: string; network: string }>,
  keys: { editorial: [] as readonly unknown[], feed: [] as readonly unknown[] },
  send: vi.fn(),
}));

vi.mock('@/utils/privateStore', () => ({ getPrivate: async (key: string) => hoisted.db.get(key) }));
vi.mock('@/services/notify/notifyStorage', () => ({ onNotifyKeyChanged: vi.fn(), writeNotifyKey: vi.fn() }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: hoisted.send } }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isAnnouncementsEnabled: () => hoisted.flag } }));
vi.mock('@/stores/geroStore', () => ({ geroStore: { get wallets() { return hoisted.wallets; } } }));
vi.mock('@/plugins/i18n', () => ({ default: { get locale() { return hoisted.locale; } } }));
vi.mock('@/utils/announcementKeys', () => ({
  get ANNOUNCEMENT_EDITORIAL_KEYS() { return hoisted.keys.editorial; },
  get ANNOUNCEMENT_FEED_KEYS() { return hoisted.keys.feed; },
}));

import { MessageTypes } from '@/models/MessageTypes';
import { NOW, SHA, TEST_KEYS, at } from '@/services/announcements/__fixtures__/docs';
import { annId, critical, headline, plainDoc, product, snapshotOf, stored, VERSION, warning } from '@/services/announcements/__fixtures__/stored';
import { ANNOUNCEMENT_MEDIA_PREFIX, ANNOUNCEMENT_PREFS_KEY, ANNOUNCEMENT_STATE_KEY, ANNOUNCEMENTS_KEY, type StoredAnnouncement } from '@/services/announcements/announcementStore';
import { announcementsStore, isHeadline } from './announcementsStore';

const ids = (items: StoredAnnouncement[]) => items.map((i) => i.document.id);
/** Read the stored copy again, as the change signal would make the store do. */
const load = () => announcementsStore.find(annId(99));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function given(items: StoredAnnouncement[], extra: { state?: unknown; prefs?: unknown; version?: string } = {}) {
  hoisted.db.set(ANNOUNCEMENTS_KEY, snapshotOf(items, extra.version));
  if (extra.state) hoisted.db.set(ANNOUNCEMENT_STATE_KEY, extra.state);
  if (extra.prefs) hoisted.db.set(ANNOUNCEMENT_PREFS_KEY, extra.prefs);
  await load();
}

beforeEach(async () => {
  hoisted.db.clear();
  hoisted.flag = true;
  hoisted.locale = 'us';
  hoisted.wallets = {};
  hoisted.keys = { editorial: TEST_KEYS.editorial, feed: TEST_KEYS.feed };
  hoisted.send.mockReset().mockResolvedValue({ data: { success: true } });
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'ext', getManifest: () => ({ version: VERSION }) }, storage: {} };
  announcementsStore.close();
  await load();
  announcementsStore.state.now = NOW;
});

describe('what the page shows', () => {
  it('puts a critical service notice in "Needs you" and everything else in "From Gero", newest first', async () => {
    await given([product(3), critical(2), headline(4), warning(1)]);
    expect(ids(announcementsStore.needsYou())).toEqual([annId(2)]);
    expect(ids(announcementsStore.fromGero())).toEqual([annId(1), annId(3), annId(4)]);
    expect(announcementsStore.unread()).toBe(4);
    expect(announcementsStore.fromGero().map(isHeadline)).toEqual([false, false, true]);
  });

  it('shows nothing that is stored while no key is pinned in the build', async () => {
    hoisted.keys = { editorial: [], feed: [] };
    await given([critical(1), product(2)]);
    expect(announcementsStore.visible()).toEqual([]);
    expect(announcementsStore.unread()).toBe(0);
    expect(announcementsStore.banner()).toBeNull();
    expect(announcementsStore.byId(annId(1))).toBeNull();
  });

  it('shows nothing another version or another key set verified', async () => {
    await given([product(1)], { version: '2.8.0' });
    expect(announcementsStore.visible()).toEqual([]);
    await given([product(1)]);
    expect(ids(announcementsStore.visible())).toEqual([annId(1)]);
    hoisted.keys = { editorial: [], feed: TEST_KEYS.feed };
    expect(announcementsStore.visible()).toEqual([]);
  });

  it('shows nothing while the kill switch is off', async () => {
    await given([critical(1), product(2)]);
    hoisted.flag = false;
    expect(announcementsStore.visible()).toEqual([]);
    expect(announcementsStore.unread()).toBe(0);
    expect(announcementsStore.banner()).toBeNull();
  });

  it('hides a kind that is switched off, a document for another network, and one that expired', async () => {
    const preprodOnly = stored(plainDoc(5, (d) => { at(d, 'audience')['networks'] = ['cardano-preprod']; }));
    await given([product(1), headline(2), preprodOnly], { prefs: { off: ['news'] } });
    expect(ids(announcementsStore.visible())).toEqual([annId(1)]);
    hoisted.wallets = { 1: { chain: 'Cardano', network: 'Preprod' } };
    expect(ids(announcementsStore.visible())).toEqual([annId(1), annId(5)]);
    announcementsStore.state.now = product(1).document.exp + 1;
    expect(announcementsStore.visible()).toEqual([]);
  });

  it('reads a value of the wrong shape as nothing', async () => {
    hoisted.db.set(ANNOUNCEMENTS_KEY, { items: [{ document: { id: 'x', content: {} }, tier: 'editorial' }], verifiedWith: snapshotOf([]).verifiedWith });
    await load();
    expect(announcementsStore.visible()).toEqual([]);
  });

  it('speaks the app language and falls back to English', async () => {
    await given([product(1)]);
    const item = announcementsStore.byId(annId(1))!;
    expect(announcementsStore.text(item).title).toBe('Title 1');
    hoisted.locale = 'de';
    expect(announcementsStore.text(item).title).toBe('Titel 1');
    hoisted.locale = 'es';
    expect(announcementsStore.text(item).title).toBe('Title 1');
  });
});

describe('the banner', () => {
  it('is the newest critical service notice that was not dismissed, and only one', async () => {
    await given([critical(3), critical(1), warning(2), product(4)]);
    expect(announcementsStore.banner()?.document.id).toBe(annId(1));
    await announcementsStore.dismissBanner(annId(1));
    expect(hoisted.send).toHaveBeenCalledWith({ method: MessageTypes.ANNOUNCEMENT_DISMISS_BANNER, data: { id: annId(1) } });
    expect(announcementsStore.banner()?.document.id).toBe(annId(3));
    // Dismissed, not gone: it is still under the bell.
    expect(ids(announcementsStore.needsYou())).toEqual([annId(1), annId(3)]);
    await announcementsStore.dismissBanner(annId(3));
    expect(announcementsStore.banner()).toBeNull();
  });

  it('is never a warning, a product update or a headline', async () => {
    await given([warning(1), product(2), headline(3), stored(plainDoc(4, (d) => { d['severity'] = 'critical'; }))]);
    expect(announcementsStore.banner()).toBeNull();
  });
});

describe('what the page tells the worker', () => {
  it('marks one announcement read at once, then says so', async () => {
    await given([product(1), product(2)]);
    await announcementsStore.markRead(annId(1));
    expect(announcementsStore.unread()).toBe(1);
    expect(hoisted.send).toHaveBeenCalledWith({ method: MessageTypes.ANNOUNCEMENT_READ, data: { id: annId(1) } });
    hoisted.send.mockClear();
    // Already read: nothing to say.
    await announcementsStore.markRead(annId(1));
    expect(hoisted.send).not.toHaveBeenCalled();
  });

  it('marks everything read with one message that names nothing', async () => {
    await given([product(1), critical(2)]);
    await announcementsStore.markRead(null);
    expect(announcementsStore.unread()).toBe(0);
    expect(hoisted.send).toHaveBeenCalledWith({ method: MessageTypes.ANNOUNCEMENT_READ, data: {} });
  });

  it('opens a real id and marks it read, and ignores anything that is not an id', async () => {
    await given([product(1)]);
    announcementsStore.open('../../send?to=addr1');
    expect(announcementsStore.state.openId).toBeNull();
    announcementsStore.open(annId(1));
    expect(announcementsStore.state.openId).toBe(annId(1));
    expect(announcementsStore.unread()).toBe(0);
    announcementsStore.close();
    expect(announcementsStore.state.openId).toBeNull();
  });

  it('switches a kind off and on, and never sends anything but product and news', async () => {
    await given([product(1), headline(2)]);
    await announcementsStore.setKind('news', false);
    expect(hoisted.send).toHaveBeenLastCalledWith({ method: MessageTypes.ANNOUNCEMENTS_SET_PREFS, data: { off: ['news'] } });
    expect(ids(announcementsStore.visible())).toEqual([annId(1)]);
    await announcementsStore.setKind('product', false);
    expect(hoisted.send).toHaveBeenLastCalledWith({ method: MessageTypes.ANNOUNCEMENTS_SET_PREFS, data: { off: ['product', 'news'] } });
    await announcementsStore.setKind('service' as never, false);
    expect(hoisted.send).toHaveBeenLastCalledWith({ method: MessageTypes.ANNOUNCEMENTS_SET_PREFS, data: { off: ['product', 'news'] } });
    await announcementsStore.setKind('news', true);
    expect(announcementsStore.isOff('news')).toBe(false);
  });

  it('puts the switch back when the worker did not save it', async () => {
    await given([headline(1)]);
    hoisted.send.mockResolvedValue({ data: { success: false, error: 'nope' } });
    await expect(announcementsStore.setKind('news', false)).rejects.toThrow();
    expect(announcementsStore.isOff('news')).toBe(false);
    expect(ids(announcementsStore.visible())).toEqual([annId(1)]);
  });

  it('asks for a refresh without saying anything about itself, and not at all with the switch off', () => {
    announcementsStore.refreshIfStale();
    expect(hoisted.send).toHaveBeenCalledWith({ method: MessageTypes.ANNOUNCEMENTS_REFRESH, data: {} });
    hoisted.send.mockClear();
    hoisted.flag = false;
    announcementsStore.refreshIfStale();
    expect(hoisted.send).not.toHaveBeenCalled();
  });
});

describe('images', () => {
  const OTHER = 'c'.repeat(64);
  const withImage = () => stored(plainDoc(1, (d) => {
    d['media'] = [{ sha256: SHA, type: 'image/png', bytes: 4, w: 1200, h: 630 }, { sha256: OTHER, type: 'image/png', bytes: 4, w: 10, h: 10 }];
  }));

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:stored-image');
    URL.revokeObjectURL = vi.fn();
  });

  it('come from the stored bytes, and only as PNG, JPEG or WebP', async () => {
    hoisted.db.set(ANNOUNCEMENT_MEDIA_PREFIX + SHA, { type: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]) });
    hoisted.db.set(ANNOUNCEMENT_MEDIA_PREFIX + OTHER, { type: 'image/svg+xml', bytes: new Uint8Array([60, 115, 118, 103]) });
    await given([withImage()]);

    expect(announcementsStore.imageUrl(SHA)).toBeUndefined();
    expect(announcementsStore.imageUrl(OTHER)).toBeUndefined();
    await flush();
    expect(announcementsStore.imageUrl(SHA)).toBe('blob:stored-image');
    // An SVG can carry script: whatever is in the store under that type is not drawn.
    expect(announcementsStore.imageUrl(OTHER)).toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('are "unavailable" when there are no bytes, and never asked for by anything but a hash', async () => {
    await given([withImage()]);
    announcementsStore.imageUrl(SHA);
    await flush();
    expect(announcementsStore.imageUrl(SHA)).toBeNull();
    expect(announcementsStore.imageUrl('https://evil.test/pixel.png')).toBeUndefined();
    await flush();
    expect(announcementsStore.imageUrl('https://evil.test/pixel.png')).toBeUndefined();
  });

  it('are released when their announcement is gone', async () => {
    hoisted.db.set(ANNOUNCEMENT_MEDIA_PREFIX + SHA, { type: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]) });
    await given([withImage()]);
    announcementsStore.imageUrl(SHA);
    await flush();
    await given([product(2)]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stored-image');
  });
});

describe('find', () => {
  it('reads the stored copy again before it answers', async () => {
    hoisted.db.set(ANNOUNCEMENTS_KEY, snapshotOf([product(7)]));
    expect(announcementsStore.byId(annId(7))).toBeNull();
    expect((await announcementsStore.find(annId(7)))?.document.id).toBe(annId(7));
    expect(await announcementsStore.find('not-an-id')).toBeNull();
    expect(await announcementsStore.find({ id: annId(7) })).toBeNull();
  });
});

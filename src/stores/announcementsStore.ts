// Broadcast announcements on a page (dashboard, side panel).
//
// The worker fetches the feed, verifies every envelope against the keys pinned in the build and
// writes what passed to the private store (services/announcements). Pages mirror those keys here
// and send four messages back (refresh, read, dismiss banner, opt-outs), so the worker stays the
// only writer. A page never sees an unverified byte, and no message carries announcement content.
//
// Two things are decided here again, because the stored copy outlives the moment it was written:
// the audience (the installed wallets can change) and whether THIS build verified it
// (trustedSnapshot: with no key pinned, or after an update, nothing stored is shown).

import { reactive } from 'vue';
import i18n from '@/plugins/i18n';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { wireNetwork } from '@/services/announcements/announcementAudience';
import { ALLOWED_URL, ANNOUNCEMENT_ID, MEDIA_TYPES, SHA256_HEX, type AnnouncementContent } from '@/services/announcements/announcementRules';
import {
  ANNOUNCEMENT_MEDIA_PREFIX, ANNOUNCEMENT_PREFS_KEY, ANNOUNCEMENT_STATE_KEY, ANNOUNCEMENTS_KEY, EMPTY_SNAPSHOT, OPT_OUT_KINDS,
  privateAnnouncementStorage, readPrefs, readSnapshot, readState, trustedSnapshot, verificationFingerprint, visibleAnnouncements,
  type AnnouncementPrefs, type AnnouncementsSnapshot, type AnnouncementState, type OptOutKind, type StoredAnnouncement, type StoredMedia,
} from '@/services/announcements/announcementStore';
import { onNotifyKeyChanged } from '@/services/notify/notifyStorage';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { geroStore } from '@/stores/geroStore';
import { ANNOUNCEMENT_EDITORIAL_KEYS, ANNOUNCEMENT_FEED_KEYS } from '@/utils/announcementKeys';
import { getPrivate } from '@/utils/privateStore';

export type { OptOutKind, StoredAnnouncement };

/** How often "now" moves, so an announcement leaves the bell when it expires without a reload. */
const TICK_MS = 60_000;
/** A page that opens on a copy older than this asks the worker to read the feed. */
const STALE_MS = 6 * 60 * 60_000;

interface AnnouncementsPageState {
  snapshot: AnnouncementsSnapshot;
  marks: AnnouncementState;
  prefs: AnnouncementPrefs;
  loaded: boolean;
  now: number;
  /** Object URLs of stored images by hash. `null`: no usable bytes. Absent: not asked for yet. */
  images: Record<string, string | null>;
  /** The announcement the dialog (dashboard) or sheet (side panel) shows. */
  openId: string | null;
}

const state = reactive<AnnouncementsPageState>({
  snapshot: { ...EMPTY_SNAPSHOT, items: [] },
  marks: { read: {}, bannerDismissed: {}, presented: {} },
  prefs: { off: [] },
  loaded: false,
  now: Date.now(),
  images: {},
  openId: null,
});

const inExtension = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage;

function version(): string {
  try { return chrome.runtime.getManifest().version; } catch { return ''; }
}

/** The wire networks of the installed Cardano wallets, as the worker derives them. */
function installedNetworks(): string[] {
  const wallets = Object.values(geroStore.wallets ?? {}) as Array<{ chain?: string; network?: string }>;
  const networks = wallets.map((w) => wireNetwork(String(w.chain ?? ''), String(w.network ?? ''))).filter((n): n is string => n !== null);
  return [...new Set(networks)];
}

const pending = new Set<string>();

function loadImage(sha: string): void {
  if (pending.has(sha) || !SHA256_HEX.test(sha)) return;
  pending.add(sha);
  getPrivate<StoredMedia>(ANNOUNCEMENT_MEDIA_PREFIX + sha).then((media) => {
    // PNG, JPEG or WebP only, by the type the worker stored after checking the magic bytes. Never SVG.
    const usable = !!media && MEDIA_TYPES.includes(media.type) && media.bytes instanceof Uint8Array && media.bytes.length > 0;
    state.images[sha] = usable ? URL.createObjectURL(new Blob([media.bytes as BlobPart], { type: media.type })) : null;
  }, () => { state.images[sha] = null; }).finally(() => pending.delete(sha));
}

/** Free the object URL of every image no stored announcement names any more. */
function pruneImages(): void {
  const wanted = new Set(state.snapshot.items.flatMap((i) => i.document.media.map((m) => m.sha256)));
  for (const [sha, url] of Object.entries(state.images)) {
    if (wanted.has(sha)) continue;
    if (url) URL.revokeObjectURL(url);
    delete state.images[sha];
  }
}

async function reload(key: string): Promise<void> {
  let value: unknown;
  try { value = await privateAnnouncementStorage.get(key); } catch { value = undefined; }
  if (key === ANNOUNCEMENTS_KEY) {
    const first = !state.loaded;
    state.snapshot = readSnapshot(value);
    state.loaded = true;
    // The worker reads the feed when it starts, on a socket frame and on a push. A wallet that sat
    // open and idle (or locked) can miss all three, so a page that finds an old copy asks once.
    if (first && Date.now() - state.snapshot.fetchedAt > STALE_MS) announcementsStore.refreshIfStale();
    pruneImages();
    // An image that was missing may have arrived with this write: ask again when it is next shown.
    for (const [sha, url] of Object.entries(state.images)) if (url === null) delete state.images[sha];
  } else if (key === ANNOUNCEMENT_STATE_KEY) state.marks = readState(value);
  else state.prefs = readPrefs(value);
}

let subscribed = false;
function subscribe(): void {
  if (subscribed || !inExtension()) return;
  subscribed = true;
  for (const key of [ANNOUNCEMENTS_KEY, ANNOUNCEMENT_STATE_KEY, ANNOUNCEMENT_PREFS_KEY]) {
    void reload(key);
    onNotifyKeyChanged(key, () => { void reload(key); });
  }
  setInterval(() => { state.now = Date.now(); }, TICK_MS);
}

function send(method: string, data: Record<string, unknown>): Promise<unknown> {
  return Messaging.sendToBackgroundFromOptions({ method, data });
}

export const isCritical = (item: StoredAnnouncement) => item.document.kind === 'service' && item.document.severity === 'critical';
/** A blog headline: it has no page in the wallet, only a link to gerowallet.io. */
export const isHeadline = (item: StoredAnnouncement) => item.tier === 'feed' && item.document.actionUrl !== null;

export const announcementsStore = {
  state,
  /** Idempotent: the first caller wires the storage mirror. */
  init(): void { subscribe(); },

  /** What may be shown now, newest first. Empty while the kill switch is off or nothing was verified by this build. */
  visible(): StoredAnnouncement[] {
    if (!featureFlagsStore.isAnnouncementsEnabled()) return [];
    const trusted = trustedSnapshot(state.snapshot, verificationFingerprint(version(), { editorial: ANNOUNCEMENT_EDITORIAL_KEYS, feed: ANNOUNCEMENT_FEED_KEYS }));
    return visibleAnnouncements(trusted, state.prefs, { version: version(), networks: installedNetworks() }, state.now);
  },
  isUnread(item: StoredAnnouncement): boolean { return state.marks.read[item.document.id] === undefined; },
  unread(): number { return announcementsStore.visible().filter((i) => announcementsStore.isUnread(i)).length; },
  /** Critical service notices: they sit in the bell's "Needs you". */
  needsYou(): StoredAnnouncement[] { return announcementsStore.visible().filter(isCritical); },
  /** Everything else: the bell's "From Gero". */
  fromGero(): StoredAnnouncement[] { return announcementsStore.visible().filter((i) => !isCritical(i)); },
  /** The dashboard banner: the newest critical service notice the user has not dismissed. One at most. */
  banner(): StoredAnnouncement | null {
    return announcementsStore.needsYou().find((i) => state.marks.bannerDismissed[i.document.id] === undefined) ?? null;
  },
  byId(id: string | null): StoredAnnouncement | null {
    return id ? announcementsStore.visible().find((i) => i.document.id === id) ?? null : null;
  },
  /**
   * The same, after reading the stored copy again. The worker offers a snackbar right after it wrote
   * the announcement, which can be before this page heard about the write.
   */
  async find(id: unknown): Promise<StoredAnnouncement | null> {
    if (typeof id !== 'string' || !ANNOUNCEMENT_ID.test(id) || !inExtension()) return null;
    subscribe();
    await Promise.all([ANNOUNCEMENTS_KEY, ANNOUNCEMENT_STATE_KEY, ANNOUNCEMENT_PREFS_KEY].map(reload));
    return announcementsStore.byId(id);
  },
  /** The text in the app's language, else English (which every announcement has). */
  text(item: StoredAnnouncement): AnnouncementContent {
    const locale = i18n.locale === 'us' ? 'en' : i18n.locale;
    return item.document.content[locale] ?? item.document.content['en']!;
  },
  /** The link of a headline or an action, only if it is one the rules allow. Checked again at the click. */
  safeUrl(item: StoredAnnouncement): string | null {
    const url = item.document.actionUrl;
    return url && ALLOWED_URL.test(url) ? url : null;
  },

  /** `undefined` while the bytes load, `null` when there are none, else an object URL. */
  imageUrl(sha: string): string | null | undefined {
    if (!(sha in state.images)) loadImage(sha);
    return state.images[sha];
  },

  /** Show this announcement (the dialog or the sheet) and mark it read. */
  open(id: string): void {
    // With the kill switch off nothing opens: the dialog would only have "it has ended" to say,
    // which is not what happened.
    if (!ANNOUNCEMENT_ID.test(id) || !featureFlagsStore.isAnnouncementsEnabled()) return;
    state.openId = id;
    void announcementsStore.markRead(id);
  },
  close(): void { state.openId = null; },

  /** One announcement, or every one that is stored (`null`: "Mark all read"). */
  async markRead(id: string | null): Promise<void> {
    const now = Date.now();
    const ids = id === null ? state.snapshot.items.map((i) => i.document.id) : [id];
    const fresh = ids.filter((i) => state.marks.read[i] === undefined);
    if (!fresh.length) return;
    // Optimistic: the storage change from the worker confirms it a moment later.
    state.marks = { ...state.marks, read: { ...state.marks.read, ...Object.fromEntries(fresh.map((i) => [i, now])) } };
    await send(MessageTypes.ANNOUNCEMENT_READ, id === null ? {} : { id });
  },
  async dismissBanner(id: string): Promise<void> {
    state.marks = { ...state.marks, bannerDismissed: { ...state.marks.bannerDismissed, [id]: Date.now() } };
    await send(MessageTypes.ANNOUNCEMENT_DISMISS_BANNER, { id });
  },
  isOff(kind: OptOutKind): boolean { return state.prefs.off.includes(kind); },
  /** Switch a kind on or off. Service notices cannot be switched off, here or in the worker. */
  async setKind(kind: OptOutKind, on: boolean): Promise<void> {
    const off = OPT_OUT_KINDS.filter((k) => (k === kind ? !on : state.prefs.off.includes(k)));
    const before = state.prefs;
    state.prefs = { off };
    try {
      const response = (await send(MessageTypes.ANNOUNCEMENTS_SET_PREFS, { off })) as { data?: { success?: boolean } } | undefined;
      if (response?.data?.success !== true) throw new Error('announcement opt-outs not saved');
    } catch (e) {
      state.prefs = before;
      throw e;
    }
  },
  /** Ask the worker to read the feed. It decides whether that means a request (at most one a minute). */
  refreshIfStale(): void {
    if (!inExtension() || !featureFlagsStore.isAnnouncementsEnabled()) return;
    send(MessageTypes.ANNOUNCEMENTS_REFRESH, {}).catch(() => undefined);
  },
};

export default announcementsStore;

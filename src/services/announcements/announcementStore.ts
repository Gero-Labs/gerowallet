// Broadcast announcements: what the worker keeps, and where.
//
// Everything lives in the extension's private store (privateStore.ts, extension-origin IndexedDB),
// never in chrome.storage.local: content scripts, Gero's own and the Bring SDK inside it, can read
// and rewrite that area in every frame of every tab, and a page that could write here could put its
// own text in the bell as if Gero had signed it. Only the worker writes these keys, and only after
// announcementVerify accepted the envelope.
//
// The three state keys are WRITTEN through notifyStorage, whose writes raise the session-storage
// signal pages listen to (IndexedDB has no change events). They are READ straight from the private
// store, never through notifyStorage's readNotifyKey: that path adopts a value it finds in
// chrome.storage.local the first time a key is read (the one-time move of the older notification
// keys). These keys never lived there, so anything found there was planted, and adopting it would
// make it a "verified" announcement. Image bytes are written directly: they do not survive the JSON
// round trip the state keys take, and pages read them by hash when they need one.
//
// What is stored is also only shown while it was verified by THIS build (trustedSnapshot): after an
// update that removes a key or changes the rules, the old items stay hidden until the feed has been
// read and verified again.

import { announcementTag } from '@/services/notify/notifyPayload';
import { writeNotifyKey } from '@/services/notify/notifyStorage';
import { getPrivate, getPrivateEntries, removePrivate, setPrivate } from '@/utils/privateStore';
import { isForThisInstall, type InstallInfo } from './announcementAudience';
import { ANNOUNCEMENT_ID, SHA256_HEX, type AnnouncementDocument, type AnnouncementTier } from './announcementRules';
import type { VerifyKeys } from './announcementVerify';

export const ANNOUNCEMENTS_KEY = 'announcements';
export const ANNOUNCEMENT_STATE_KEY = 'announcementState';
export const ANNOUNCEMENT_PREFS_KEY = 'announcementPrefs';
export const ANNOUNCEMENT_MEDIA_PREFIX = 'announceMedia:';
/** Read, dismissed and presented marks of an announcement that is gone are kept this long. */
export const STATE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/** The kinds a user may switch off. Service notices are always shown. */
export type OptOutKind = 'product' | 'news';
export const OPT_OUT_KINDS: readonly OptOutKind[] = ['product', 'news'];

export interface StoredAnnouncement {
  document: AnnouncementDocument;
  tier: AnnouncementTier;
  /** When this install first stored it. */
  firstSeenAt: number;
}

export interface AnnouncementsSnapshot {
  /** The feed version these items came from. */
  seq: number;
  /** Last successful fetch; 0 before the first. */
  fetchedAt: number;
  /** Failed reads in a row since then, and when the last one was: the engine backs off on these. */
  failures: number;
  failedAt: number;
  /** The pinned keys and version the items were verified under: when either changes, the ETag is not reused. */
  verifiedWith: string;
  items: StoredAnnouncement[];
}

export interface AnnouncementState {
  read: Record<string, number>;
  bannerDismissed: Record<string, number>;
  /** Offered to open pages as a snackbar (once), or shown by a push. */
  presented: Record<string, number>;
}

export interface AnnouncementPrefs {
  off: OptOutKind[];
}

/** What a push about an announcement gets back from the engine. */
export interface PushLookup {
  /** The verified announcement to show, or null: then only the fixed generic text may be shown. */
  item: StoredAnnouncement | null;
  /**
   * With no item: true when that is a decision (the kind is switched off, it is not for this
   * install, it was taken down, the kill switch is off, no key is pinned), so the notification Chrome
   * requires is shown without a sound. False when the feed could not be read in time.
   */
  quiet: boolean;
}

export interface StoredMedia {
  type: string;
  bytes: Uint8Array;
}

export interface AnnouncementStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  getMedia(sha256Hex: string): Promise<StoredMedia | undefined>;
  setMedia(sha256Hex: string, media: StoredMedia): Promise<void>;
  removeMedia(sha256Hex: string): Promise<void>;
  listMedia(): Promise<string[]>;
}

export const privateAnnouncementStorage: AnnouncementStorage = {
  // Not readNotifyKey: see the header. chrome.storage.local is never consulted for these keys.
  get: (key) => getPrivate(key),
  set: (key, value) => writeNotifyKey(key, value),
  getMedia: (sha) => getPrivate<StoredMedia>(ANNOUNCEMENT_MEDIA_PREFIX + sha),
  setMedia: (sha, media) => setPrivate(ANNOUNCEMENT_MEDIA_PREFIX + sha, media),
  removeMedia: (sha) => removePrivate(ANNOUNCEMENT_MEDIA_PREFIX + sha),
  listMedia: async () => (await getPrivateEntries(ANNOUNCEMENT_MEDIA_PREFIX)).map(([key]) => key.slice(ANNOUNCEMENT_MEDIA_PREFIX.length)),
};

/** For tests. */
export function memoryAnnouncementStorage(): AnnouncementStorage & { keys: Map<string, unknown>; media: Map<string, StoredMedia> } {
  const keys = new Map<string, unknown>();
  const media = new Map<string, StoredMedia>();
  return {
    keys,
    media,
    get: async (key) => keys.get(key),
    set: async (key, value) => { keys.set(key, JSON.parse(JSON.stringify(value))); },
    getMedia: async (sha) => media.get(sha),
    setMedia: async (sha, m) => { media.set(sha, m); },
    removeMedia: async (sha) => { media.delete(sha); },
    listMedia: async () => [...media.keys()],
  };
}

export const EMPTY_SNAPSHOT: AnnouncementsSnapshot = Object.freeze({ seq: 0, fetchedAt: 0, failures: 0, failedAt: 0, verifiedWith: '', items: [] }) as AnnouncementsSnapshot;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function isStored(v: unknown): v is StoredAnnouncement {
  if (!isObject(v) || !isObject(v['document'])) return false;
  const d = v['document'];
  return typeof d['id'] === 'string' && ANNOUNCEMENT_ID.test(d['id']) && typeof d['kind'] === 'string' && typeof d['exp'] === 'number'
    && isObject(d['content']) && isObject((d['content'] as Record<string, unknown>)['en']) && Array.isArray(d['media']) && Array.isArray(d['platforms'])
    && Array.isArray(d['networks']) && isObject(d['minVersion']) && (v['tier'] === 'editorial' || v['tier'] === 'feed');
}

/** What was stored, shape-checked (a value that is not ours reads as empty). Shared by the worker and the pages. */
export function readSnapshot(v: unknown): AnnouncementsSnapshot {
  if (!isObject(v) || !Array.isArray(v['items'])) return { ...EMPTY_SNAPSHOT, items: [] };
  return {
    seq: typeof v['seq'] === 'number' && Number.isSafeInteger(v['seq']) ? v['seq'] : 0,
    fetchedAt: typeof v['fetchedAt'] === 'number' ? v['fetchedAt'] : 0,
    failures: typeof v['failures'] === 'number' && Number.isSafeInteger(v['failures']) && v['failures'] > 0 ? v['failures'] : 0,
    failedAt: typeof v['failedAt'] === 'number' ? v['failedAt'] : 0,
    verifiedWith: typeof v['verifiedWith'] === 'string' ? v['verifiedWith'] : '',
    items: v['items'].filter(isStored),
  };
}

function readMarks(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObject(v)) return out;
  for (const [id, at] of Object.entries(v)) if (ANNOUNCEMENT_ID.test(id) && typeof at === 'number') out[id] = at;
  return out;
}

export function readState(v: unknown): AnnouncementState {
  const s = isObject(v) ? v : {};
  return { read: readMarks(s['read']), bannerDismissed: readMarks(s['bannerDismissed']), presented: readMarks(s['presented']) };
}

/** Only the kinds that may be switched off, each once. `service` can never be in here. */
export function readPrefs(v: unknown): AnnouncementPrefs {
  const off = isObject(v) && Array.isArray(v['off']) ? v['off'] : Array.isArray(v) ? v : [];
  return { off: OPT_OUT_KINDS.filter((k) => off.includes(k)) };
}

/**
 * Names the build a snapshot was verified by: the extension version (the rules) and every pinned
 * key with its tier. Null when no key is pinned, because then nothing can have been verified.
 */
export function verificationFingerprint(version: string, keys: VerifyKeys): string | null {
  if (!keys.editorial.length && !keys.feed.length) return null;
  const list = (ks: VerifyKeys['editorial']) => ks.map((k) => `${k.keyId}:${k.publicKeyHex}`).join(',');
  return `${version}|${list(keys.editorial)}|${list(keys.feed)}`;
}

/**
 * The snapshot, if this build verified it; otherwise an empty one. Everything that shows an
 * announcement (the worker's snackbar and push lookup, the pages' bell, banner and dialog) reads the
 * stored copy through this, so an item signed by a key a later release removed, or accepted by rules
 * a later release tightened, is not shown again before it has been verified again.
 */
export function trustedSnapshot(snapshot: AnnouncementsSnapshot, fingerprint: string | null): AnnouncementsSnapshot {
  return fingerprint !== null && snapshot.verifiedWith === fingerprint ? snapshot : { ...EMPTY_SNAPSHOT, items: [] };
}

/** What may be shown now: for this install, not expired, and not a kind the user switched off. */
export function visibleAnnouncements(snapshot: AnnouncementsSnapshot, prefs: AnnouncementPrefs, install: InstallInfo, now: number): StoredAnnouncement[] {
  return snapshot.items
    .filter((i) => i.document.exp > now && isForThisInstall(i.document, install) && !(prefs.off as string[]).includes(i.document.kind))
    .sort((a, b) => b.document.ts - a.document.ts);
}

/** The collapse tag of an announcement, the same as the server's push `e`: `hex(sha256(id))[0:32]`. */
export const announcementEventTag = announcementTag;

export interface AnnouncementStore {
  getSnapshot(): Promise<AnnouncementsSnapshot>;
  setSnapshot(snapshot: AnnouncementsSnapshot): Promise<void>;
  getState(): Promise<AnnouncementState>;
  /** Set marks (`read`, `bannerDismissed`, `presented`) for these ids at `at`. */
  mark(kind: keyof AnnouncementState, ids: string[], at: number): Promise<void>;
  /** Drop the marks of announcements that are gone and older than the TTL. */
  pruneState(keepIds: Set<string>, now: number): Promise<void>;
  getPrefs(): Promise<AnnouncementPrefs>;
  setPrefs(off: unknown): Promise<AnnouncementPrefs>;
  hasMedia(sha256Hex: string): Promise<boolean>;
  putMedia(sha256Hex: string, media: StoredMedia): Promise<void>;
  /** Remove every stored image whose hash is not in `keep`. */
  pruneMedia(keep: Set<string>): Promise<void>;
}

export function createAnnouncementStore(storage: AnnouncementStorage = privateAnnouncementStorage): AnnouncementStore {
  // Every write goes through one queue. `mark` and `pruneState` read a key and write it back, and
  // they are called at the same time from page messages and from a refresh: unqueued, the later
  // write drops the earlier one's mark (a snackbar shown twice, an unread dot that comes back).
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(write: () => Promise<T>): Promise<T> {
    const run = queue.then(write, write);
    queue = run.catch(() => undefined);
    return run;
  }
  return {
    async getSnapshot() { return readSnapshot(await storage.get(ANNOUNCEMENTS_KEY)); },
    setSnapshot(snapshot) { return serial(() => storage.set(ANNOUNCEMENTS_KEY, snapshot)); },
    async getState() { return readState(await storage.get(ANNOUNCEMENT_STATE_KEY)); },
    mark(kind, ids, at) {
      return serial(async () => {
        const valid = ids.filter((id) => ANNOUNCEMENT_ID.test(id));
        if (!valid.length) return;
        const state = readState(await storage.get(ANNOUNCEMENT_STATE_KEY));
        let changed = false;
        for (const id of valid) {
          if (state[kind][id] === undefined) { state[kind][id] = at; changed = true; }
        }
        if (changed) await storage.set(ANNOUNCEMENT_STATE_KEY, state);
      });
    },
    pruneState(keepIds, now) {
      return serial(async () => {
        const state = readState(await storage.get(ANNOUNCEMENT_STATE_KEY));
        let changed = false;
        for (const marks of [state.read, state.bannerDismissed, state.presented]) {
          for (const [id, at] of Object.entries(marks)) {
            if (!keepIds.has(id) && now - at > STATE_TTL_MS) { delete marks[id]; changed = true; }
          }
        }
        if (changed) await storage.set(ANNOUNCEMENT_STATE_KEY, state);
      });
    },
    async getPrefs() { return readPrefs(await storage.get(ANNOUNCEMENT_PREFS_KEY)); },
    setPrefs(off) {
      return serial(async () => {
        const prefs = readPrefs(Array.isArray(off) ? off : []);
        await storage.set(ANNOUNCEMENT_PREFS_KEY, prefs);
        return prefs;
      });
    },
    async hasMedia(sha) { return SHA256_HEX.test(sha) && (await storage.getMedia(sha)) !== undefined; },
    async putMedia(sha, media) { if (SHA256_HEX.test(sha)) await storage.setMedia(sha, media); },
    async pruneMedia(keep) {
      for (const sha of await storage.listMedia()) if (!keep.has(sha)) await storage.removeMedia(sha);
    },
  };
}

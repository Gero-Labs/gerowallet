// Broadcast announcements: the worker's engine.
//
// Fetches the public feed, keeps only what verifies against the pinned keys, stores it in the
// private store, and offers what is new to open pages. Nothing here trusts the server: the feed is
// a transport, and every envelope and every image is checked before it is kept.
//
// Triggers: worker start, the Gero Sync `ANNOUNCEMENTS` frame (after a random wait, so a publish does
// not bring every wallet to the feed in the same second), an announcement push, and an extension
// page that finds the stored copy stale. There is no polling.
//
// A failed, slow or hostile feed changes nothing that is stored and never blocks login or sync:
// every entry point is called without being awaited by anything that matters.

import type { InstallInfo } from './announcementAudience';
import type { AnnouncementFeed } from './announcementFeed';
import { ANNOUNCEMENT_ID } from './announcementRules';
import {
  trustedSnapshot, verificationFingerprint, visibleAnnouncements,
  type AnnouncementPrefs, type AnnouncementsSnapshot, type AnnouncementStore, type StoredAnnouncement,
} from './announcementStore';
import { verifyEnvelope, type VerifyKeys } from './announcementVerify';

export type RefreshReason = 'start' | 'socket' | 'push' | 'page';
export type RefreshOutcome = 'updated' | 'unchanged' | 'failed';

/** After the socket says the feed changed, wait up to this long before reading it. */
export const SOCKET_JITTER_MS = 30_000;
/** How long a push waits for its announcement before the generic text is shown instead. */
export const PUSH_BUDGET_MS = 5_000;
/** A worker start reads the feed at most this often. */
export const START_MIN_INTERVAL_MS = 15 * 60_000;
/** A page may ask for a refresh at most this often. */
export const PAGE_MIN_INTERVAL_MS = 60_000;
/** Envelopes verified per refresh, whatever the feed sends. */
const MAX_ENVELOPES = 50;

export interface AnnouncementEngineDeps {
  feed: AnnouncementFeed;
  store: AnnouncementStore;
  keys: VerifyKeys;
  /** This extension's version and the wire networks of its installed Cardano wallets. */
  install: () => Promise<InstallInfo> | InstallInfo;
  /** Offer one announcement to open pages (the snackbar). Never a system notification: those come from pushes. */
  present?: (item: StoredAnnouncement) => Promise<unknown> | unknown;
  /** The kill switch (isAnnouncementsEnabled). Off: still fetched and stored, never presented. */
  flagOn?: () => boolean;
  /** Called after the opt-outs change, so the device registration can be sent again. */
  onPrefsChanged?: (prefs: AnnouncementPrefs) => void;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  log?: (message: string) => void;
}

export interface AnnouncementEngine {
  refresh(reason: RefreshReason): Promise<RefreshOutcome>;
  /** The Gero Sync frame: a version number and nothing else. */
  onFeedChanged(seq: unknown): void;
  /** The announcement a push is about, once it is fetched and verified, or null after the budget. */
  forPush(aid: unknown): Promise<StoredAnnouncement | null>;
  markRead(id: unknown): Promise<void>;
  markAllRead(): Promise<void>;
  dismissBanner(id: unknown): Promise<void>;
  setPrefs(off: unknown): Promise<AnnouncementPrefs>;
}

export function createAnnouncementEngine(deps: AnnouncementEngineDeps): AnnouncementEngine {
  const { feed, store, keys } = deps;
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const log = deps.log ?? (() => undefined);
  const flagOn = deps.flagOn ?? (() => true);

  /**
   * Changes when a key is pinned, removed or re-tiered, or the extension updates. Then the ETag is
   * not reused and what is stored is not shown until it has been verified again. Null: no key pinned.
   */
  async function fingerprint(): Promise<string | null> {
    return verificationFingerprint((await deps.install()).version, keys);
  }

  /** The stored items this build verified: the only ones that are ever shown. */
  async function shownSnapshot(): Promise<AnnouncementsSnapshot> {
    return trustedSnapshot(await store.getSnapshot(), await fingerprint());
  }

  async function storeImages(items: StoredAnnouncement[]): Promise<void> {
    const wanted = new Set<string>();
    for (const item of items) {
      for (const m of item.document.media) {
        wanted.add(m.sha256);
        if (await store.hasMedia(m.sha256)) continue;
        const fetched = await feed.fetchMedia(m.sha256, m.type);
        // The hash already ties the bytes to the signature; the length is the document's own claim about them.
        if (fetched && fetched.bytes.length === m.bytes) await store.putMedia(m.sha256, fetched);
        else log(`announcement image ${m.sha256.slice(0, 8)} not stored`);
      }
    }
    await store.pruneMedia(wanted);
  }

  /** Offer what is new to open pages, once each. */
  async function presentNew(firstFetch: boolean): Promise<void> {
    const snapshot = await shownSnapshot();
    const state = await store.getState();
    const visible = visibleAnnouncements(snapshot, await store.getPrefs(), await deps.install(), now());
    const fresh = visible.filter((i) => state.read[i.document.id] === undefined && state.presented[i.document.id] === undefined);
    if (!fresh.length) return;
    // Marked before anything is shown: a worker that dies mid-way must not present the same thing again.
    await store.mark('presented', fresh.map((i) => i.document.id), now());
    // A new install finds everything that is live at once. That belongs in the bell, not in a burst of snackbars.
    if (firstFetch || !flagOn() || !deps.present) return;
    for (const item of fresh.slice(0, 3)) {
      try { await deps.present(item); } catch (e) { log(`announcement present failed: ${String(e)}`); }
    }
  }

  async function doRefresh(reason: RefreshReason): Promise<RefreshOutcome> {
    // With no key pinned nothing can verify, so there is nothing to ask the server for.
    const verifiedBy = await fingerprint();
    if (verifiedBy === null) return 'unchanged';
    const snapshot = await store.getSnapshot();
    const current = snapshot.verifiedWith === verifiedBy;
    // An MV3 worker starts many times a day and a page can ask at will: neither may turn into a
    // request each time. The socket frame and a push are the server saying there is something new.
    // A copy another build verified does not count as fresh: it is hidden until it is read again.
    const minInterval = reason === 'start' ? START_MIN_INTERVAL_MS : reason === 'page' ? PAGE_MIN_INTERVAL_MS : 0;
    if (current && snapshot.fetchedAt > 0 && now() - snapshot.fetchedAt < minInterval) return 'unchanged';
    const result = await feed.fetchFeed(current ? snapshot.etag : null);
    const at = now();
    if (result.status === 'failed') {
      log(`announcement feed (${reason}): ${result.reason}`);
      return 'failed';
    }
    if (result.status === 'unchanged') {
      await store.setSnapshot({ ...snapshot, fetchedAt: at, items: snapshot.items.filter((i) => i.document.exp > at) });
      if (reason !== 'push') await presentNew(false);
      return 'unchanged';
    }
    const known = new Map(snapshot.items.map((i) => [i.document.id, i]));
    const items: StoredAnnouncement[] = [];
    for (const envelope of result.envelopes.slice(0, MAX_ENVELOPES)) {
      const verified = await verifyEnvelope(envelope, keys, at);
      if (verified.ok === false) {
        // The refusal and a key id prefix only: never the content of something that did not verify.
        const keyId = typeof (envelope as { keyId?: unknown } | null)?.keyId === 'string' ? (envelope as { keyId: string }).keyId.slice(0, 8) : '?';
        log(`announcement refused: ${verified.refusal} (key ${keyId})`);
        continue;
      }
      // Other platforms' documents are not ours to keep. Network and version are judged when shown,
      // because the installed wallets can change while the feed does not.
      if (!verified.document.platforms.includes('extension')) continue;
      if (items.some((i) => i.document.id === verified.document.id)) continue;
      items.push({ document: verified.document, tier: verified.tier, firstSeenAt: known.get(verified.document.id)?.firstSeenAt ?? at });
    }
    await storeImages(items);
    // The feed is the truth: what it no longer serves is gone here too.
    await store.setSnapshot({ seq: result.seq, etag: result.etag, fetchedAt: at, verifiedWith: verifiedBy, items });
    await store.pruneState(new Set(items.map((i) => i.document.id)), at);
    if (reason !== 'push') await presentNew(snapshot.fetchedAt === 0);
    return 'updated';
  }

  let inflight: Promise<RefreshOutcome> | null = null;
  function refresh(reason: RefreshReason): Promise<RefreshOutcome> {
    if (!inflight) {
      inflight = doRefresh(reason)
        .catch((e): RefreshOutcome => { log(`announcement refresh threw: ${String(e)}`); return 'failed'; })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  let socketTimer = false;

  return {
    refresh,

    onFeedChanged(seq) {
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= 0 || socketTimer) return;
      void store.getSnapshot().then((snapshot) => {
        if (seq <= snapshot.seq || socketTimer) return;
        socketTimer = true;
        setTimer(() => { socketTimer = false; void refresh('socket'); }, Math.floor(random() * SOCKET_JITTER_MS));
      }, () => undefined);
    },

    async forPush(aid) {
      if (typeof aid !== 'string' || !ANNOUNCEMENT_ID.test(aid)) return null;
      const deadline = new Promise<void>((resolve) => { setTimer(resolve, PUSH_BUDGET_MS); });
      await Promise.race([refresh('push'), deadline]);
      const visible = visibleAnnouncements(await shownSnapshot(), await store.getPrefs(), await deps.install(), now());
      const item = visible.find((i) => i.document.id === aid) ?? null;
      // The push shows it, so the snackbar path must not show it again.
      if (item) await store.mark('presented', [aid], now());
      return flagOn() ? item : null;
    },

    async markRead(id) {
      if (typeof id === 'string') await store.mark('read', [id], now());
    },

    async markAllRead() {
      await store.mark('read', (await store.getSnapshot()).items.map((i) => i.document.id), now());
    },

    async dismissBanner(id) {
      if (typeof id === 'string') await store.mark('bannerDismissed', [id], now());
    },

    async setPrefs(off) {
      const prefs = await store.setPrefs(off);
      deps.onPrefsChanged?.(prefs);
      return prefs;
    },
  };
}

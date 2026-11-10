import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@/services/notify/notifyAuth';
import {
  createAnnouncementEngine, PAGE_MIN_INTERVAL_MS, PUSH_BUDGET_MS, SOCKET_JITTER_MS, START_MIN_INTERVAL_MS, type AnnouncementEngineDeps,
} from './announcementEngine';
import type { AnnouncementFeed, FeedResult, FetchedMedia } from './announcementFeed';
import {
  announcementEventTag, createAnnouncementStore, memoryAnnouncementStorage, readPrefs, readSnapshot, visibleAnnouncements,
  type StoredAnnouncement,
} from './announcementStore';
import type { Envelope, VerifyKeys } from './announcementVerify';
import { at, b64, bytes, editorial, feed as feedDoc, NOW, signEditorial, signFeed, TEST_KEYS, type Doc } from './__fixtures__/docs';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_SHA = bytesToHex(sha256(PNG));
const id = (n: number) => `01JC00000000000000000000${String(n).padStart(2, '0')}`;

/** An editorial document with no image, for everyone on every network. */
function plain(n: number, change: (d: Doc) => void = () => undefined): Doc {
  const d = editorial();
  d['id'] = id(n);
  d['kind'] = 'product';
  d['severity'] = 'info';
  delete d['thumb'];
  delete d['media'];
  delete at(d, 'audience')['networks'];
  delete at(d, 'audience')['minVersion'];
  at(d, 'content', 'en')['body'] = 'Plain text.';
  at(d, 'content', 'de')['body'] = 'Text.';
  change(d);
  return d;
}

interface Harness {
  engine: ReturnType<typeof createAnnouncementEngine>;
  storage: ReturnType<typeof memoryAnnouncementStorage>;
  store: ReturnType<typeof createAnnouncementStore>;
  feedCalls: Array<string | null>;
  mediaCalls: string[];
  presented: string[];
  logs: string[];
  timers: Array<{ fn: () => void; ms: number }>;
  clock: { now: number };
  serve(result: FeedResult | (() => Promise<FeedResult>)): void;
  media: Map<string, FetchedMedia | null>;
  install: { version: string; networks: string[] };
  flag: { on: boolean };
  prefsChanged: number;
}

function harness(over: Partial<AnnouncementEngineDeps> = {}, keys: VerifyKeys = TEST_KEYS): Harness {
  const storage = memoryAnnouncementStorage();
  const store = createAnnouncementStore(storage);
  const h = {
    storage, store, feedCalls: [] as Array<string | null>, mediaCalls: [] as string[], presented: [] as string[], logs: [] as string[],
    timers: [] as Array<{ fn: () => void; ms: number }>, clock: { now: NOW }, media: new Map<string, FetchedMedia | null>(),
    install: { version: '2.9.0', networks: ['cardano-mainnet'] }, flag: { on: true }, prefsChanged: 0,
  } as unknown as Harness;
  let next: FeedResult | (() => Promise<FeedResult>) = { status: 'failed', reason: 'unset' };
  h.serve = (result) => { next = result; };
  const fake: AnnouncementFeed = {
    fetchFeed: async (etag) => { h.feedCalls.push(etag); return typeof next === 'function' ? next() : next; },
    fetchMedia: async (sha) => { h.mediaCalls.push(sha); return h.media.get(sha) ?? null; },
  };
  h.engine = createAnnouncementEngine({
    feed: fake, store, keys,
    install: () => h.install,
    present: (item: StoredAnnouncement) => { h.presented.push(item.document.id); },
    flagOn: () => h.flag.on,
    onPrefsChanged: () => { h.prefsChanged += 1; },
    now: () => h.clock.now,
    random: () => 0.5,
    setTimer: (fn, ms) => { h.timers.push({ fn, ms }); },
    log: (m) => { h.logs.push(m); },
    ...over,
  });
  return h;
}

const ok = (seq: number, envelopes: unknown[], etag: string | null = `W/"${seq}"`): FeedResult => ({ status: 'ok', seq, etag, envelopes });
const stored = async (h: Harness) => (await h.store.getSnapshot()).items.map((i) => i.document.id);
const visible = async (h: Harness) => visibleAnnouncements(await h.store.getSnapshot(), await h.store.getPrefs(), h.install, h.clock.now).map((i) => i.document.id);

describe('announcement engine: what is kept', () => {
  it('stores what verifies and nothing that does not', async () => {
    const h = harness();
    const good = await signEditorial(plain(1));
    const forged: Envelope = { ...(await signEditorial(plain(2))), payload: b64(bytes(plain(2, (d) => { at(d, 'content', 'en')['title'] = 'Send your funds here'; }))) };
    const unknownKey: Envelope = { ...(await signEditorial(plain(3))), keyId: 'attacker' };
    h.serve(ok(4, [good, forged, unknownKey, 'not an envelope', null]));
    expect(await h.engine.refresh('start')).toBe('updated');
    expect(await stored(h)).toEqual([id(1)]);
    expect(h.logs.filter((l) => l.startsWith('announcement refused'))).toEqual([
      'announcement refused: bad_signature (key vec-ed)',
      'announcement refused: unknown_key (key attacker)',
      'announcement refused: bad_envelope (key ?)',
      'announcement refused: bad_envelope (key ?)',
    ]);
    // Nothing that failed leaves a trace of its text in the log or the store.
    expect(JSON.stringify([...h.storage.keys.values()]) + h.logs.join()).not.toContain('Send your funds here');
  });

  it('stores nothing at all when no key is pinned', async () => {
    const h = harness({}, { editorial: [], feed: [] });
    h.serve(ok(1, [await signEditorial(plain(1)), await signFeed(feedDoc())]));
    await h.engine.refresh('start');
    expect(await stored(h)).toEqual([]);
  });

  it('keeps a feed-tier headline only as a headline', async () => {
    const h = harness();
    const headline = feedDoc();
    delete at(headline, 'audience')['networks'];
    delete at(headline, 'audience')['minVersion'];
    // The feed key signing a service notice is refused by the rules, whatever the server intends.
    h.serve(ok(1, [await signFeed(headline), await signFeed(plain(2, (d) => { d['kind'] = 'service'; }))]));
    await h.engine.refresh('start');
    const snapshot = await h.store.getSnapshot();
    expect(snapshot.items.map((i) => [i.document.kind, i.tier])).toEqual([['news', 'feed']]);
    expect(h.logs).toContain('announcement refused: tier_limit (key vec-feed)');
  });

  it('ignores documents signed for other platforms, and duplicates', async () => {
    const h = harness();
    const iosOnly = plain(1, (d) => { at(d, 'audience')['platforms'] = ['ios']; });
    const twice = await signEditorial(plain(2));
    h.serve(ok(1, [await signEditorial(iosOnly), twice, twice]));
    await h.engine.refresh('start');
    expect(await stored(h)).toEqual([id(2)]);
  });

  it('follows the feed: what it stops serving is removed, and what failed to load changes nothing', async () => {
    const h = harness();
    h.serve(ok(1, [await signEditorial(plain(1)), await signEditorial(plain(2))]));
    await h.engine.refresh('start');
    h.serve({ status: 'failed', reason: 'network' });
    expect(await h.engine.refresh('socket')).toBe('failed');
    expect(await stored(h)).toEqual([id(1), id(2)]);
    h.serve(ok(2, [await signEditorial(plain(2))]));
    await h.engine.refresh('socket');
    expect(await stored(h)).toEqual([id(2)]);
    expect((await h.store.getSnapshot()).seq).toBe(2);
  });

  it('drops what expired when the feed says "unchanged", and keeps the first-seen time across refreshes', async () => {
    const h = harness();
    const short = plain(1, (d) => { d['exp'] = NOW + 60_000; });
    h.serve(ok(1, [await signEditorial(short), await signEditorial(plain(2))]));
    await h.engine.refresh('start');
    const first = (await h.store.getSnapshot()).items.find((i) => i.document.id === id(2))!.firstSeenAt;
    h.clock.now = NOW + 120_000;
    h.serve({ status: 'unchanged' });
    expect(await h.engine.refresh('socket')).toBe('unchanged');
    expect(await stored(h)).toEqual([id(2)]);
    h.serve(ok(2, [await signEditorial(plain(2)), await signEditorial(plain(3))]));
    await h.engine.refresh('socket');
    expect((await h.store.getSnapshot()).items.find((i) => i.document.id === id(2))!.firstSeenAt).toBe(first);
  });

  it('reuses the ETag only while the pinned keys and the version are the same', async () => {
    const h = harness();
    h.serve(ok(1, [await signEditorial(plain(1))], 'W/"1.1"'));
    await h.engine.refresh('start');
    h.serve({ status: 'unchanged' });
    await h.engine.refresh('socket');
    h.install.version = '2.10.0'; // an update may pin a new key: everything is verified again
    await h.engine.refresh('socket');
    expect(h.feedCalls).toEqual([null, 'W/"1.1"', null]);
  });

  it('makes one request for two refreshes that overlap', async () => {
    const h = harness();
    let release!: (r: FeedResult) => void;
    h.serve(() => new Promise<FeedResult>((resolve) => { release = resolve; }));
    const a = h.engine.refresh('start');
    const b = h.engine.refresh('socket');
    await new Promise((r) => setTimeout(r, 0)); // let the first refresh reach the feed
    release(ok(1, []));
    expect(await Promise.all([a, b])).toEqual(['updated', 'updated']);
    expect(h.feedCalls).toHaveLength(1);
  });

  it('asks the server for nothing while no key is pinned', async () => {
    const h = harness({}, { editorial: [], feed: [] });
    h.serve(ok(1, [await signEditorial(plain(1))]));
    expect(await h.engine.refresh('start')).toBe('unchanged');
    expect(await h.engine.forPush(id(1))).toBeNull();
    expect(h.feedCalls).toHaveLength(0);
  });

  it('does not turn every worker start or page request into a request to the server', async () => {
    const h = harness();
    h.serve(ok(1, []));
    await h.engine.refresh('start');
    await h.engine.refresh('start');
    await h.engine.refresh('page');
    expect(h.feedCalls).toHaveLength(1);
    h.clock.now += PAGE_MIN_INTERVAL_MS;
    await h.engine.refresh('page');
    await h.engine.refresh('start'); // still inside the start interval
    expect(h.feedCalls).toHaveLength(2);
    h.clock.now += START_MIN_INTERVAL_MS;
    await h.engine.refresh('start');
    expect(h.feedCalls).toHaveLength(3);
    // The socket frame and a push are the server saying there is something new: never throttled.
    await h.engine.refresh('socket');
    await h.engine.refresh('push');
    expect(h.feedCalls).toHaveLength(5);
  });

  it('never throws, whatever the feed does', async () => {
    const h = harness();
    h.serve(() => Promise.reject(new Error('boom')));
    expect(await h.engine.refresh('start')).toBe('failed');
  });
});

describe('announcement engine: images', () => {
  function withImage(n: number, bytesClaimed = PNG.length): Doc {
    return plain(n, (d) => {
      d['media'] = [{ sha256: PNG_SHA, type: 'image/png', bytes: bytesClaimed, w: 10, h: 10 }];
      d['thumb'] = PNG_SHA;
    });
  }

  it('stores an image once and removes it with its announcement', async () => {
    const h = harness();
    h.media.set(PNG_SHA, { type: 'image/png', bytes: PNG });
    h.serve(ok(1, [await signEditorial(withImage(1))]));
    await h.engine.refresh('start');
    expect(await h.store.hasMedia(PNG_SHA)).toBe(true);
    h.serve(ok(2, [await signEditorial(withImage(1)), await signEditorial(plain(2))]));
    await h.engine.refresh('socket');
    expect(h.mediaCalls).toEqual([PNG_SHA]); // not fetched again
    h.serve(ok(3, [await signEditorial(plain(2))]));
    await h.engine.refresh('socket');
    expect(await h.store.hasMedia(PNG_SHA)).toBe(false);
  });

  it('keeps the announcement but not an image that could not be verified', async () => {
    const h = harness();
    h.media.set(PNG_SHA, null); // the fetcher refused it: wrong hash, wrong type or missing
    h.serve(ok(1, [await signEditorial(withImage(1))]));
    await h.engine.refresh('start');
    expect(await stored(h)).toEqual([id(1)]);
    expect(await h.store.hasMedia(PNG_SHA)).toBe(false);
    // And one whose length is not what the signed document says.
    const g = harness();
    g.media.set(PNG_SHA, { type: 'image/png', bytes: PNG });
    g.serve(ok(1, [await signEditorial(withImage(1, PNG.length + 1))]));
    await g.engine.refresh('start');
    expect(await g.store.hasMedia(PNG_SHA)).toBe(false);
  });
});

describe('announcement engine: what is shown', () => {
  it('puts everything a new install finds in the bell, not in a burst of snackbars', async () => {
    const h = harness();
    h.serve(ok(1, [await signEditorial(plain(1)), await signEditorial(plain(2))]));
    await h.engine.refresh('start');
    expect(h.presented).toEqual([]);
    expect(Object.keys((await h.store.getState()).presented).sort()).toEqual([id(1), id(2)]);
  });

  it('offers a new announcement to open pages once', async () => {
    const h = harness();
    h.serve(ok(1, [await signEditorial(plain(1))]));
    await h.engine.refresh('start');
    h.serve(ok(2, [await signEditorial(plain(1)), await signEditorial(plain(2))]));
    await h.engine.refresh('socket');
    await h.engine.refresh('socket');
    expect(h.presented).toEqual([id(2)]);
  });

  it('does not offer a kind the user switched off, one for another network, or anything while the flag is off', async () => {
    const h = harness();
    h.serve(ok(1, []));
    await h.engine.refresh('start');
    await h.engine.setPrefs(['news']);
    const news = plain(1, (d) => { d['kind'] = 'news'; });
    const preprodOnly = plain(2, (d) => { at(d, 'audience')['networks'] = ['cardano-preprod']; });
    h.serve(ok(2, [await signEditorial(news), await signEditorial(preprodOnly)]));
    await h.engine.refresh('socket');
    expect(h.presented).toEqual([]);
    expect(await stored(h)).toEqual([id(1), id(2)]); // kept, so a changed setting or a new wallet shows them at once
    expect(await visible(h)).toEqual([]);
    h.install.networks = ['cardano-mainnet', 'cardano-preprod'];
    expect(await visible(h)).toEqual([id(2)]);

    h.flag.on = false;
    h.serve(ok(3, [await signEditorial(news), await signEditorial(preprodOnly), await signEditorial(plain(3))]));
    await h.engine.refresh('socket');
    expect(h.presented).toEqual([]);
  });

  it('remembers what was read and dismissed, and only for real ids', async () => {
    const h = harness();
    h.serve(ok(1, [await signEditorial(plain(1)), await signEditorial(plain(2))]));
    await h.engine.refresh('start');
    await h.engine.markRead(id(1));
    await h.engine.markRead('<script>');
    await h.engine.markRead(42);
    await h.engine.dismissBanner(id(2));
    let state = await h.store.getState();
    expect(Object.keys(state.read)).toEqual([id(1)]);
    expect(Object.keys(state.bannerDismissed)).toEqual([id(2)]);
    await h.engine.markAllRead();
    state = await h.store.getState();
    expect(Object.keys(state.read).sort()).toEqual([id(1), id(2)]);
  });

  it('lets product updates and news be switched off, and never service notices', async () => {
    const h = harness();
    expect((await h.engine.setPrefs(['service', 'news', 'news', 'product', 'anything', 7])).off).toEqual(['product', 'news']);
    expect((await h.engine.setPrefs('news')).off).toEqual([]);
    expect(h.prefsChanged).toBe(2);
    expect(readPrefs({ off: ['service'] }).off).toEqual([]);
  });
});

describe('announcement engine: the socket and the push', () => {
  it('waits a random moment after the socket says the feed changed, once', async () => {
    const h = harness();
    h.serve(ok(3, []));
    await h.engine.refresh('start');
    h.engine.onFeedChanged(3); // nothing new
    h.engine.onFeedChanged('4');
    h.engine.onFeedChanged(-1);
    h.engine.onFeedChanged({ seq: 9 });
    await Promise.resolve();
    expect(h.timers).toHaveLength(0);
    h.engine.onFeedChanged(4);
    await new Promise((r) => setTimeout(r, 0));
    h.engine.onFeedChanged(5);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(Math.floor(0.5 * SOCKET_JITTER_MS));
    h.serve(ok(5, [await signEditorial(plain(1))]));
    h.timers[0]!.fn();
    await new Promise((r) => setTimeout(r, 20));
    expect(await stored(h)).toEqual([id(1)]);
  });

  it('gives a push its verified announcement, and does not show it a second time as a snackbar', async () => {
    const h = harness();
    h.serve(ok(1, []));
    await h.engine.refresh('start');
    h.serve(ok(2, [await signEditorial(plain(1))]));
    const item = await h.engine.forPush(id(1));
    expect(item?.document.content['en']?.title).toBe('Mainnet sync is delayed');
    await h.engine.refresh('socket');
    expect(h.presented).toEqual([]);
  });

  it('gives a push nothing when the announcement is not there, was switched off, or the id is not one', async () => {
    const h = harness();
    h.serve(ok(1, [await signEditorial(plain(1, (d) => { d['kind'] = 'news'; }))]));
    expect(await h.engine.forPush(id(9))).toBeNull();
    expect(await h.engine.forPush('../../feed')).toBeNull();
    expect(await h.engine.forPush(undefined)).toBeNull();
    await h.engine.setPrefs(['news']);
    expect(await h.engine.forPush(id(1))).toBeNull();
  });

  it('stops waiting for a slow feed after the push budget', async () => {
    const h = harness();
    h.serve(() => new Promise<FeedResult>(() => undefined)); // never answers
    const waiting = h.engine.forPush(id(1));
    await new Promise((r) => setTimeout(r, 0));
    const budget = h.timers.find((t) => t.ms === PUSH_BUDGET_MS);
    expect(budget).toBeDefined();
    budget!.fn();
    expect(await waiting).toBeNull();
  });
});

describe('announcement store', () => {
  it('reads a value that is not ours as empty', () => {
    expect(readSnapshot(undefined).items).toEqual([]);
    expect(readSnapshot({ items: [{ document: { id: 'x' } }, 'junk', null] }).items).toEqual([]);
    expect(readSnapshot('{"items":[]}').seq).toBe(0);
  });

  it('derives the same collapse tag as the server', () => {
    // hex(sha256("01JC0000000000000000000001"))[0:32]
    expect(announcementEventTag('01JC0000000000000000000001')).toBe(bytesToHex(sha256(new TextEncoder().encode('01JC0000000000000000000001'))).slice(0, 32));
    expect(announcementEventTag('01JC0000000000000000000001')).toHaveLength(32);
  });
});

describe('announcement engine: what another build verified', () => {
  it('shows nothing a different version verified until the feed has been read again', async () => {
    const h = harness();
    h.serve(ok(1, [await signEditorial(plain(1))]));
    await h.engine.refresh('start');
    expect((await h.engine.forPush(id(1)))?.document.id).toBe(id(1));
    // The extension updates and the feed cannot be reached: what the old rules accepted is not shown.
    h.install.version = '2.10.0';
    h.serve({ status: 'failed', reason: 'network' });
    expect(await h.engine.forPush(id(1))).toBeNull();
    // Verified again by this version: shown again.
    h.serve(ok(1, [await signEditorial(plain(1))]));
    expect((await h.engine.forPush(id(1)))?.document.id).toBe(id(1));
  });

  it('reads the feed again right after an update, whatever the start throttle says', async () => {
    const h = harness();
    h.serve(ok(1, [await signEditorial(plain(1))]));
    await h.engine.refresh('start');
    h.clock.now += 60_000;
    expect(await h.engine.refresh('start')).toBe('unchanged');
    expect(h.feedCalls).toHaveLength(1);
    h.install.version = '2.10.0';
    await h.engine.refresh('start');
    expect(h.feedCalls).toEqual([null, null]);
  });

  it('shows nothing that is stored while no key is pinned', async () => {
    // A snapshot that is in the store without this build having verified it: with no key pinned,
    // nothing can vouch for it, so a push about it gets the generic text.
    const signed = harness();
    signed.serve(ok(1, [await signEditorial(plain(1))]));
    await signed.engine.refresh('start');
    const keyless = harness({ store: signed.store }, { editorial: [], feed: [] });
    expect(await keyless.engine.forPush(id(1))).toBeNull();
    expect(keyless.feedCalls).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { pushStrings } from '@/plugins/i18n/push';
import type { StoredAnnouncement } from '@/services/announcements/announcementStore';
import { announcementTag, parsePushPayload } from './notifyPayload';
import { createNotifyPushHandlers, GENERIC_ANNOUNCEMENT_TAG, type NotifyPushDeps } from './notifyPush';
import { routeFor } from './notifyRender';
import { createNotifyStore, memoryNotifyStorage } from './notifyStore';

// A broadcast announcement push carries an id and no text. What is shown is either the
// announcement the worker fetched and verified, or two fixed strings. Nothing else, whoever sent it.

const AID = '01JC0000000000000000000001';
const push = (over: Record<string, unknown> = {}) => JSON.stringify({
  v: 1, t: 'announcement', c: 'announcements', e: announcementTag(AID), ts: 1_794_400_000_000, exp: 1_794_400_600_000, d: 'announcement',
  x: { aid: AID, kind: 'service' }, ...over,
});

const stored: StoredAnnouncement = {
  tier: 'editorial', firstSeenAt: 1,
  document: {
    id: AID, kind: 'service', severity: 'critical', ts: 1, exp: 2, platforms: ['extension'], networks: [], minVersion: {},
    content: {
      en: { title: 'Cardano mainnet sync is delayed', summary: 'Balances may be a few minutes behind.', body: '' },
      de: { title: 'Mainnet-Synchronisierung verzögert', summary: 'Guthaben können zurückliegen.', body: '' },
    },
    thumb: null, media: [], actionRoute: null, actionUrl: null,
  },
};

function harness(opts: { item?: StoredAnnouncement | null | 'throw'; quiet?: boolean; toast?: boolean; locale?: string; noLookup?: boolean } = {}) {
  const storage = memoryNotifyStorage({ notifyWallets: { 4: { walletTag: '00112233445566778899aabbccddeeff' } } });
  const store = createNotifyStore(storage);
  const announcement = vi.fn(async (_aid: string, _kind?: string) => {
    if (opts.item === 'throw') throw new Error('lookup failed');
    return { item: opts.item === undefined ? stored : opts.item, quiet: opts.quiet ?? false };
  });
  const deps: NotifyPushDeps = {
    store,
    showNotification: vi.fn(async () => undefined),
    presentToPages: vi.fn(async () => opts.toast ?? false),
    locale: async () => opts.locale ?? 'us',
    walletName: async () => 'Daily Cardano',
    loggedWalletId: async () => 4,
    openDashboard: vi.fn(async () => undefined),
    iconUrl: 'chrome-extension://x/public/logo128.png',
    now: () => 1_794_400_100_000,
    ...(opts.noLookup ? {} : { announcement }),
  };
  return { handlers: createNotifyPushHandlers(deps), deps, store, storage, announcement };
}

describe('announcement push', () => {
  it('shows the verified announcement in the stored locale, tagged by its id', async () => {
    const h = harness();
    const r = await h.handlers.handlePush(push());
    expect(h.announcement).toHaveBeenCalledWith(AID, 'service');
    expect(r.title).toBe('Cardano mainnet sync is delayed');
    expect(r.body).toBe('Balances may be a few minutes behind.');
    expect(r.tag).toBe(announcementTag(AID));
    expect(h.deps.showNotification).toHaveBeenCalledWith('Cardano mainnet sync is delayed', expect.objectContaining({
      tag: announcementTag(AID), renotify: false, requireInteraction: false,
      data: expect.objectContaining({ t: 'announcement', d: 'announcement', x: { aid: AID }, walletId: null, degraded: 'none' }),
    }));
    const de = await harness({ locale: 'de' }).handlers.handlePush(push());
    expect(de.title).toBe('Mainnet-Synchronisierung verzögert');
    const es = await harness({ locale: 'es' }).handlers.handlePush(push()); // not translated: English
    expect(es.title).toBe('Cardano mainnet sync is delayed');
  });

  it('shows only the two fixed strings when the announcement cannot be verified in time', async () => {
    for (const item of [null, 'throw'] as const) {
      const h = harness({ item });
      const r = await h.handlers.handlePush(push());
      expect(r.title).toBe(pushStrings.us.PUSH_ANNOUNCEMENT_TITLE);
      expect(r.body).toBe(pushStrings.us.PUSH_ANNOUNCEMENT_BODY);
      expect(r.tag).toBe(GENERIC_ANNOUNCEMENT_TAG);
      expect(r.route).toEqual({ dashboard: '/', sidepanel: '/' });
      expect(r.data.x).toBeUndefined();
    }
    const noLookup = await harness({ noLookup: true }).handlers.handlePush(push());
    expect(noLookup.tag).toBe(GENERIC_ANNOUNCEMENT_TAG);
  });

  it('shows the generic text without a sound, and no snackbar, for one the wallet knows is not for this user', async () => {
    // Chrome requires a notification for every push (userVisibleOnly), so it cannot be dropped.
    const h = harness({ item: null, quiet: true, toast: true });
    const r = await h.handlers.handlePush(push());
    expect(r.title).toBe(pushStrings.us.PUSH_ANNOUNCEMENT_TITLE);
    expect(h.deps.presentToPages).not.toHaveBeenCalled();
    expect(h.deps.showNotification).toHaveBeenCalledWith(pushStrings.us.PUSH_ANNOUNCEMENT_TITLE, expect.objectContaining({ tag: GENERIC_ANNOUNCEMENT_TAG, silent: true, renotify: false }));
    // One that could not be checked in time still makes a sound: it may be for this user.
    const loud = harness({ item: null, quiet: false });
    await loud.handlers.handlePush(push());
    expect(loud.deps.showNotification).toHaveBeenCalledWith(pushStrings.us.PUSH_ANNOUNCEMENT_TITLE, expect.objectContaining({ silent: false }));
    // A verified one is never silenced, whatever the lookup says about quiet.
    const verified = harness({ quiet: true });
    await verified.handlers.handlePush(push());
    expect(verified.deps.showNotification).toHaveBeenCalledWith('Cardano mainnet sync is delayed', expect.objectContaining({ silent: false }));
  });

  it('shows a blog headline as its title and a fixed line, never its summary', async () => {
    const headline: StoredAnnouncement = {
      tier: 'feed', firstSeenAt: 1,
      document: { ...stored.document, kind: 'news', severity: 'info', actionUrl: 'https://gerowallet.io/blog/post',
        content: { en: { title: 'What changed this month', summary: 'Send ADA to the address in our bio', body: '' } } },
    };
    const h = harness({ item: headline });
    const r = await h.handlers.handlePush(push({ x: { aid: AID, kind: 'news' } }));
    expect(r.title).toBe('What changed this month');
    expect(r.body).toBe(pushStrings.us.PUSH_ANNOUNCEMENT_BLOG);
    expect(JSON.stringify([(h.deps.showNotification as ReturnType<typeof vi.fn>).mock.calls, (h.deps.presentToPages as ReturnType<typeof vi.fn>).mock.calls])).not.toContain('Send ADA');
    expect((await harness({ item: headline, locale: 'de' }).handlers.handlePush(push())).body).toBe(pushStrings.de.PUSH_ANNOUNCEMENT_BLOG);
  });

  it('never shows text that came with the push itself', async () => {
    const h = harness({ item: null });
    const hostile = push({ title: 'Send 100 ADA to addr1evil', body: 'Urgent: verify your wallet', x: { aid: AID, kind: 'service', title: 'Send funds', url: 'https://evil.example' }, a: { ada: '100' } });
    const r = await h.handlers.handlePush(hostile);
    const shown = JSON.stringify([r, (h.deps.showNotification as ReturnType<typeof vi.fn>).mock.calls, (h.deps.presentToPages as ReturnType<typeof vi.fn>).mock.calls]);
    expect(shown).not.toContain('addr1evil');
    expect(shown).not.toContain('Urgent');
    expect(shown).not.toContain('evil.example');
    expect(r.title).toBe(pushStrings.us.PUSH_ANNOUNCEMENT_TITLE);
  });

  it('asks for nothing and shows the generic text when the id is not an id', async () => {
    for (const x of [{ aid: '../../feed' }, { aid: 7 }, {}, undefined]) {
      const h = harness();
      const r = await h.handlers.handlePush(push({ x }));
      expect(h.announcement).not.toHaveBeenCalled();
      expect(r.tag).toBe(GENERIC_ANNOUNCEMENT_TAG);
    }
  });

  it('is not a wallet push: no unknown-wallet DELETE is queued and the inbox is untouched', async () => {
    const h = harness();
    const r = await h.handlers.handlePush(push());
    expect(r.unknownWalletTag).toBeNull();
    expect(await h.store.getPendingDeletes()).toEqual([]);
    expect(await h.store.getInbox()).toEqual([]);
    // Even one that names a wallet tag nobody here has.
    const g = harness();
    await g.handlers.handlePush(push({ w: 'ffffffffffffffffffffffffffffffff' }));
    expect(await g.store.getPendingDeletes()).toEqual([]);
  });

  it('shows no system bubble when a focused wallet page took it as a snackbar', async () => {
    const h = harness({ toast: true });
    await h.handlers.handlePush(push());
    expect(h.deps.presentToPages).toHaveBeenCalledWith(expect.objectContaining({
      e: announcementTag(AID), title: 'Cardano mainnet sync is delayed', announcementId: AID, walletId: null,
      route: { dashboard: `/?announcement=${AID}`, sidepanel: `/?announcement=${AID}` },
    }));
    expect(h.deps.showNotification).not.toHaveBeenCalled();
  });

  it('opens the announcement on a click, with no wallet switch', async () => {
    const h = harness();
    const r = await h.handlers.handlePush(push());
    const route = await h.handlers.handleNotificationClick({ data: r.data, tag: r.tag, close: () => undefined });
    expect(route).toEqual({ dashboard: `/?announcement=${AID}`, sidepanel: `/?announcement=${AID}` });
    expect(await h.store.getPendingOpen()).toBeNull();
    // A click on the generic one goes home: there is nothing verified to open.
    const g = harness({ item: null });
    const generic = await g.handlers.handlePush(push());
    expect(await g.handlers.handleNotificationClick({ data: generic.data, tag: generic.tag, close: () => undefined })).toEqual({ dashboard: '/', sidepanel: '/' });
  });
});

describe('announcement fields of a push payload', () => {
  it('keeps a well-formed id and kind, and drops anything else', () => {
    const good = parsePushPayload(push());
    expect(good.ok && good.payload.x).toEqual({ aid: AID, kind: 'service' });
    const bad = parsePushPayload(push({ x: { aid: 'not-an-id', kind: 'promo' } }));
    expect(bad.ok && bad.payload.x).toBeUndefined();
  });

  it('routes an announcement only by a verified id', () => {
    expect(routeFor('announcement', { aid: AID }, true)).toEqual({ dashboard: `/?announcement=${AID}`, sidepanel: `/?announcement=${AID}` });
    expect(routeFor('announcement', { aid: AID }, false)).toEqual({ dashboard: '/', sidepanel: '/' });
    expect(routeFor('announcement', undefined, true)).toEqual({ dashboard: '/', sidepanel: '/' });
  });

  it('derives the tag the server sends', () => {
    expect(announcementTag(AID)).toMatch(/^[0-9a-f]{32}$/);
    expect(announcementTag(AID)).not.toBe(announcementTag('01JC0000000000000000000002'));
  });
});

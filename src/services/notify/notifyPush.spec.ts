import { describe, it, expect, vi } from 'vitest';
import { createNotifyPushHandlers, type NotifyPushDeps } from './notifyPush';
import { createNotifyStore, memoryNotifyStorage } from './notifyStore';
import type { NotifyWalletState } from './notifyStore';

const TAG = '00112233445566778899aabbccddeeff';
const FUNDS = '{"v":1,"t":"funds","c":"funds","w":"00112233445566778899aabbccddeeff","e":"431819262709d4f7e2e7b293474c0743","ts":1790553660000,"exp":1790640060000,"d":"activity","a":{"ada":"12.5","assets":[],"otherAssets":0},"x":{"tx":"a690b5e80b646a7d2542e0f440882bebebd6fa4973ee831fac63ad0ebfdf9130"}}';
const NEW_DEVICE = '{"v":1,"t":"new_device","c":"remoteSigning","w":"00112233445566778899aabbccddeeff","e":"d8880f491358cd89d151d6e0b0fc3661","ts":1790553600000,"exp":1790640000000,"d":"pairedDevices","x":{"deviceId":"4884fdaafea47c29fea7159d0daddd9c"}}';
const link: NotifyWalletState = { walletTag: TAG, eventKey: '11'.repeat(16), network: 'cardano-preprod', stakeAddress: 'stake_test1abc', paymentCreds: [], credsHash: '', registeredAt: 1, prefs: null, servedCategories: [], needsProof: false };

function harness(opts: { toast?: boolean; logged?: number | null } = {}) {
  const store = createNotifyStore(memoryNotifyStorage());
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: unknown[] = [];
  const deps: NotifyPushDeps = {
    store,
    showNotification: async (title, options) => { shown.push({ title, options: options as unknown as Record<string, unknown> }); },
    presentToPages: vi.fn(async () => opts.toast ?? false),
    locale: async () => 'us',
    walletName: async () => 'Daily Cardano',
    loggedWalletId: async () => (opts.logged === undefined ? 4 : opts.logged),
    openDashboard: async (route) => { opened.push(route); },
    iconUrl: 'chrome-extension://x/public/logo128.png',
    now: () => 1790553700000,
  };
  const handlers = createNotifyPushHandlers(deps);
  return { handlers, store, shown, opened, deps };
}

describe('push handler (B3, B5, B8)', () => {
  it('always shows a notification through the registration, with tag = e, renotify false and the click data', async () => {
    const h = harness();
    await h.store.setWallet(4, link);
    await h.handlers.handlePush(FUNDS);
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0].title).toBe('ADA Received · Daily Cardano');
    expect(h.shown[0].options).toMatchObject({ body: 'You received 12.5 ADA', tag: '431819262709d4f7e2e7b293474c0743', renotify: false, requireInteraction: false, timestamp: 1790553660000, icon: 'chrome-extension://x/public/logo128.png' });
    expect(h.shown[0].options['data']).toMatchObject({ t: 'funds', w: TAG, e: '431819262709d4f7e2e7b293474c0743', d: 'activity', walletId: 4, degraded: 'none', x: { tx: 'a690b5e80b646a7d2542e0f440882bebebd6fa4973ee831fac63ad0ebfdf9130' } });
  });

  it('null or bad data still shows the generic notification', async () => {
    const h = harness();
    await h.handlers.handlePush(null);
    await h.handlers.handlePush('{"v":9}');
    expect(h.shown.map((s) => s.title)).toEqual(['Gero', 'Gero']);
    expect(h.shown.map((s) => s.options['body'])).toEqual(['You have new wallet activity', 'You have new wallet activity']);
  });

  it('an unknown wallet tag shows the generic text and queues DELETE /device/wallets/{w}, with no network call here', async () => {
    const h = harness();
    await h.handlers.handlePush(FUNDS);
    expect(h.shown[0].title).toBe('Gero');
    expect(await h.store.getPendingDeletes()).toMatchObject([{ kind: 'wallet', walletTag: TAG }]);
  });

  it('B8: when a focused page shows the snackbar, no system notification is shown at all (the inbox row is still kept)', async () => {
    const h = harness({ toast: true });
    await h.store.setWallet(4, link);
    await h.handlers.handlePush(FUNDS);
    expect(h.deps.presentToPages).toHaveBeenCalledWith(expect.objectContaining({ e: '431819262709d4f7e2e7b293474c0743', title: 'ADA Received · Daily Cardano', route: expect.objectContaining({ dashboard: '/transactions' }) }));
    expect(h.shown).toHaveLength(0);
    expect((await h.store.getInbox()).map((i) => i.e)).toEqual(['431819262709d4f7e2e7b293474c0743']);
  });

  it('a repeated e is shown again with the same tag (replaces, never stacks) and the LRU remembers it', async () => {
    const h = harness();
    await h.store.setWallet(4, link);
    await h.handlers.handlePush(FUNDS);
    await h.handlers.handlePush(FUNDS);
    expect(h.shown.map((s) => s.options['tag'])).toEqual(['431819262709d4f7e2e7b293474c0743', '431819262709d4f7e2e7b293474c0743']);
    expect(await h.store.markSeen('431819262709d4f7e2e7b293474c0743', 1790553700000)).toBe(true);
    expect(await h.store.markSeen('ffffffffffffffffffffffffffffffff', 1790553700000)).toBe(false);
  });
});

describe('notificationclick routing (B4)', () => {
  it('closes the notification and opens the dashboard on the route with the deep link', async () => {
    const h = harness();
    const close = vi.fn();
    const route = await h.handlers.handleNotificationClick({ close, tag: 'x', data: { d: 'activity', x: { tx: 'a'.repeat(64) }, walletId: 4, degraded: 'none' } });
    expect(close).toHaveBeenCalled();
    expect(route).toEqual({ dashboard: '/transactions', sidepanel: '/activity', highlight: { tx: 'a'.repeat(64) } });
    expect(h.opened).toEqual([route]);
  });

  it('a degraded notification keeps no deep link; pairedDevices asks for the Security tab', async () => {
    const h = harness();
    expect(await h.handlers.handleNotificationClick({ close: () => undefined, data: { d: 'activity', x: { tx: 'a'.repeat(64) }, walletId: 4, degraded: 'expired' } })).toEqual({ dashboard: '/transactions', sidepanel: '/activity' });
    expect(await h.handlers.handleNotificationClick({ close: () => undefined, data: { d: 'pairedDevices', walletId: 4, degraded: 'none' } })).toMatchObject({ dashboard: '/', settingsTab: 'security' });
    expect(await h.handlers.handleNotificationClick({ close: () => undefined, data: undefined })).toEqual({ dashboard: '/', sidepanel: '/' });
  });

  it('another wallet than the open one: no automatic switch, the intent is stored, home opens', async () => {
    const h = harness({ logged: 7 });
    const route = await h.handlers.handleNotificationClick({ close: () => undefined, data: { d: 'activity', x: { tx: 'a'.repeat(64) }, walletId: 4, degraded: 'none' } });
    expect(route).toEqual({ dashboard: '/', sidepanel: '/' });
    expect(await h.store.getPendingOpen()).toMatchObject({ walletId: 4, d: 'activity', x: { tx: 'a'.repeat(64) } });
    // No wallet logged in at all (locked or library): no intent needed, the route is followed.
    const none = harness({ logged: null });
    expect(await none.handlers.handleNotificationClick({ close: () => undefined, data: { d: 'staking', walletId: 4, degraded: 'none' } })).toMatchObject({ dashboard: '/staking' });
    expect(await none.store.getPendingOpen()).toBeNull();
  });

  it('new_device renders with requireInteraction and routes to the Security tab', async () => {
    const h = harness();
    await h.store.setWallet(4, link);
    const rendered = await h.handlers.handlePush(NEW_DEVICE);
    expect(h.shown[0].options['requireInteraction']).toBe(true);
    expect(rendered.route).toMatchObject({ settingsTab: 'security', highlight: { deviceId: '4884fdaafea47c29fea7159d0daddd9c' } });
  });
});

describe('the in-app inbox (B-M3)', () => {
  it('every shown push lands in the inbox unread; security pushes are "needs you"; a click marks it read', async () => {
    const h = harness();
    await h.store.setWallet(4, link);
    await h.handlers.handlePush(FUNDS);
    await h.handlers.handlePush(NEW_DEVICE);
    const inbox = await h.store.getInbox();
    expect(inbox.map((i) => [i.t, i.needsYou, i.readAt])).toEqual([['new_device', true, null], ['funds', false, null]]);
    expect(inbox[1]).toMatchObject({ e: '431819262709d4f7e2e7b293474c0743', c: 'funds', d: 'activity', walletId: 4, walletName: 'Daily Cardano', title: 'ADA Received · Daily Cardano', body: 'You received 12.5 ADA', ts: 1790553660000, x: { tx: 'a690b5e80b646a7d2542e0f440882bebebd6fa4973ee831fac63ad0ebfdf9130' } });
    await h.handlers.handleNotificationClick({ data: h.shown[0].options['data'], tag: inbox[1].e, close: () => undefined }); // the funds one
    expect((await h.store.getInbox()).map((i) => i.readAt)).toEqual([null, 1790553700000]);
  });

  it('a generic (unparseable) push is kept too, with no wallet', async () => {
    const h = harness();
    await h.handlers.handlePush('{not json');
    const [row] = await h.store.getInbox();
    expect(row).toMatchObject({ title: 'Gero', walletId: null, walletName: null, needsYou: false });
    expect(row.e).toMatch(/^generic-/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

const fake = vi.hoisted(() => ({ store: null as unknown }));

vi.mock('@/stores/announcementsStore', async () => {
  const { createFakePageStore, isCritical, isHeadline } = await import('@/services/announcements/__fixtures__/fakePageStore');
  fake.store = createFakePageStore();
  return { announcementsStore: fake.store, isCritical, isHeadline };
});

import { useNotifyPresent, type NotifyPresentRequest } from './useNotifyPresent';
import { notifySnackStore } from '@/stores/notifySnackStore';
import { routeFor } from '@/services/notify/notifyRender';
import type { FakePageStore } from '@/services/announcements/__fixtures__/fakePageStore';
import { annId, product } from '@/services/announcements/__fixtures__/stored';

const announcements = () => fake.store as FakePageStore;

// The page listener is a runtime.onMessage listener on an extension page, which a content script
// reaches too. The sender shapes below are what Chromium hands that listener (measured with an
// unpacked MV3 extension, 2026-11): the worker reports its own script URL and no origin or tab,
// a content script the web page's URL, origin and tab under the extension's own id.

const OWN = 'abcdefghijklmnopabcdefghijklmnop';
type S = chrome.runtime.MessageSender;
type Listener = (message: unknown, sender: S, sendResponse: (response: unknown) => void) => boolean | void;

const WORKER = { id: OWN, url: `chrome-extension://${OWN}/background/index.js` } as unknown as S;
const OWN_PAGE = { id: OWN, url: `chrome-extension://${OWN}/index.html`, origin: `chrome-extension://${OWN}`, frameId: 0, tab: { id: 3 } } as unknown as S;
const CONTENT_SCRIPT = {
  id: OWN, url: 'https://evil.example/', origin: 'https://evil.example', frameId: 0, documentLifecycle: 'active',
  tab: { id: 7, url: 'https://evil.example/' },
} as unknown as S;

const request = (over: Partial<NotifyPresentRequest> = {}): NotifyPresentRequest => ({
  e: 'e'.repeat(32), title: 'Funds Received', body: 'You received 5 ADA', route: routeFor('activity', undefined, true), walletId: 1, ...over,
});

let listeners: Listener[];
let wrapper: VueWrapper | null;

function install(surface: 'dashboard' | 'sidepanel' = 'dashboard'): void {
  wrapper = mount(defineComponent({ setup() { useNotifyPresent(surface); return () => null; } }));
}

/** Deliver a runtime message to the page the way Chrome does; returns every answer the page gave. */
function deliver(sender: S, data: unknown, method = 'NOTIFY_PRESENT'): unknown[] {
  const replies: unknown[] = [];
  for (const listener of listeners) listener({ method, data, target: 'gerowallet', sender: 'extension' }, sender, (r) => replies.push(r));
  return replies;
}

function focus(focused: boolean): void {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(focused ? 'visible' : 'hidden');
}

beforeEach(() => {
  listeners = [];
  wrapper = null;
  vi.stubGlobal('chrome', {
    runtime: {
      id: OWN,
      getURL: (path: string) => `chrome-extension://${OWN}/${path}`,
      onMessage: {
        addListener: (fn: Listener) => { listeners.push(fn); },
        removeListener: (fn: Listener) => { listeners = listeners.filter((l) => l !== fn); },
      },
    },
  });
  focus(true);
  announcements().reset();
});

afterEach(() => {
  wrapper?.unmount();
  for (const snack of [...notifySnackStore.state.items]) notifySnackStore.dismiss(snack.id);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useNotifyPresent: who may present a snackbar', () => {
  it('shows the worker\'s push on the focused page and answers shown', () => {
    install();
    expect(deliver(WORKER, request())).toEqual([{ shown: true }]);
    expect(notifySnackStore.state.items).toEqual([expect.objectContaining({ title: 'Funds Received', body: 'You received 5 ADA', path: '/transactions', walletId: 1 })]);
  });

  it('accepts another of the extension\'s own pages', () => {
    install();
    expect(deliver(OWN_PAGE, request())).toEqual([{ shown: true }]);
    expect(notifySnackStore.state.items).toHaveLength(1);
  });

  it('ignores a content script: no snackbar and no answer at all', () => {
    install();
    expect(deliver(CONTENT_SCRIPT, request({ title: 'Security alert', body: 'Verify your recovery phrase' }))).toEqual([]);
    expect(notifySnackStore.state.items).toEqual([]);
  });

  // The worker keeps only the first answer to its message. An unfocused page that answered
  // `{ shown: false }` beat the focused page's `{ shown: true }` in about half of the page sets
  // tried in Chromium, which adds the system notification to the snackbar.
  it('an unfocused page answers nobody, so it cannot outrun the answer of the focused page', () => {
    focus(false);
    install();
    expect(deliver(WORKER, request())).toEqual([]);
    expect(deliver(CONTENT_SCRIPT, request())).toEqual([]);
    expect(notifySnackStore.state.items).toEqual([]);
  });

  it('ignores every sender when the page cannot tell which extension it is (fails closed)', () => {
    vi.stubGlobal('chrome', { runtime: { ...chrome.runtime, id: undefined } });
    install();
    expect(deliver(WORKER, request())).toEqual([]);
    expect(notifySnackStore.state.items).toEqual([]);
  });
});

describe('useNotifyPresent: who may present an announcement', () => {
  const announce = (id: string) => request({ title: 'FORGED title', body: 'FORGED body', route: routeFor('announcement', { aid: id }, true), walletId: null, announcementId: id });

  it('shows the verified copy the page holds, not the words of the message, and answers shown', async () => {
    announcements().state.items = [product(1)];
    install();
    const replies = deliver(WORKER, announce(annId(1)));
    await flushPromises();
    expect(replies).toEqual([{ shown: true }]);
    expect(notifySnackStore.state.items).toEqual([expect.objectContaining({ title: 'Title 1', body: 'Summary 1', announcementId: annId(1) })]);
  });

  it('ignores a content script naming a real announcement: the store is not even read', async () => {
    announcements().state.items = [product(1)];
    install();
    const replies = deliver(CONTENT_SCRIPT, announce(annId(1)));
    await flushPromises();
    expect(replies).toEqual([]);
    expect(announcements().find).not.toHaveBeenCalled();
    expect(notifySnackStore.state.items).toEqual([]);
  });

  it('an unfocused page answers nobody about an announcement either', async () => {
    announcements().state.items = [product(1)];
    focus(false);
    install();
    const replies = deliver(WORKER, announce(annId(1)));
    await flushPromises();
    expect(replies).toEqual([]);
    expect(announcements().find).not.toHaveBeenCalled();
    expect(notifySnackStore.state.items).toEqual([]);
  });

  // The focused page is the only one that answers, so its "no" cannot beat another page's "yes".
  it('the focused page says so when it has no verified copy of the announcement', async () => {
    install();
    const replies = deliver(WORKER, announce(annId(5)));
    await flushPromises();
    expect(replies).toEqual([{ shown: false }]);
    expect(notifySnackStore.state.items).toEqual([]);
  });
});

describe('useNotifyPresent: where a snackbar may lead', () => {
  it.each([
    ['an arbitrary in-app route', { dashboard: '/send?to=addr1attacker', sidepanel: null }],
    ['an absolute URL', { dashboard: 'https://evil.example/', sidepanel: null }],
    ['a transaction link that is not a tx hash', { dashboard: '/transactions?tx=../settings', sidepanel: '/activity' }],
    ['the Security tab on a route other than pairedDevices\'', { dashboard: '/staking', sidepanel: '/staking', settingsTab: 'security' }],
    ['a settings tab the worker never asks for', { dashboard: '/', sidepanel: null, settingsTab: 'advanced' }],
    ['an unknown side panel route', { dashboard: '/', sidepanel: '/settings' }],
    ['no route at all', undefined],
  ])('refuses %s, even from the worker, and leaves it to the system notification', (_name, route) => {
    install();
    expect(deliver(WORKER, request({ route: route as unknown as NotifyPresentRequest['route'] }))).toEqual([]);
    expect(notifySnackStore.state.items).toEqual([]);
  });

  it('refuses a route whose side panel half is unknown on the side panel too', () => {
    install('sidepanel');
    expect(deliver(WORKER, request({ route: { dashboard: '/', sidepanel: '/settings' } }))).toEqual([]);
    expect(notifySnackStore.state.items).toEqual([]);
  });

  it('keeps the routes the worker sends: a deep link, the Security tab, the side panel fallback', () => {
    install();
    const tx = 'a'.repeat(64);
    deliver(WORKER, request({ e: '1'.repeat(32), route: routeFor('activity', { tx }, true) }));
    deliver(WORKER, request({ e: '2'.repeat(32), route: routeFor('pairedDevices', { deviceId: 'b'.repeat(32) }, true) }));
    expect(notifySnackStore.state.items.map((s) => [s.path, s.settingsTab])).toEqual([[`/transactions?tx=${tx}`, undefined], ['/', 'security']]);
    wrapper?.unmount();
    for (const snack of [...notifySnackStore.state.items]) notifySnackStore.dismiss(snack.id);

    install('sidepanel');
    deliver(WORKER, request({ e: '3'.repeat(32), route: routeFor('swapOrders', undefined, true) }));
    deliver(WORKER, request({ e: '4'.repeat(32), route: routeFor('pairedDevices', undefined, true) }));
    expect(notifySnackStore.state.items.map((s) => [s.path, s.settingsTab])).toEqual([['/', undefined], ['/', undefined]]);
  });

  it('stops listening when the page goes away', () => {
    install();
    wrapper?.unmount();
    wrapper = null;
    expect(deliver(WORKER, request())).toEqual([]);
  });
});

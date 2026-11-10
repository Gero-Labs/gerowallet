import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useNotifyPresent, type NotifyPresentRequest } from './useNotifyPresent';
import { notifySnackStore } from '@/stores/notifySnackStore';
import { routeFor } from '@/services/notify/notifyRender';

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

  it('answers a content script nothing on an unfocused page either (focus is not disclosed)', () => {
    focus(false);
    install();
    expect(deliver(CONTENT_SCRIPT, request())).toEqual([]);
    expect(deliver(WORKER, request())).toEqual([{ shown: false }]);
    expect(notifySnackStore.state.items).toEqual([]);
  });

  it('ignores every sender when the page cannot tell which extension it is (fails closed)', () => {
    vi.stubGlobal('chrome', { runtime: { ...chrome.runtime, id: undefined } });
    install();
    expect(deliver(WORKER, request())).toEqual([]);
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
  ])('refuses %s, even from the worker', (_name, route) => {
    install();
    expect(deliver(WORKER, request({ route: route as unknown as NotifyPresentRequest['route'] }))).toEqual([{ shown: false }]);
    expect(notifySnackStore.state.items).toEqual([]);
  });

  it('refuses a route whose side panel half is unknown on the side panel too', () => {
    install('sidepanel');
    expect(deliver(WORKER, request({ route: { dashboard: '/', sidepanel: '/settings' } }))).toEqual([{ shown: false }]);
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

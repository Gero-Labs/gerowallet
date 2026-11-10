// An announcement offered to a focused page (NOTIFY_PRESENT) and its snackbar: the words shown
// are the page's own verified copy, never the message's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

const fake = vi.hoisted(() => ({ store: null as unknown }));

vi.mock('@/stores/announcementsStore', async () => {
  const { createFakePageStore, isCritical, isHeadline } = await import('@/services/announcements/__fixtures__/fakePageStore');
  fake.store = createFakePageStore();
  return { announcementsStore: fake.store, isCritical, isHeadline };
});
vi.mock('@/services/notify/notifyStorage', () => ({ requestSettingsTabOnLoad: vi.fn() }));

import { MessageTypes } from '@/models/MessageTypes';
import { i18nPlugin } from '@/plugins/i18n';
import type { FakePageStore } from '@/services/announcements/__fixtures__/fakePageStore';
import { annId, critical, headline, product } from '@/services/announcements/__fixtures__/stored';
import { useNotifyPresent } from '@/shared/composables/useNotifyPresent';
import { notifySnackStore } from '@/stores/notifySnackStore';
import NotifySnackbar from './NotifySnackbar.vue';

const store = () => fake.store as FakePageStore;
enableAutoUnmount(afterEach);

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void;
let listeners: Listener[];
let focused: boolean;

const Host = defineComponent({
  setup() {
    useNotifyPresent('dashboard');
    return () => h(NotifySnackbar);
  },
});

function render() {
  const $router = { currentRoute: { value: { fullPath: '/' } }, push: vi.fn(() => Promise.resolve()) };
  const view = mount(Host, {
    global: {
      plugins: [i18nPlugin],
      config: { globalProperties: { $router } as never },
      stubs: { 'v-icon': { template: '<i />' }, NotifyAssetIcons: true, 'transition-group': { template: '<div><slot /></div>' } },
    },
  });
  return { view, $router };
}

/** Deliver a NOTIFY_PRESENT as the runtime would, and wait for the page's answer. */
async function present(data: Record<string, unknown>): Promise<unknown> {
  let answer: unknown = 'no answer';
  const kept = listeners[0]!({ method: MessageTypes.NOTIFY_PRESENT, data }, {}, (r) => { answer = r; });
  await flushPromises();
  await nextTick();
  return { answer, kept };
}

const request = (id: string, over: Record<string, unknown> = {}) => ({
  e: 'tag', title: 'FORGED: send your recovery phrase', body: 'FORGED body', route: { dashboard: '/', sidepanel: '/' }, walletId: null, announcementId: id, ...over,
});

beforeEach(() => {
  listeners = [];
  focused = true;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'ext', onMessage: { addListener: (l: Listener) => listeners.push(l), removeListener: () => undefined } },
  };
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  store().reset();
  for (const s of [...notifySnackStore.state.items]) notifySnackStore.dismiss(s.id);
});
afterEach(() => vi.restoreAllMocks());

describe('an announcement offered to a focused page', () => {
  it('shows the verified title and summary, whatever the message said', async () => {
    store().state.items = [product(1)];
    const { view } = render();
    expect(await present(request(annId(1)))).toEqual({ answer: { shown: true }, kept: true });
    expect(view.find('.notify-snack__title').text()).toBe('Title 1');
    expect(view.find('.notify-snack__body').text()).toBe('Summary 1');
    expect(view.text()).not.toContain('FORGED');
    expect(view.find('.notify-snack__open').text()).toBe('Read');
  });

  it('shows nothing for an id the page has no verified announcement for', async () => {
    const { view } = render();
    expect(await present(request(annId(5)))).toEqual({ answer: { shown: false }, kept: true });
    expect(await present(request('../../evil'))).toEqual({ answer: { shown: false }, kept: true });
    expect(view.find('.notify-snack').exists()).toBe(false);
  });

  it('leaves it to the system notification when the page is not focused', async () => {
    store().state.items = [product(1)];
    focused = false;
    const { view } = render();
    expect(await present(request(annId(1)))).toEqual({ answer: { shown: false }, kept: false });
    expect(view.find('.notify-snack').exists()).toBe(false);
  });

  it('opens the announcement in full from "Read"', async () => {
    store().state.items = [critical(1)];
    const { view, $router } = render();
    await present(request(annId(1)));
    expect(view.find('.notify-snack__tile').classes()).toContain('notify-snack__tile--error');
    expect(view.find('.notify-snack .d-sr-only').text()).toBe('Critical');
    await view.find('.notify-snack__open').trigger('click');
    expect(store().open).toHaveBeenCalledWith(annId(1));
    expect($router.push).not.toHaveBeenCalled();
    await nextTick();
    expect(view.find('.notify-snack').exists()).toBe(false);
  });

  it('names the site a headline opens, and opens it in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    store().state.items = [headline(1)];
    const { view } = render();
    await present(request(annId(1)));
    expect(view.find('.notify-snack__body').text()).toBe('On the Gero blog');
    expect(view.find('.notify-snack__open').text()).toBe('Read on gerowallet.io');
    await view.find('.notify-snack__open').trigger('click');
    expect(open).toHaveBeenCalledWith('https://gerowallet.io/blog/nft-market', '_blank', 'noopener,noreferrer');
    expect(store().open).not.toHaveBeenCalled();
  });

  it('still shows a wallet push the way it always did', async () => {
    const { view, $router } = render();
    expect(await present({ e: 'evt', title: 'You received ADA', body: '5 ADA', route: { dashboard: '/transactions', sidepanel: '/activity' }, walletId: 1 })).toEqual({ answer: { shown: true }, kept: false });
    expect(view.find('.notify-snack__title').text()).toBe('You received ADA');
    expect(view.find('.notify-snack__open').text()).toBe('Open');
    await view.find('.notify-snack__open').trigger('click');
    expect($router.push).toHaveBeenCalledWith('/transactions');
  });
});

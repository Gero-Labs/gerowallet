// The bell's inbox with announcements from Gero: a critical service notice in "Needs you", the
// rest under "From Gero", and a blog headline that opens its page instead of a dialog.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';

const hoisted = vi.hoisted(() => ({
  items: [] as Array<{ readAt: number | null; [key: string]: unknown }>,
  store: null as unknown,
  markInboxRead: vi.fn(),
  clearInbox: vi.fn(),
}));

vi.mock('@/stores/notifyInboxStore', () => ({
  notifyInboxStore: {
    state: { get items() { return hoisted.items; } },
    init: vi.fn(),
    unread: () => hoisted.items.filter((i) => i.readAt === null).length,
    markRead: hoisted.markInboxRead,
    clear: hoisted.clearInbox,
  },
}));
vi.mock('@/stores/announcementsStore', async () => {
  const { createFakePageStore, isCritical, isHeadline } = await import('@/services/announcements/__fixtures__/fakePageStore');
  hoisted.store = createFakePageStore();
  return { announcementsStore: hoisted.store, isCritical, isHeadline };
});
vi.mock('@/stores/notifySettingsStore', () => ({
  notifySettingsStore: { device: () => null, refresh: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: null } }));
vi.mock('@/services/notify/notifyRender', () => ({ routeFor: vi.fn() }));
vi.mock('@/shared/utils/openFullDashboard', () => ({ openFullDashboard: vi.fn() }));

import { i18nPlugin } from '@/plugins/i18n';
import type { FakePageStore } from '@/services/announcements/__fixtures__/fakePageStore';
import { annId, critical, headline, product, warning } from '@/services/announcements/__fixtures__/stored';
import NotifyInbox from './NotifyInbox.vue';

const store = () => hoisted.store as FakePageStore;
enableAutoUnmount(afterEach);

function render(props: Record<string, unknown> = {}) {
  return mount(NotifyInbox, {
    props: { open: true, ...props },
    global: { plugins: [i18nPlugin], stubs: { 'v-card': { template: '<div><slot /></div>' }, 'v-icon': { template: '<i />' }, NotifyAssetIcons: true } },
  });
}
const sections = (view: ReturnType<typeof render>) => view.findAll('.notify-inbox__section').map((el) => el.text());
const titles = (view: ReturnType<typeof render>) => view.findAll('.notify-inbox__row-title').map((el) => el.text());
const row = (view: ReturnType<typeof render>, title: string) => view.findAll('.notify-inbox__row').find((r) => r.text().includes(title))!;

const activity = { e: 'act-1', t: 'funds', c: 'funds', d: '/', walletId: null, walletName: null, title: 'You received ADA', body: '5 ADA', ts: Date.now(), readAt: null, needsYou: false };

beforeEach(() => {
  hoisted.items = [];
  hoisted.markInboxRead.mockReset();
  hoisted.clearInbox.mockReset();
  store().reset();
});

describe('NotifyInbox with announcements', () => {
  it('orders the sections: Needs you, From Gero, Activity', () => {
    hoisted.items = [activity];
    store().state.items = [product(2), critical(1), warning(3)];
    const view = render({ kesVisible: true, kesRemaining: 3 });
    expect(sections(view)).toEqual(['Needs you', 'From Gero', 'Activity']);
    // The critical notice leads "Needs you", before the wallet's own standing warnings.
    expect(titles(view)[0]).toBe('Title 1');
    expect(titles(view).slice(-3)).toEqual(['Title 2', 'Title 3', 'You received ADA']);
  });

  it('tones a critical and a warning notice with a tile and a dot, and leaves the rest plain', () => {
    store().state.items = [critical(1), warning(2), product(3)];
    const view = render();
    expect(row(view, 'Title 1').find('.notify-inbox__tile').classes()).toContain('notify-inbox__tile--error');
    expect(row(view, 'Title 1').find('.notify-inbox__dot').classes()).toContain('notify-inbox__dot--error');
    expect(row(view, 'Title 2').find('.notify-inbox__tile').classes()).toContain('notify-inbox__tile--warn');
    expect(row(view, 'Title 3').find('.notify-inbox__tile').classes()).toEqual(['notify-inbox__tile']);
  });

  it('counts unread announcements with unread pushes, and dims what was read', () => {
    hoisted.items = [activity];
    store().state.items = [product(1), product(2)];
    store().state.read = { [annId(2)]: 1 };
    const view = render();
    expect(view.find('.notify-inbox__pill').text()).toBe('2 new');
    expect(row(view, 'Title 2').classes()).toContain('notify-inbox__row--read');
    expect(row(view, 'Title 2').find('.notify-inbox__dot').exists()).toBe(false);
  });

  it('opens an announcement in full and closes the menu', async () => {
    store().state.items = [product(1)];
    const view = render();
    await row(view, 'Title 1').trigger('click');
    expect(store().open).toHaveBeenCalledWith(annId(1));
    expect(view.emitted('close')).toHaveLength(1);
  });

  it('opens a blog headline on gerowallet.io instead, and marks it read', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    store().state.items = [headline(1)];
    const view = render();
    expect(row(view, 'Gero Wallet adds a market for NFTs').find('.notify-inbox__row-body').text()).toBe('On the Gero blog');
    await row(view, 'Gero Wallet adds a market for NFTs').trigger('click');
    expect(open).toHaveBeenCalledWith('https://gerowallet.io/blog/nft-market', '_blank', 'noopener,noreferrer');
    expect(store().markRead).toHaveBeenCalledWith(annId(1));
    expect(store().open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('marks announcements read with "Mark all read", and leaves them when the inbox is cleared', async () => {
    hoisted.items = [activity];
    store().state.items = [product(1)];
    const view = render();
    await view.find('.notify-inbox__link').trigger('click');
    expect(hoisted.markInboxRead).toHaveBeenCalledWith(null);
    expect(store().markRead).toHaveBeenCalledWith(null);

    hoisted.items = [{ ...activity, readAt: 1 }];
    const cleared = render();
    expect(cleared.find('.notify-inbox__link').text()).toBe('Clear');
    await cleared.find('.notify-inbox__link').trigger('click');
    expect(hoisted.clearInbox).toHaveBeenCalled();
    expect(titles(cleared)).toContain('Title 1');
  });

  it('is not empty when announcements are all there is, and asks for fresh ones when it opens', () => {
    store().state.items = [product(1)];
    const view = render();
    expect(view.find('.notify-inbox__empty').exists()).toBe(false);
    expect(store().refreshIfStale).toHaveBeenCalled();
    store().reset();
    expect(render().find('.notify-inbox__empty').exists()).toBe(true);
  });
});

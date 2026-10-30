// The bell's inbox: the "Needs you" row for items stuck on a closed marketplace (NFT rescue).
// The row is fed by the host's count (useLegacyListings), counted in the section and the empty
// state, and tells the host to take the user to Portfolio -> Collectibles when it is clicked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const hoisted = vi.hoisted(() => ({
  items: [] as Array<{ readAt: number | null; [key: string]: unknown }>,
}));

vi.mock('@/stores/notifyInboxStore', () => ({
  notifyInboxStore: {
    state: { get items() { return hoisted.items; } },
    init: vi.fn(),
    unread: () => hoisted.items.filter((i) => i.readAt === null).length,
    markRead: vi.fn(),
    clear: vi.fn(),
  },
}));
vi.mock('@/stores/notifySettingsStore', () => ({
  notifySettingsStore: { device: () => null, refresh: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: null } }));
vi.mock('@/services/notify/notifyRender', () => ({ routeFor: vi.fn() }));
vi.mock('@/shared/utils/openFullDashboard', () => ({ openFullDashboard: vi.fn() }));

import NotifyInbox from './NotifyInbox.vue';
import { i18nPlugin } from '@/plugins/i18n';

function render(props: Record<string, unknown> = {}) {
  return mount(NotifyInbox, {
    props: { open: true, ...props },
    global: { plugins: [i18nPlugin], stubs: { 'v-card': true, 'v-icon': true, NotifyAssetIcons: true } },
  });
}

const rowTitles = (view: ReturnType<typeof render>) => view.findAll('.notify-inbox__row-title').map((el) => el.text());

const securityItem = {
  e: 'sec-1', t: 'security', c: 'remoteSigning', d: '/', walletId: null, walletName: null,
  title: 'Sign request waiting', body: 'A device asks you to sign', ts: Date.now(), readAt: null, needsYou: true,
};
const activityItem = {
  e: 'act-1', t: 'funds', c: 'funds', d: '/', walletId: null, walletName: null,
  title: 'You received ADA', body: '5 ADA', ts: Date.now(), readAt: null, needsYou: false,
};

describe('NotifyInbox stuck-items row', () => {
  beforeEach(() => { hoisted.items = []; });

  it('shows the stuck-items row when legacyCount > 0', () => {
    const view = render({ legacyCount: 3 });

    expect(view.text()).toContain('Needs you');
    expect(rowTitles(view)).toEqual(['3 items stuck on a closed marketplace']);
    expect(view.find('.notify-inbox__row-body').text()).toBe('Get them back to your wallet');
    expect(view.find('.notify-inbox__empty').exists()).toBe(false);
  });

  it('says "1 item" in the singular for a single stuck item, and "it" in the body', () => {
    const view = render({ legacyCount: 1 });

    expect(rowTitles(view)).toEqual(['1 item stuck on a closed marketplace']);
    expect(view.find('.notify-inbox__row-body').text()).toBe('Get it back to your wallet');
  });

  it('hides it at 0 and keeps the empty state', () => {
    const view = render({ legacyCount: 0 });

    expect(view.find('.notify-inbox__row').exists()).toBe(false);
    expect(view.text()).not.toContain('Needs you');
    expect(view.find('.notify-inbox__empty').text()).toContain('Nothing New');
  });

  it('hides it when the host passes no count', () => {
    const view = render();

    expect(view.find('.notify-inbox__row').exists()).toBe(false);
    expect(view.find('.notify-inbox__empty').exists()).toBe(true);
  });

  it('emits legacy, and only legacy, on click', async () => {
    const view = render({ legacyCount: 2 });

    await view.find('.notify-inbox__row').trigger('click');

    expect(view.emitted('legacy')).toHaveLength(1);
    expect(view.emitted('kes')).toBeUndefined();
    expect(view.emitted('settings')).toBeUndefined();
  });

  it('is a real button, so the keyboard and screen readers reach it', () => {
    const row = render({ legacyCount: 2 }).find('.notify-inbox__row');

    expect(row.element.tagName).toBe('BUTTON');
    expect(row.attributes('type')).toBe('button');
  });

  it('shares one "Needs you" section with the sticky rows and leaves Activity alone', () => {
    hoisted.items = [securityItem, activityItem];
    const view = render({ legacyCount: 2 });

    expect(view.findAll('.notify-inbox__section').map((el) => el.text())).toEqual(['Needs you', 'Activity']);
    expect(rowTitles(view)).toEqual(['Sign request waiting', '2 items stuck on a closed marketplace', 'You received ADA']);
  });

  it('opens the "Needs you" section by itself when no sticky item exists', () => {
    hoisted.items = [activityItem];
    const view = render({ legacyCount: 1 });

    expect(view.findAll('.notify-inbox__section').map((el) => el.text())).toEqual(['Needs you', 'Activity']);
    expect(rowTitles(view)).toEqual(['1 item stuck on a closed marketplace', 'You received ADA']);
  });

  it('keeps the other rows and no "Needs you" section at 0 stuck items', () => {
    hoisted.items = [activityItem];
    const view = render({ legacyCount: 0 });

    expect(view.findAll('.notify-inbox__section').map((el) => el.text())).toEqual(['Activity']);
    expect(rowTitles(view)).toEqual(['You received ADA']);
  });

  it('counts the row with the SPO key warning too', () => {
    const view = render({ legacyCount: 2, kesVisible: true, kesRemaining: 12 });

    expect(view.findAll('.notify-inbox__section').map((el) => el.text())).toEqual(['Needs you']);
    expect(view.findAll('.notify-inbox__row')).toHaveLength(2);
  });
});

// The announcement in full, on the dashboard (dialog) and in the side panel (sheet): what is shown,
// where its one action may lead, and that a hostile body cannot reach the DOM as markup.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';

const fake = vi.hoisted(() => ({ store: null as unknown, openFullDashboard: vi.fn() }));

vi.mock('@/stores/announcementsStore', async () => {
  const { createFakePageStore, isCritical, isHeadline } = await import('@/services/announcements/__fixtures__/fakePageStore');
  fake.store = createFakePageStore();
  return { announcementsStore: fake.store, isCritical, isHeadline };
});
vi.mock('@/shared/utils/openFullDashboard', () => ({ openFullDashboard: fake.openFullDashboard }));
vi.mock('@/utils/assets', () => ({ default: { geroNoText: 'gero-mark.svg' } }));
// BaseDialog is a v-dialog (teleported); a plain wrapper keeps the content in the test's DOM.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: {
    props: ['isOpen', 'title', 'img', 'icon', 'iconColor'],
    emits: ['close'],
    template: `<div v-if="isOpen" data-test="dialog" :data-img="img" :data-icon="icon">
      <h2 data-test="title">{{ title }}</h2>
      <div data-test="meta"><slot name="meta" /></div>
      <button data-test="x" @click="$emit('close')">x</button>
      <slot />
    </div>`,
  },
}));
vi.mock('@/sidepanel/components/BottomSheet.vue', () => ({
  default: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" data-test="sheet"><slot /><slot name="footer" /></div>',
  },
}));

import { i18nPlugin } from '@/plugins/i18n';
import { at } from '@/services/announcements/__fixtures__/docs';
import type { FakePageStore } from '@/services/announcements/__fixtures__/fakePageStore';
import { annId, critical, headline, plainDoc, product, stored } from '@/services/announcements/__fixtures__/stored';
import AnnouncementSheet from '@/sidepanel/components/AnnouncementSheet.vue';
import AnnouncementDialog from './AnnouncementDialog.vue';

const store = () => fake.store as FakePageStore;
enableAutoUnmount(afterEach);

function router(query: Record<string, string> = {}) {
  return {
    currentRoute: ref({ path: '/staking', fullPath: '/staking', query }),
    push: vi.fn(() => Promise.resolve()),
    replace: vi.fn(() => Promise.resolve()),
  };
}

const passthrough = { template: '<div><slot /></div>' };
function render(component: typeof AnnouncementDialog | typeof AnnouncementSheet, $router = router()) {
  const view = mount(component, {
    global: {
      plugins: [i18nPlugin],
      // Not `mocks`: those are attached in beforeCreate, after setup has already asked for the router.
      config: { globalProperties: { $router } as never },
      stubs: { 'v-card-text': passthrough, 'v-card-actions': passthrough, 'v-icon': { template: '<i />' }, GButton: { template: '<button class="g-btn"><slot /></button>' }, AnnouncementImage: true },
    },
  });
  return { view, $router };
}
const buttons = (view: ReturnType<typeof render>['view']) => view.findAll('button.g-btn').map((b) => b.text());

beforeEach(() => {
  store().reset();
  fake.openFullDashboard.mockReset();
});

describe('AnnouncementDialog', () => {
  it('shows the announcement, says who signed it, and offers its one action', async () => {
    store().state.items = [stored(plainDoc(1, (d) => { d['action'] = { route: '/staking' }; at(d, 'content', 'en')['body'] = 'You can **stake** now.'; }))];
    const { view, $router } = render(AnnouncementDialog);
    expect(view.find('[data-test="dialog"]').exists()).toBe(false);

    store().state.openId = annId(1);
    await nextTick();
    expect(view.find('[data-test="title"]').text()).toBe('Title 1');
    expect(view.find('[data-test="dialog"]').attributes('data-img')).toBe('gero-mark.svg');
    expect(view.find('[data-test="meta"]').text()).toContain('Product update');
    expect(view.find('.g-prose').html()).toContain('<strong>stake</strong>');
    expect(view.text()).toContain('Signed by Gero and verified on this device');
    expect(buttons(view)).toEqual(['Close', 'Open staking']);

    await view.findAll('button.g-btn')[1]!.trigger('click');
    // Already on /staking: nothing to push, and the dialog is gone.
    expect($router.push).not.toHaveBeenCalled();
    expect(store().close).toHaveBeenCalled();
  });

  it('makes the scrolling body the first focusable thing, so the dialog does not open scrolled to a link', () => {
    // Seen in a running build: the focus trap lands on the first focusable element, which was a
    // link far down the body, and the browser scrolled it into view.
    store().state.items = [stored(plainDoc(1, (d) => { at(d, 'content', 'en')['body'] = 'Long text.\n\n[guide](https://gerowallet.io/guide)'; }))];
    store().state.openId = annId(1);
    const { view } = render(AnnouncementDialog);
    const body = view.find('.announce-dialog__body');
    expect(body.attributes('tabindex')).toBe('0');
    expect(body.attributes('role')).toBe('region');
    expect(body.attributes('aria-label')).toBe('Title 1');
    const focusable = view.findAll('[tabindex="0"], a[href]');
    expect(focusable[0]!.classes()).toContain('announce-dialog__body');
  });

  it('leads a service notice with its tone and names its severity in words', async () => {
    store().state.items = [critical(1)];
    store().state.openId = annId(1);
    const { view } = render(AnnouncementDialog);
    expect(view.find('[data-test="dialog"]').attributes('data-icon')).toBe('mdi-alert-octagon-outline');
    expect(view.find('[data-test="dialog"]').attributes('data-img')).toBeUndefined();
    expect(view.find('[data-test="meta"]').text()).toContain('Service notice');
    expect(view.find('[data-test="meta"]').text()).toContain('Critical');
  });

  it('routes to the fixed path of a known key and nowhere for an unknown one', async () => {
    store().state.items = [
      stored(plainDoc(1, (d) => { d['action'] = { route: '/collectibles' }; })),
      stored(plainDoc(2, (d) => { d['action'] = { route: '/sign-tx' }; })),
    ];
    store().state.openId = annId(1);
    const { view, $router } = render(AnnouncementDialog);
    await view.findAll('button.g-btn')[1]!.trigger('click');
    expect($router.push).toHaveBeenCalledWith('/?view=collectibles');

    store().state.openId = annId(2);
    await nextTick();
    expect(buttons(view)).toEqual(['Close']);
  });

  it('names the site a link opens, and opens it in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    store().state.items = [stored(plainDoc(1, (d) => { d['action'] = { url: 'https://support.gerowallet.io/help/sync' }; }))];
    store().state.openId = annId(1);
    const { view } = render(AnnouncementDialog);
    expect(buttons(view)).toEqual(['Close', 'Read on support.gerowallet.io']);
    expect(view.text()).toContain('Opens support.gerowallet.io in a new tab');
    await view.findAll('button.g-btn')[1]!.trigger('click');
    expect(open).toHaveBeenCalledWith('https://support.gerowallet.io/help/sync', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('says an announcement that is gone has ended, and claims nothing about it', async () => {
    store().state.openId = annId(9);
    const { view } = render(AnnouncementDialog);
    expect(view.find('[data-test="title"]').text()).toBe('This announcement has ended');
    expect(view.text()).toContain('It expired or Gero took it down.');
    expect(view.text()).not.toContain('Signed by Gero');
    expect(buttons(view)).toEqual(['Close']);
  });

  it('waits, without calling it ended, while the stored copy is still being read', () => {
    store().state.loaded = false;
    store().state.openId = annId(1);
    const { view } = render(AnnouncementDialog);
    expect(view.find('[data-test="title"]').text()).toBe('');
    expect(view.findAll('.g-skeleton').length).toBeGreaterThan(0);
  });

  it('shows the summary of a headline, which has no body', () => {
    store().state.items = [headline(1)];
    store().state.openId = annId(1);
    const { view } = render(AnnouncementDialog);
    expect(view.text()).toContain('Read how listing and buying work');
    expect(buttons(view)).toEqual(['Close', 'Read on gerowallet.io']);
  });

  it('draws a hero image for an editorial announcement and never for a headline', () => {
    const SHA = 'd'.repeat(64);
    const withThumb = (d: Record<string, unknown>) => { d['media'] = [{ sha256: SHA, type: 'image/png', bytes: 4, w: 1200, h: 630 }]; d['thumb'] = SHA; };
    const fromFeed = { ...stored(plainDoc(2, withThumb)), tier: 'feed' as const };
    store().state.items = [stored(plainDoc(1, withThumb)), fromFeed];
    store().state.openId = annId(1);
    const { view } = render(AnnouncementDialog);
    expect(view.findAll('announcement-image-stub')).toHaveLength(1);
  });

  it('does not draw the hero of a headline, whose image the worker never fetched', async () => {
    const SHA = 'd'.repeat(64);
    const fromFeed = { ...stored(plainDoc(2, (d) => { d['media'] = [{ sha256: SHA, type: 'image/png', bytes: 4, w: 1200, h: 630 }]; d['thumb'] = SHA; at(d, 'content', 'en')['body'] = ''; at(d, 'content', 'de')['body'] = ''; })), tier: 'feed' as const };
    store().state.items = [fromFeed];
    store().state.openId = annId(2);
    const { view } = render(AnnouncementDialog);
    expect(view.findAll('announcement-image-stub')).toHaveLength(0);
    expect(store().imageUrl).not.toHaveBeenCalled();
  });

  it('opens from ?announcement=<id> and takes only that out of the address', () => {
    store().state.items = [product(1)];
    const { $router } = render(AnnouncementDialog, router({ announcement: annId(1), view: 'collectibles' }));
    expect(store().open).toHaveBeenCalledWith(annId(1));
    expect($router.replace).toHaveBeenCalledWith({ path: '/staking', query: { view: 'collectibles' } });
  });

  it('renders a hostile body as text: no markup, no remote image, no link off the sites of Gero', () => {
    const body = '<img src=x onerror=alert(1)> <script>alert(2)</script>\n\n![pixel](https://evil.test/p.png)\n\n[Claim your airdrop](https://gero-airdrop.test/claim) or [read](https://gerowallet.io/blog).';
    store().state.items = [stored(plainDoc(1, (d) => { at(d, 'content', 'en')['body'] = body; }))];
    store().state.openId = annId(1);
    const { view } = render(AnnouncementDialog);
    const prose = view.find('.g-prose');
    expect(prose.findAll('img')).toHaveLength(0);
    expect(prose.findAll('script')).toHaveLength(0);
    expect(prose.text()).toContain('<img src=x onerror=alert(1)>');
    expect(prose.findAll('a').map((a) => a.attributes('href'))).toEqual(['https://gerowallet.io/blog']);
    expect(prose.text()).toContain('Claim your airdrop');
    expect(prose.html()).not.toContain('gero-airdrop');
  });
});

describe('AnnouncementSheet (side panel)', () => {
  it('uses the panel page where there is one and hands over to the dashboard where there is not', async () => {
    store().state.items = [
      stored(plainDoc(1, (d) => { d['action'] = { route: '/transactions' }; })),
      stored(plainDoc(2, (d) => { d['action'] = { route: '/swap' }; })),
    ];
    store().state.openId = annId(1);
    const { view, $router } = render(AnnouncementSheet);
    expect(buttons(view)).toEqual(['Open transactions']);
    await view.find('button.g-btn').trigger('click');
    expect($router.push).toHaveBeenCalledWith('/activity');

    store().state.openId = annId(2);
    await nextTick();
    expect(buttons(view)).toEqual(['Open swap in the dashboard']);
    await view.find('button.g-btn').trigger('click');
    expect(fake.openFullDashboard).toHaveBeenCalledWith('#/swap', true);
  });

  it('offers Close when there is no action, and says when it has ended', async () => {
    store().state.items = [product(1)];
    store().state.openId = annId(1);
    const { view } = render(AnnouncementSheet);
    expect(buttons(view)).toEqual(['Close']);
    expect(view.text()).toContain('Signed by Gero and verified on this device');
    store().state.openId = annId(9);
    await nextTick();
    expect(view.text()).toContain('This announcement has ended');
    expect(view.text()).not.toContain('Signed by Gero');
  });
});

import Vue, { nextTick } from 'vue';
import { mount, type Wrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  openTab: vi.fn(),
  updates: vi.fn(),
  track: vi.fn(),
}));
vi.mock('@/modules/help/helpAnalytics', () => ({ trackHelp: h.track }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key,
    tc: (key: string, _choice?: number, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));
vi.mock('@/plugins/i18n', () => ({ default: { locale: 'us' } }));
vi.mock('@/api/help.api', () => ({
  getHelpUpdates: h.updates,
  helpLocale: () => 'en-US',
}));
vi.mock('@/modules/navigation/helpAccess', () => ({ openWelcomeHelp: h.openTab }));
vi.mock('@/shared/components/iso/IsoScene.vue', () => ({ default: { render: (c: Vue.CreateElement) => c('svg', { class: 'iso-stub' }) } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: {
    inheritAttrs: false,
    render(this: Vue, c: Vue.CreateElement) {
      const link = !!this.$attrs['href'];
      return c(link ? 'a' : 'button', { attrs: { ...(link ? {} : { type: 'button' }), ...this.$attrs }, on: this.$listeners }, this.$slots['default']);
    },
  },
}));
import WelcomeHelpPanel from './WelcomeHelpPanel.vue';

// The icon name goes in an attribute so it never leaks into a control's text.
const stubs = {
  'v-icon': { render(this: Vue, c: Vue.CreateElement) { return c('i', { class: 'v-icon', attrs: { 'data-icon': this.$slots['default']?.[0]?.text?.trim() } }); } },
};
const mounted: Wrapper<Vue>[] = [];
const roots: HTMLElement[] = [];

function setViewport(phone: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: phone && query === '(max-width: 600px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

function show(props: { started?: boolean; hasWallets?: boolean; opener?: HTMLElement | null } = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  roots.push(root);
  const wrapper = mount(WelcomeHelpPanel, {
    attachTo: root,
    propsData: { started: false, hasWallets: false, ...props },
    stubs,
  });
  mounted.push(wrapper);
  return wrapper;
}

const rowTitles = (wrapper: Wrapper<Vue>, section?: string) =>
  wrapper.findAll(section ? `[data-section="${section}"] .whelp-row__title` : '.whelp-row__title').wrappers.map(row => row.text());
const sectionIds = (wrapper: Wrapper<Vue>) => wrapper.findAll('[data-section]').wrappers.map(section => section.attributes('data-section'));
const byTest = (wrapper: Wrapper<Vue>, name: string) => wrapper.find(`[data-test="${name}"]`);

beforeEach(() => {
  setViewport(false);
  h.track.mockReset();
  h.openTab.mockReset().mockResolvedValue(true);
  h.updates.mockReset().mockResolvedValue({ items: [], total: 0, nextCursor: null, sources: [] });
});
afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.destroy());
  roots.splice(0).forEach(root => root.remove());
  vi.useRealTimers();
});

describe('welcome help panel: desktop', () => {
  it('is a labelled, non-modal panel with a search field and the help hero', () => {
    const wrapper = show();
    const panel = byTest(wrapper, 'help-panel');
    expect(panel.element.tagName).toBe('ASIDE');
    expect(panel.attributes('id')).toBe('whelp-panel');
    expect(panel.classes()).toContain('glass-overlay');
    expect(panel.attributes('role')).toBeUndefined();
    expect(panel.attributes('aria-modal')).toBeUndefined();
    expect(panel.attributes('aria-labelledby')).toBe('whelp-title');
    expect(wrapper.find('#whelp-title').text()).toBe('help.welcome.title');
    expect(wrapper.text()).toContain('help.welcome.subtitle');
    expect(wrapper.find('.iso-stub').exists()).toBe(true);
    expect(wrapper.find('form[role="search"] label[for="whelp-search"]').text()).toBe('help.search');
    expect(wrapper.find('#whelp-search').attributes('placeholder')).toBe('help.search');
    expect(wrapper.find('.whelp-scrim').exists()).toBe(false);
  });

  it('moves focus into the search field on open', async () => {
    const wrapper = show();
    await nextTick();
    expect(document.activeElement).toBe(wrapper.find('#whelp-search').element);
  });

  it('asks to close from the close button and from Escape, but not for Escape elsewhere on the page', async () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    roots.push(outside);
    const wrapper = show();
    await byTest(wrapper, 'close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);

    // Focus inside the panel
    wrapper.find('#whelp-search').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(2);
    // Focus on the page background
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(3);
    // A control elsewhere in the (usable) welcome screen keeps its own Escape.
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(3);
    // Other keys never close it.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(3);
  });

  it('stops listening for Escape once it is gone', () => {
    const wrapper = show();
    wrapper.destroy();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('returns focus to the Help button on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    roots.push(opener);
    opener.focus();
    const wrapper = show({ opener });
    await nextTick();
    expect(document.activeElement).toBe(wrapper.find('#whelp-search').element);
    wrapper.destroy();
    expect(document.activeElement).toBe(opener);
  });

  it('falls back to whatever had focus when it opened, and leaves focus alone if the user moved on', async () => {
    const trigger = document.createElement('button');
    const other = document.createElement('button');
    document.body.append(trigger, other);
    roots.push(trigger, other);
    trigger.focus();
    const first = show();
    await nextTick();
    first.destroy();
    expect(document.activeElement).toBe(trigger);

    const second = show();
    await nextTick();
    other.focus();
    second.destroy();
    expect(document.activeElement).toBe(other);
  });

  it.each([
    { name: 'saved wallets', props: { started: false, hasWallets: true },
      sections: ['gettingBack', 'common'],
      rows: { gettingBack: ['Restore an existing wallet', 'Use Gero with a hardware wallet', 'Keep your recovery phrase safe'],
        common: ['Get started with Midnight: NIGHT and DUST', 'Choose the right network', 'Why is my Cardano transaction still pending?'] },
      notice: 'help.notice.locked' },
    { name: 'no wallets', props: { started: false, hasWallets: false },
      sections: ['newToGero', 'common'],
      rows: { newToGero: ['Set up your first Gero wallet', 'Restore an existing wallet', 'Choose the right network'],
        common: ['Get started with Midnight: NIGHT and DUST', 'Keep your recovery phrase safe', 'Why is my Cardano transaction still pending?'] },
      notice: 'help.notice.noWallets' },
    { name: 'setup open', props: { started: true, hasWallets: false },
      sections: ['aboutStep', 'common'],
      rows: { aboutStep: ['Set up your first Gero wallet', 'Restore an existing wallet', 'Use Gero with a hardware wallet'],
        common: ['Keep your recovery phrase safe', 'Choose the right network', 'Get started with Midnight: NIGHT and DUST'] },
      notice: 'help.notice.noWallets' },
    { name: 'setup open over saved wallets', props: { started: true, hasWallets: true },
      sections: ['aboutStep', 'common'],
      rows: { aboutStep: ['Set up your first Gero wallet', 'Restore an existing wallet', 'Use Gero with a hardware wallet'],
        common: ['Keep your recovery phrase safe', 'Choose the right network', 'Get started with Midnight: NIGHT and DUST'] },
      notice: 'help.notice.locked' },
  ])('shows the $name lists, the safety note and the matching support notice', ({ props, sections, rows, notice }) => {
    const wrapper = show(props);
    expect(sectionIds(wrapper)).toEqual(sections);
    for (const id of sections) expect(rowTitles(wrapper, id)).toEqual((rows as Record<string, string[]>)[id]);
    expect(wrapper.findAll('[data-section] h3').wrappers.map(heading => heading.text()))
      .toEqual(sections.map(id => `help.welcome.${id === 'common' ? 'common' : id}`));
    // Each row names its topic.
    expect(wrapper.find('[data-section] .t-caption').text()).toMatch(/^help\.topic\./);
    const note = byTest(wrapper, 'safety-note');
    expect(note.attributes('role')).toBe('note');
    expect(note.text()).toBe('help.welcome.safety');
    expect(wrapper.find('.whelp-support').text()).toContain(notice);
    expect(wrapper.find('.whelp-support h3').text()).toBe('help.supportLabel');
    expect(wrapper.find('.whelp-support [data-icon="mdi-email-outline"]').exists()).toBe(true);
  });

  it('follows the welcome screen when setup opens or closes behind it', async () => {
    const wrapper = show({ started: false, hasWallets: true });
    expect(sectionIds(wrapper)).toEqual(['gettingBack', 'common']);
    await wrapper.setProps({ started: true });
    expect(sectionIds(wrapper)).toEqual(['aboutStep', 'common']);
    await wrapper.setProps({ started: false });
    expect(sectionIds(wrapper)).toEqual(['gettingBack', 'common']);
  });

  it('filters answers as you type and replaces the lists with the results', async () => {
    const wrapper = show({ started: false, hasWallets: true });
    await wrapper.find('#whelp-search').setValue('hardware');
    expect(wrapper.find('[data-section]').exists()).toBe(false);
    const titles = rowTitles(wrapper);
    expect(titles).toContain('Use Gero with a hardware wallet');
    expect(titles).not.toContain('Choose the right network');
    expect(byTest(wrapper, 'results-status').text()).toMatch(/^help\.count/);
    // Help that is not about answers stays put.
    expect(byTest(wrapper, 'safety-note').exists()).toBe(true);
    expect(wrapper.find('.whelp-support').exists()).toBe(true);
    await wrapper.find('#whelp-search').setValue('');
    expect(sectionIds(wrapper)).toEqual(['gettingBack', 'common']);
  });

  it('shows an empty state when nothing matches', async () => {
    const wrapper = show();
    await wrapper.find('#whelp-search').setValue('zzzz-no-such-thing');
    expect(wrapper.find('.whelp-row').exists()).toBe(false);
    const empty = byTest(wrapper, 'no-results');
    expect(empty.text()).toContain('help.noResults');
    expect(empty.text()).toContain('help.welcome.noResultsBody');
    expect(byTest(wrapper, 'results-status').text()).toBe('help.noResults');
  });

  it('does not submit or navigate when the search form is submitted', async () => {
    const wrapper = show();
    const submit = new Event('submit', { cancelable: true });
    wrapper.find('form').element.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
  });
});

describe('welcome help panel: answer view', () => {
  const open = async (wrapper: Wrapper<Vue>, title: string) => {
    await wrapper.findAll('.whelp-row').wrappers.find(row => row.text().includes(title))!.trigger('click');
  };

  it('swaps in the answer as numbered steps without leaving the screen', async () => {
    const wrapper = show({ started: false, hasWallets: true });
    await open(wrapper, 'Restore an existing wallet');
    expect(byTest(wrapper, 'help-panel').attributes('aria-labelledby')).toBe('whelp-answer-title');
    expect(wrapper.find('#whelp-search').exists()).toBe(false);
    const title = wrapper.find('#whelp-answer-title');
    expect(title.text()).toBe('Restore an existing wallet');
    expect(title.attributes('lang')).toBe('en');
    const steps = wrapper.findAll('[data-test="steps"] li');
    expect(steps.wrappers.map(step => step.find('p').text())).toEqual([
      'Use the import or restore option on the welcome screen and select the correct chain.',
      'Enter recovery information only in the wallet restoration flow, never in chat or email.',
      'Check the restored addresses and network before moving funds.',
    ]);
    expect(steps.wrappers.map(step => step.find('.whelp-step__number').text())).toEqual(['1', '2', '3']);
    expect(wrapper.find('[data-test="steps"]').attributes('lang')).toBe('en');
    expect(wrapper.find('.whelp-chip').text()).toBe('help.topic.start');
    // Moves focus onto the new heading.
    await nextTick();
    expect(document.activeElement).toBe(title.element);
  });

  it('shows the setup-only label and caption only while setup is open', async () => {
    const closed = show({ started: false, hasWallets: true });
    await open(closed, 'Restore an existing wallet');
    expect(byTest(closed, 'setup-caption').exists()).toBe(false);
    expect(closed.text()).not.toContain('help.welcome.aboutStep');
    expect(closed.find('.whelp-answer__related h3').text()).toBe('help.welcome.related');

    const setup = show({ started: true, hasWallets: false });
    await open(setup, 'Restore an existing wallet');
    expect(byTest(setup, 'setup-caption').text()).toBe('help.welcome.setupCaption');
    expect(setup.find('.whelp-answer__meta .t-label').text()).toBe('help.welcome.aboutStep');
    expect(setup.find('.whelp-answer__related h3').text()).toBe('help.welcome.moreStep');
  });

  it('does not repeat the setup note as a step while the caption shows it', async () => {
    const setup = show({ started: true, hasWallets: false });
    await open(setup, 'Set up your first Gero wallet');
    expect(setup.findAll('[data-test="steps"] li')).toHaveLength(3);
    expect(setup.findAll('[data-test="steps"] p').wrappers.map(step => step.text())).not.toContain('Help stays available while setup is open.');
    expect(byTest(setup, 'setup-caption').exists()).toBe(true);
  });

  it('offers three other answers from the same state, and opening one replaces the view', async () => {
    const wrapper = show({ started: true, hasWallets: false });
    await open(wrapper, 'Restore an existing wallet');
    const related = wrapper.findAll('.whelp-answer__related .whelp-row');
    expect(related.wrappers.map(row => row.find('.whelp-row__title').text())).toEqual([
      'Set up your first Gero wallet', 'Use Gero with a hardware wallet', 'Keep your recovery phrase safe',
    ]);
    await related.at(1).trigger('click');
    expect(wrapper.find('#whelp-answer-title').text()).toBe('Use Gero with a hardware wallet');
  });

  it('acknowledges Yes and No without sending anything', async () => {
    const wrapper = show({ started: true, hasWallets: false });
    await open(wrapper, 'Restore an existing wallet');
    const status = byTest(wrapper, 'feedback-status');
    expect(status.attributes('role')).toBe('status');
    expect(status.text()).toBe('');
    expect(byTest(wrapper, 'feedback').text()).toContain('help.welcome.helpful');
    await byTest(wrapper, 'helpful-yes').trigger('click');
    expect(status.text()).toBe('help.welcome.thanksYes');
    expect(byTest(wrapper, 'helpful-yes').attributes('aria-pressed')).toBe('true');
    expect(byTest(wrapper, 'helpful-no').attributes('aria-pressed')).toBe('false');
    await byTest(wrapper, 'helpful-no').trigger('click');
    expect(status.text()).toBe('help.welcome.thanksNo');
    expect(byTest(wrapper, 'helpful-no').attributes('aria-pressed')).toBe('true');
    expect(byTest(wrapper, 'helpful-yes').attributes('aria-pressed')).toBe('false');
  });

  it('asks again for a different answer', async () => {
    const wrapper = show({ started: true, hasWallets: false });
    await open(wrapper, 'Restore an existing wallet');
    await byTest(wrapper, 'helpful-yes').trigger('click');
    await wrapper.findAll('.whelp-answer__related .whelp-row').at(0).trigger('click');
    expect(byTest(wrapper, 'feedback-status').text()).toBe('');
    expect(byTest(wrapper, 'helpful-yes').attributes('aria-pressed')).toBe('false');
  });

  it('goes back to the list with the search text, scroll position and focus kept', async () => {
    const wrapper = show({ started: false, hasWallets: true });
    await wrapper.find('#whelp-search').setValue('wallet');
    const scroller = byTest(wrapper, 'list-view').element;
    scroller.scrollTop = 140;
    const title = rowTitles(wrapper)[1]!;
    await open(wrapper, title);
    expect(wrapper.find('[data-test="list-view"]').exists()).toBe(false);
    await byTest(wrapper, 'back').trigger('click');
    await nextTick();
    expect((wrapper.find('#whelp-search').element as HTMLInputElement).value).toBe('wallet');
    expect(rowTitles(wrapper)[1]).toBe(title);
    expect(byTest(wrapper, 'list-view').element.scrollTop).toBe(140);
    expect(document.activeElement).toBe(wrapper.findAll('.whelp-row').at(1).element);
  });

  it('keeps the back button and the close button in the answer top bar', async () => {
    const wrapper = show({ started: false, hasWallets: false });
    await open(wrapper, 'Choose the right network');
    const back = byTest(wrapper, 'back');
    expect(back.text()).toBe('help.welcome.title');
    expect(back.attributes('aria-label')).toBe('help.welcome.backToHelp');
    await byTest(wrapper, 'close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});

describe('welcome help panel: support block', () => {
  it('links the support address and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = show({ hasWallets: true });
    expect(wrapper.find('.whelp-support a[href="mailto:support@gerowallet.io"]').text()).toBe('support@gerowallet.io');
    await byTest(wrapper, 'copy-email').trigger('click');
    expect(writeText).toHaveBeenCalledWith('support@gerowallet.io');
    await nextTick();
    expect(byTest(wrapper, 'copy-status').text()).toBe('help.copied');
    expect(byTest(wrapper, 'copy-email').attributes('aria-label')).toBe('help.copyEmail');
    vi.unstubAllGlobals();
  });

  it('shows the manual-copy hint when the clipboard is refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const wrapper = show();
    await byTest(wrapper, 'copy-email').trigger('click');
    await nextTick();
    const status = byTest(wrapper, 'copy-status');
    expect(status.text()).toBe('help.copyFailed');
    expect(status.classes()).not.toContain('sr-only');
    vi.unstubAllGlobals();
  });
});

describe('welcome help panel: footer', () => {
  it('opens the full Help Center in a new tab from every state', async () => {
    for (const props of [{ hasWallets: true }, { hasWallets: false }, { started: true }]) {
      h.openTab.mockClear();
      const wrapper = show(props);
      const link = byTest(wrapper, 'open-full');
      expect(link.text()).toContain('help.welcome.openFull');
      expect(link.attributes('href')).toBe('#/help');
      expect(link.attributes('target')).toBe('_blank');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.element.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(h.openTab).toHaveBeenCalledWith('/help');
      await nextTick();
      expect(wrapper.find('[data-test="open-failed"]').exists()).toBe(false);
    }
  });

  it('opens the answer in the Help Center, in basic mode, from the answer view', async () => {
    const wrapper = show({ hasWallets: true });
    await wrapper.findAll('.whelp-row').at(0).trigger('click');
    const link = byTest(wrapper, 'open-full');
    expect(link.text()).toContain('help.welcome.openArticle');
    await link.trigger('click');
    expect(h.openTab).toHaveBeenCalledWith('/help/articles/restore?basic=1');
  });

  it('shows the failure inside the panel with a plain link instead of a page toast', async () => {
    h.openTab.mockResolvedValue(false);
    const wrapper = show({ started: true });
    await byTest(wrapper, 'open-full').trigger('click');
    await nextTick();
    await nextTick();
    const failed = byTest(wrapper, 'open-failed');
    expect(failed.text()).toContain('help.openFailed');
    const link = failed.find('a');
    expect(link.text()).toBe('help.openNewTab');
    expect(link.attributes('href')).toBe('#/help');
    expect(link.attributes('target')).toBe('_blank');
    expect(failed.element.parentElement!.getAttribute('role')).toBe('status');
    // A later success clears it.
    h.openTab.mockResolvedValue(true);
    await byTest(wrapper, 'open-full').trigger('click');
    await nextTick();
    await nextTick();
    expect(wrapper.find('[data-test="open-failed"]').exists()).toBe(false);
  });
});

describe("welcome help panel: what's new", () => {
  const blogPost = {
    id: 'blog:27', kind: 'blog', source: 'gero-blog', title: 'GeroWallet 2.7 Is Live', locale: 'en-US', publisher: 'Gero',
    publishedAt: '2026-08-19T10:00:00.000Z', destination: { type: 'blog', slug: 'gerowallet-2-7-is-live' },
    media: [{ url: '/api/blog/assets/cover_thumb_1234abcd', alt: 'Cover' }],
  };
  const settle = async () => { for (let i = 0; i < 4; i++) await nextTick(); };

  beforeEach(() => vi.stubEnv('VITE_BACKEND_URL', 'https://backend.test'));
  afterEach(() => vi.unstubAllEnvs());

  it('shows the latest Gero blog post with its thumbnail and opens the article in a new tab', async () => {
    h.updates.mockResolvedValue({ items: [blogPost, { ...blogPost, id: 'blog:26', title: 'Older post' }], total: 2, nextCursor: null, sources: [] });
    const wrapper = show({ hasWallets: true });
    await settle();
    expect(h.updates).toHaveBeenCalledWith({ source: 'gero-blog', chain: 'all', locale: 'en-US' }, expect.any(AbortSignal));
    const news = byTest(wrapper, 'whats-new');
    expect(news.find('h3').text()).toBe('help.welcome.whatsNew');
    expect(news.text()).toContain('GeroWallet 2.7 Is Live');
    expect(news.text()).not.toContain('Older post');
    expect(news.find('.t-caption').text()).toContain('help.welcome.blogMeta');
    expect(news.find('img').attributes('src')).toBe('https://backend.test/api/blog/assets/cover_thumb_1234abcd');
    expect(news.find('img').attributes('alt')).toBe('');
    const link = news.find('a');
    expect(link.attributes('href')).toBe('#/blog/gerowallet-2-7-is-live');
    await link.trigger('click');
    expect(h.openTab).toHaveBeenCalledWith('/blog/gerowallet-2-7-is-live');
  });

  it('omits the thumbnail when the post has no usable image', async () => {
    h.updates.mockResolvedValue({ items: [{ ...blogPost, media: [{ url: 'https://evil.test/x.png', alt: '' }] }], total: 1, nextCursor: null, sources: [] });
    const wrapper = show();
    await settle();
    expect(byTest(wrapper, 'whats-new').exists()).toBe(true);
    expect(byTest(wrapper, 'whats-new').find('img').exists()).toBe(false);
  });

  it('is hidden while loading', () => {
    h.updates.mockReturnValue(new Promise(() => undefined));
    expect(byTest(show(), 'whats-new').exists()).toBe(false);
  });

  it('is hidden when the request fails', async () => {
    h.updates.mockRejectedValue(new Error('offline'));
    const wrapper = show();
    await settle();
    expect(byTest(wrapper, 'whats-new').exists()).toBe(false);
    expect(wrapper.find('.whelp-support').exists()).toBe(true);
  });

  it('is hidden when there is no post, or no safe link for it', async () => {
    h.updates.mockResolvedValue({ items: [], total: 0, nextCursor: null, sources: [] });
    const empty = show();
    await settle();
    expect(byTest(empty, 'whats-new').exists()).toBe(false);

    h.updates.mockResolvedValue({ items: [{ ...blogPost, destination: { type: 'blog', slug: '../nope' } }], total: 1, nextCursor: null, sources: [] });
    const unsafe = show();
    await settle();
    expect(byTest(unsafe, 'whats-new').exists()).toBe(false);
  });

  it('steps aside while searching and cancels the request when the panel closes', async () => {
    h.updates.mockResolvedValue({ items: [blogPost], total: 1, nextCursor: null, sources: [] });
    const wrapper = show();
    await settle();
    expect(byTest(wrapper, 'whats-new').exists()).toBe(true);
    await wrapper.find('#whelp-search').setValue('network');
    expect(byTest(wrapper, 'whats-new').exists()).toBe(false);
    await wrapper.find('#whelp-search').setValue('');
    expect(byTest(wrapper, 'whats-new').exists()).toBe(true);
    expect(h.updates).toHaveBeenCalledTimes(1);

    const signal = h.updates.mock.calls[0]![1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    wrapper.destroy();
    expect(signal.aborted).toBe(true);
  });
});

describe('welcome help panel: phone sheet', () => {
  beforeEach(() => setViewport(true));

  it('is a modal bottom sheet over a scrim, with a grabber and no sub-line or scene', () => {
    const wrapper = show({ started: false, hasWallets: false });
    const sheet = byTest(wrapper, 'help-panel');
    expect(sheet.element.tagName).toBe('SECTION');
    expect(sheet.attributes('role')).toBe('dialog');
    expect(sheet.attributes('aria-modal')).toBe('true');
    expect(sheet.attributes('aria-labelledby')).toBe('whelp-title');
    expect(sheet.classes()).toContain('whelp-sheet');
    expect(sheet.classes()).not.toContain('glass-overlay');
    expect(wrapper.find('.whelp-grabber').exists()).toBe(true);
    expect(wrapper.find('.whelp-scrim').exists()).toBe(true);
    expect(wrapper.find('.iso-stub').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('help.welcome.subtitle');
    expect(wrapper.find('.whelp').classes()).toContain('whelp--phone');
  });

  it('leads with the first list only, then the note and a compact support block, with no What\'s new', () => {
    const wrapper = show({ started: false, hasWallets: false });
    expect(sectionIds(wrapper)).toEqual(['newToGero']);
    expect(rowTitles(wrapper)).toEqual(['Set up your first Gero wallet', 'Restore an existing wallet', 'Choose the right network']);
    expect(byTest(wrapper, 'safety-note').exists()).toBe(true);
    const support = wrapper.find('.whelp-support');
    expect(support.classes()).toContain('whelp-support--compact');
    expect(support.find('h3').classes()).toContain('sr-only');
    expect(support.find('[data-icon="mdi-email-outline"]').exists()).toBe(false);
    expect(support.find('[data-icon="mdi-content-copy"]').exists()).toBe(true);
    expect(h.updates).not.toHaveBeenCalled();
    expect(byTest(wrapper, 'open-full').text()).toContain('help.welcome.openFull');
  });

  it('closes from the scrim, the close button and Escape wherever focus is', async () => {
    const wrapper = show();
    await wrapper.find('.whelp-scrim').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    await byTest(wrapper, 'close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(2);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(3);
  });

  it('keeps the scrim out of the tab order and away from assistive tech', () => {
    const scrim = show().find('.whelp-scrim');
    expect(scrim.attributes('tabindex')).toBe('-1');
    expect(scrim.attributes('aria-hidden')).toBe('true');
  });

  it('focuses the heading rather than the search field so the keyboard stays down', async () => {
    const wrapper = show();
    await nextTick();
    expect(document.activeElement).toBe(wrapper.find('#whelp-title').element);
  });

  it('traps focus inside the sheet', async () => {
    const wrapper = show({ hasWallets: true });
    await nextTick();
    const panel = byTest(wrapper, 'help-panel');
    const focusable = Array.from(panel.element.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    expect(first).toBe(wrapper.find('[data-test="close"]').element);

    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    first.focus();
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    // In the middle Tab is left to the browser.
    const middle = focusable[1]!;
    middle.focus();
    const free = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    middle.dispatchEvent(free);
    expect(free.defaultPrevented).toBe(false);
  });

  it('shows the answer view inside the sheet with 44px-friendly controls and the same steps', async () => {
    const wrapper = show({ started: false, hasWallets: false });
    await wrapper.findAll('.whelp-row').at(1).trigger('click');
    expect(wrapper.find('.whelp-answer--phone').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="steps"] li')).toHaveLength(3);
    expect(wrapper.find('.whelp-answer__related h3').text()).toBe('help.welcome.related');
    expect(wrapper.find('.whelp-support').classes()).toContain('whelp-support--compact');
    expect(byTest(wrapper, 'help-panel').attributes('aria-labelledby')).toBe('whelp-answer-title');
  });
});

describe('welcome help panel: anonymous usage counts', () => {
  const counted = () => h.track.mock.calls.map(([event]) => event);
  const event = (type: string, subject?: string) => ({ type, ...(subject ? { subject } : {}), surface: 'welcome', chain: 'all' });
  const open = async (wrapper: Wrapper<Vue>, title: string) => {
    await wrapper.findAll('.whelp-row').wrappers.find(row => row.text().includes(title))!.trigger('click');
  };

  it.each([
    [{ hasWallets: true }, 'saved'], [{ hasWallets: false }, 'new'], [{ started: true }, 'setup'], [{ started: true, hasWallets: true }, 'setup'],
  ] as const)('counts the panel opening with the welcome state: %j', (props, state) => {
    show(props);
    expect(counted()).toEqual([event('welcome_open', state)]);
  });

  it('counts an answer when it opens, from the list and from a related row, once per answer', async () => {
    const wrapper = show({ hasWallets: true });
    await open(wrapper, 'Restore an existing wallet');
    await wrapper.findAll('.whelp-answer__related .whelp-row').at(0).trigger('click');
    expect(counted().slice(1)).toEqual([event('article_view', 'restore'), event('article_view', 'hardware')]);
  });

  it('counts the first Yes or No on an answer under the answer id, and a changed mind only changes the highlight', async () => {
    const wrapper = show({ started: true });
    await open(wrapper, 'Restore an existing wallet');
    await byTest(wrapper, 'helpful-no').trigger('click');
    await byTest(wrapper, 'helpful-yes').trigger('click');
    expect(counted().slice(2)).toEqual([event('article_helpful_no', 'restore')]);
    await wrapper.findAll('.whelp-answer__related .whelp-row').at(0).trigger('click');
    await byTest(wrapper, 'helpful-yes').trigger('click');
    expect(counted().slice(3).map(call => `${call.type}:${call.subject}`)).toEqual(['article_view:create', 'article_helpful_yes:create']);
  });

  it('counts a search only after 600 ms of quiet, as results or empty, and never with the words typed', async () => {
    vi.useFakeTimers();
    const wrapper = show({ hasWallets: true });
    const input = wrapper.find('#whelp-search');
    await input.setValue('hard');
    vi.advanceTimersByTime(599);
    await input.setValue('hardware');
    vi.advanceTimersByTime(599);
    expect(counted()).toEqual([event('welcome_open', 'saved')]);
    vi.advanceTimersByTime(1);
    expect(counted().slice(1)).toEqual([event('search', 'results')]);
    await input.setValue('zzzzqqqq');
    vi.advanceTimersByTime(600);
    expect(counted().slice(2)).toEqual([event('search', 'empty')]);
    expect(JSON.stringify(counted())).not.toMatch(/hard|zzzz/);
  });

  it('counts nothing for a cleared search or when the panel closes before the pause ends', async () => {
    vi.useFakeTimers();
    const wrapper = show({ hasWallets: true });
    await wrapper.find('#whelp-search').setValue('hardware');
    await wrapper.find('#whelp-search').setValue('   ');
    vi.advanceTimersByTime(2000);
    await wrapper.find('#whelp-search').setValue('hardware');
    wrapper.destroy();
    vi.advanceTimersByTime(2000);
    expect(counted()).toEqual([event('welcome_open', 'saved')]);
  });

  it('counts the support email link and a successful copy as welcome, and not a refused copy', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = show({ hasWallets: true });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    wrapper.find('.whelp-support a').element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    await byTest(wrapper, 'copy-email').trigger('click'); await nextTick();
    await byTest(wrapper, 'copy-email').trigger('click'); await nextTick();
    expect(counted().slice(1)).toEqual([event('support_email', 'welcome'), event('support_email_copied', 'welcome')]);
    vi.unstubAllGlobals();
  });

  it('counts the footer link in both its labels, and the What\'s new row, as opening the full Help Center', async () => {
    vi.stubEnv('VITE_BACKEND_URL', 'https://backend.test');
    h.updates.mockResolvedValue({ total: 1, nextCursor: null, sources: [], items: [{ id: 'blog:27', kind: 'blog', source: 'gero-blog', title: 'GeroWallet 2.7 Is Live', locale: 'en-US', publisher: 'Gero',
      publishedAt: '2026-08-19T10:00:00.000Z', destination: { type: 'blog', slug: 'gerowallet-2-7-is-live' }, media: [] }] });
    const wrapper = show({ hasWallets: true });
    for (let i = 0; i < 4; i++) await nextTick();
    await byTest(wrapper, 'open-full').trigger('click');
    await byTest(wrapper, 'whats-new').find('a').trigger('click');
    await wrapper.findAll('.whelp-row').at(0).trigger('click');
    await byTest(wrapper, 'open-full').trigger('click');
    expect(counted().filter(call => call.type === 'welcome_open_full')).toHaveLength(3);
    expect(counted().map(call => call.type)).toEqual(['welcome_open', 'welcome_open_full', 'welcome_open_full', 'article_view', 'welcome_open_full']);
    vi.unstubAllEnvs();
  });
});

import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelpArticleResponse } from '@/api/help.api';
import { answers, asAnswer } from './helpContent';
import { clearHelpSupport, helpSupportIntent } from './supportIntent';
import { vBtnStub } from './helpTestSupport';

const h = vi.hoisted(() => ({
  wallet: { loggedWallet: null as unknown, isLocked: true, isSyncing: false },
  route: { path: '/help/articles/backup', fullPath: '/help/articles/backup', query: {} as Record<string, string> },
  replace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive(h.wallet) }));
vi.mock('vue-router/composables', () => ({ useRoute: () => h.route, useRouter: () => ({ replace: h.replace, push: vi.fn() }) }));
vi.mock('@/shared/composables/useTranslation', async () => {
  const { translate, translateChoice } = await import('./helpTestSupport');
  return { useTranslation: () => ({ t: translate, tc: translateChoice }) };
});
import HelpReader from './HelpReader.vue';

const bundled = answers.find(answer => answer.id === 'backup')!;
const published: HelpArticleResponse = { resolvedLocale: 'en-US', isLocaleFallback: false, sources: [], article: {
  id: 'hw', slug: 'hardware', title: 'Use Gero with a hardware wallet', summary: 'Pair a device.', kind: 'tutorial', topic: 'security', source: 'gero-help', locale: 'en-US',
  revision: 3, readingMinutes: 4, lastVerifiedAt: '2026-10-02T10:00:00Z', applicability: { chains: ['cardano'], networks: [], walletTypes: [], requiredFeatures: [], testedWalletVersion: '2.7.2' },
  body: { nodeType: 'document', data: {}, content: [] } as never, relatedArticleIds: [], assets: {} } };
const html = '<h2>Before you start</h2><p>Read first.</p><h2>Steps</h2><ol><li><p>One</p></li><li><p>Two</p></li></ol><blockquote><p>Never share your phrase.</p></blockquote>';
const base = { article: bundled, response: null, html: '', related: [], applicable: true, basic: true, loading: false, failed: false, stale: false };
const stubs = { 'v-btn': vBtnStub, 'v-icon': true, 'router-link': { props: ['to'], template: '<a :href="to.path"><slot /></a>' } };
const wrappers: Array<ReturnType<typeof mount>> = [];
const show = (propsData: Record<string, unknown> = {}) => { const wrapper = mount(HelpReader, { propsData: { ...base, ...propsData }, stubs, attachTo: document.body }); wrappers.push(wrapper); return wrapper; };
const buttonNamed = (wrapper: ReturnType<typeof show>, text: string) => wrapper.findAll('button').wrappers.find(button => button.text() === text);
beforeEach(() => { clearHelpSupport(); h.wallet.loggedWallet = null; h.wallet.isLocked = true; });
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.destroy()); clearHelpSupport(); });

describe('article reader', () => {
  it('acknowledges Yes and No in place of the buttons, and sends nothing', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const yes = show();
    expect(yes.find('.helpful-label').text()).toBe('Was this answer helpful?');
    expect(yes.find('.helpful [role="status"]').text()).toBe('');
    await buttonNamed(yes, 'Yes')!.trigger('click');
    expect(yes.find('.helpful [role="status"]').text()).toBe('Glad it helped.');
    expect(buttonNamed(yes, 'Yes')).toBeUndefined(); expect(buttonNamed(yes, 'No')).toBeUndefined();
    const no = show();
    await buttonNamed(no, 'No')!.trigger('click');
    expect(no.find('.helpful [role="status"]').text()).toBe('Sorry it didn\'t help. Contact support below and we\'ll take a look.');
    expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it('asks again when the reader moves to another article', async () => {
    const wrapper = show();
    await buttonNamed(wrapper, 'Yes')!.trigger('click');
    wrapper.setProps({ article: answers.find(answer => answer.id === 'restore') }); await nextTick();
    expect(buttonNamed(wrapper, 'Yes')).toBeDefined();
    expect(wrapper.find('.helpful [role="status"]').text()).toBe('');
  });
  it('shows breadcrumb, chips, bundled body and no table of contents for a quick answer', () => {
    const wrapper = show();
    const crumbs = wrapper.findAll('.crumbs li');
    expect(crumbs.at(0).text()).toBe('Tutorials & answers');
    expect(crumbs.at(2).text()).toBe('Security & recovery');
    expect(crumbs.at(2).find('a').attributes('href')).toBe('/help/topics/security');
    expect(wrapper.find('[aria-current="page"]').text()).toBe(bundled.title);
    expect(wrapper.findAll('.help-chip').wrappers.map(chip => chip.text())).toEqual(['Quick answer', 'Security & recovery']);
    expect(wrapper.find('h1').text()).toBe(bundled.title);
    expect(wrapper.find('.article-body p').text()).toBe(bundled.body);
    expect(wrapper.find('.toc').exists()).toBe(false);
    expect(wrapper.find('.article-verified').exists()).toBe(false);
    expect(wrapper.find('.fact-value').text()).toBe('All wallets and chains');
    expect(wrapper.text()).not.toContain('Checked for');
    expect(wrapper.find('input[type="search"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Back to Help Center');
  });
  it('gives a published tutorial its kind, verification and rail facts, and links the headings', async () => {
    const wrapper = show({ article: asAnswer(published.article), response: published, html, basic: false });
    expect(wrapper.findAll('.help-chip').wrappers.map(chip => chip.text())).toEqual(['Tutorial', 'Security & recovery']);
    expect(wrapper.find('.article-summary').text()).toBe('Pair a device.');
    expect(wrapper.find('.article-verified').text()).toBe('Checked for Gero 2.7.2 · Oct 2, 2026');
    const toc = wrapper.findAll('.toc-link');
    expect(toc.wrappers.map(link => link.text())).toEqual(['Before you start', 'Steps']);
    expect(toc.at(0).attributes('aria-current')).toBe('location');
    expect(wrapper.find('#help-section-2').text()).toBe('Steps');
    const scroll = vi.fn(); (wrapper.find('#help-section-2').element as HTMLElement).scrollIntoView = scroll;
    await toc.at(1).trigger('click');
    expect(scroll).toHaveBeenCalled();
    expect(toc.at(1).attributes('aria-current')).toBe('location'); expect(toc.at(0).attributes('aria-current')).toBeUndefined();
    const facts = wrapper.findAll('.fact');
    expect(facts.at(0).find('.fact-value').text()).toBe('Cardano');
    expect(facts.at(1).text()).toContain('Gero 2.7.2'); expect(facts.at(1).text()).toContain('Oct 2, 2026');
    expect(wrapper.find('blockquote').exists()).toBe(true);
  });
  it('hides the table of contents for a single heading and the verification rows without data', () => {
    const bare = { ...published, article: { ...published.article, lastVerifiedAt: undefined, applicability: { ...published.article.applicability, chains: [], testedWalletVersion: undefined } } };
    const wrapper = show({ article: asAnswer(bare.article), response: bare, html: '<h2>Only one</h2><p>Text</p>', basic: false });
    expect(wrapper.find('.toc').exists()).toBe(false); expect(wrapper.find('.rail-rule').exists()).toBe(false);
    expect(wrapper.find('.article-verified').exists()).toBe(false);
    expect(wrapper.findAll('.fact')).toHaveLength(1);
    expect(wrapper.find('.fact-value').text()).toBe('All wallets and chains');
  });
  it('shows the English fallback note and the not-applicable note with a way back to all chains', async () => {
    const wrapper = show({ article: asAnswer(published.article), response: { ...published, isLocaleFallback: true }, html, basic: false, applicable: false });
    expect(wrapper.find('.article-head .article-note').text()).toContain('English');
    const switchChain = buttonNamed(wrapper, 'All chains')!;
    await switchChain.trigger('click');
    expect(h.replace).toHaveBeenCalledWith({ path: '/help/articles/backup', query: { chain: 'all' } });
  });
  it('closes with a support block that opens Support about this article, then related answers', async () => {
    const related = [answers.find(answer => answer.id === 'restore')!, answers.find(answer => answer.id === 'create')!];
    const wrapper = show({ related });
    await buttonNamed(wrapper, 'Contact support about this guide')!.trigger('click');
    expect(helpSupportIntent.request?.articleId).toBe('backup');
    const tiles = wrapper.findAll('.related-tile');
    expect(tiles.wrappers.map(tile => tile.find('.related-title').text())).toEqual(['Restore an existing wallet', 'Set up your first Gero wallet']);
    expect(tiles.at(0).find('.t-caption').text()).toBe('Get started · Quick answer');
    expect(tiles.at(0).attributes('href')).toBe('/help/articles/restore');
  });
  it('shows a status instead of an article when the answer was not found', () => {
    const wrapper = show({ article: undefined });
    expect(wrapper.find('.article').exists()).toBe(false);
    expect(wrapper.text()).toContain('That answer was not found.');
  });
});

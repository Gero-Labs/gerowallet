import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// Each widget is replaced by a marker, so the spec checks only what the dashboard itself owns: the order of its children.
const { marker } = vi.hoisted(() => ({
  marker: (section: string) => ({ default: { render: (h: (tag: string, data: object) => unknown) => h('section', { attrs: { 'data-section': section } }) } }),
}));
vi.mock('./HelpHero.vue', () => marker('hero'));
vi.mock('./HelpSupportWidget.vue', () => marker('support'));
vi.mock('../HelpContentStatus.vue', () => ({ default: { props: ['loading', 'failed', 'stale', 'hasRemote'], render(h: (tag: string, data: object) => unknown) { return (this as unknown as { loading: boolean }).loading ? h('p', { attrs: { 'data-section': 'status' } }) : undefined; } } }));
vi.mock('./HelpMostViewed.vue', () => marker('viewed'));
vi.mock('./HelpLatestTutorial.vue', () => marker('tutorial'));
vi.mock('./HelpBlogCard.vue', () => marker('blog'));
vi.mock('./HelpXCard.vue', () => marker('x'));
vi.mock('./HelpEcosystemNews.vue', () => marker('news'));
vi.mock('./HelpTopicsCard.vue', () => marker('topics'));
import HelpHomeDashboard from './HelpHomeDashboard.vue';

const props = { topics: [], viewed: { items: [], ranked: false }, tutorial: null, basic: false, loading: false, failed: false, stale: false, hasRemote: false };
const order = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('[data-section]').wrappers.map(item => item.attributes('data-section'));

describe('Help home dashboard', () => {
  it('places hero, support, most viewed, tutorial, blog, X, news and topics in the artboard order', () => {
    const wrapper = mount(HelpHomeDashboard, { propsData: props });
    expect(order(wrapper)).toEqual(['hero', 'support', 'viewed', 'tutorial', 'blog', 'x', 'news', 'topics']);
    const sections = Object.fromEntries(wrapper.findAll('[data-section]').wrappers.map(item => [item.attributes('data-section'), item.classes()]));
    expect(sections['hero']).toContain('hc-span-2');
    expect(sections['support']).toContain('hc-support');
    expect(sections['viewed']).toContain('hc-tall');
    expect(sections['topics']).toContain('hc-span-3');
    wrapper.destroy();
  });
  it('puts a loading or failure line directly under the hero row, ahead of the cards', () => {
    const wrapper = mount(HelpHomeDashboard, { propsData: { ...props, loading: true } });
    expect(order(wrapper).slice(0, 4)).toEqual(['hero', 'support', 'status', 'viewed']);
    expect(wrapper.find('[data-section="status"]').classes()).toContain('hc-status');
    wrapper.destroy();
  });
});

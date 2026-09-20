// src/modules/blog/Blog.spec.ts
//
// The list card is the only place that decides WHICH backend asset to draw, so
// that is what this spec pins. The backend centre-crops `image` (the 480x300
// thumbnail) out of the 1200x630 hero, which cuts the edges off any artwork
// that is not centre-composed (the 2.7.0 release banner lost its "2"). The card
// must therefore prefer the uncropped `heroImage` and only fall back to the
// thumbnail for posts that have no hero.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';
import type { BlogPost } from '@/api/blog.api';

const getBlogPosts = vi.fn();
vi.mock('@/api/blog.api', () => ({ getBlogPosts: (...args: unknown[]) => getBlogPosts(...args) }));
vi.mock('vue-router/composables', () => ({ useRouter: () => ({ push: vi.fn().mockResolvedValue(undefined) }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

// @ts-ignore — tsconfig has no `*.vue` module shim (see SupportAuthPrompt.spec.ts).
import Blog from './Blog.vue';

const $t = (key: string): string => key;

function post(overrides: Partial<BlogPost>): BlogPost {
  return {
    id: 'p1',
    title: 'GeroWallet 2.7: what is new',
    slug: 'gerowallet-2-7-whats-new',
    excerpt: 'Our biggest release ever.',
    content: null,
    publishDate: '2026-09-01T00:00:00Z',
    readingTime: 3,
    tags: [],
    assets: {},
    ...overrides,
  };
}

async function mountList(posts: BlogPost[]): Promise<Wrapper<Vue>> {
  getBlogPosts.mockResolvedValue({ posts, total: posts.length, hasMore: false });
  const wrapper = mount(Blog, {
    mocks: { $t },
    stubs: {
      'v-layout': true, 'v-row': true, 'v-col': true, 'v-text-field': true,
      'v-icon': true, 'v-progress-circular': true, ErrorState: true,
    },
  });
  await flush();
  return wrapper;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Vue.nextTick();
};

let wrapper: Wrapper<Vue> | null = null;
afterEach(() => { wrapper?.destroy(); wrapper = null; getBlogPosts.mockReset(); });

describe('Blog list card image', () => {
  it('draws the uncropped hero, not the centre-cropped thumbnail, when the post has both', async () => {
    wrapper = await mountList([post({
      image: 'https://api.gerowallet.io/api/blog/assets/x_thumb_1',
      heroImage: 'https://api.gerowallet.io/api/blog/assets/x_hero_1',
    })]);
    const media = wrapper.find('.blog-card:not(.blog-card--skeleton) .blog-card__media');
    expect(media.exists()).toBe(true);
    expect(media.attributes('style')).toContain('x_hero_1');
    expect(media.attributes('style')).not.toContain('x_thumb_1');
  });

  it('falls back to the thumbnail for a post without a hero', async () => {
    wrapper = await mountList([post({ image: 'https://api.gerowallet.io/api/blog/assets/x_thumb_2' })]);
    const media = wrapper.find('.blog-card:not(.blog-card--skeleton) .blog-card__media');
    expect(media.attributes('style')).toContain('x_thumb_2');
  });

  it('shows the placeholder icon only when the post has neither image', async () => {
    wrapper = await mountList([post({})]);
    const media = wrapper.find('.blog-card:not(.blog-card--skeleton) .blog-card__media');
    expect(media.attributes('style') ?? '').not.toContain('url(');
    expect(media.find('.blog-card__media-fallback').exists()).toBe(true);
  });
});

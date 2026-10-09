import { describe, expect, it } from 'vitest';
import { updateImages, updateLink, updateImage, updatePills, updateSource, updateSourceIcon } from './helpUpdates';
import type { HelpUpdate } from '@/api/help.api';
const item = (values: Partial<HelpUpdate>) => values as HelpUpdate;
describe('update destinations', () => {
  it('uses safe original-source links and rejects scripts, lookalike hosts, and unexpected social paths', () => {
    expect(updateLink(item({ kind: 'news', source: 'midnight-news', canonicalUrl: 'https://midnight.network/blog/news' }))).toBe('https://midnight.network/blog/news');
    for (const canonicalUrl of ['javascript:alert(1)', 'https://midnight.network.evil.test/blog/news', 'https://user@midnight.network/blog/news'])
      expect(updateLink(item({ kind: 'news', source: 'midnight-news', canonicalUrl }))).toBeNull();
    expect(updateLink(item({ kind: 'social', source: 'gero-x', canonicalUrl: 'https://x.com/login' }))).toBeNull();
    expect(updateLink(item({ kind: 'social', source: 'gero-x', canonicalUrl: 'https://x.com/i/web/status/12345' }))).toBe('https://x.com/i/web/status/12345');
  });
  it('keeps blog reading internal and media on the backend mirror', () => {
    expect(updateLink(item({ kind: 'blog', destination: { type: 'blog', slug: 'wallet-guide' } }))).toBe('/blog/wallet-guide');
    expect(updateLink(item({ kind: 'blog', destination: { type: 'blog', slug: '../welcome' } }))).toBeNull();
    expect(updateImage('/api/help/assets/' + 'a'.repeat(64), 'https://backend.test')).toContain('https://backend.test/api/help/assets/');
    expect(updateImage('https://private.test/image.png', 'https://backend.test')).toBeNull();
    expect(updateImage('/api/blog/assets/6r7NEsr7Ll3uBD96mMkfFl_thumb_189832d0', 'https://backend.test'))
      .toBe('https://backend.test/api/blog/assets/6r7NEsr7Ll3uBD96mMkfFl_thumb_189832d0');
    for (const path of ['/api/blog/assets/../private', '//private.test/image', '/api/blog/assets/id_thumb_189832d0?redirect=evil', '/api/blog/assets/id_thumb_189832d0.svg'])
      expect(updateImage(path, 'https://backend.test')).toBeNull();
  });
  it('keeps legacy blog-filter links and safely defaults unknown filters', () => {
    expect(updateSource('blog')).toBe('gero-blog'); expect(updateSource('bad')).toBe('all'); expect(updateSource('midnight-news')).toBe('midnight-news');
  });
});
describe('Updates page sources', () => {
  it('offers every source pill, and only the active chain\'s news pill under a chain filter', () => {
    expect(updatePills('all')).toEqual(['gero-blog', 'cardano-news', 'midnight-news', 'bitcoin-news', 'gero-x', 'nexus-x']);
    expect(updatePills('bitcoin')).toEqual(['gero-blog', 'bitcoin-news', 'gero-x', 'nexus-x']);
    expect(updatePills('midnight')).not.toContain('cardano-news');
  });
  it('maps each source to the Gero or Nexus mark, or to its chain glyph', () => {
    expect(updateSourceIcon('gero-blog')).toEqual({ mark: 'gero' });
    expect(updateSourceIcon('gero-x')).toEqual({ mark: 'gero' });
    expect(updateSourceIcon('nexus-x')).toEqual({ mark: 'nexus' });
    expect(updateSourceIcon('cardano-news')).toEqual({ icon: 'mdi-web' });
    expect(updateSourceIcon('midnight-news')).toEqual({ icon: 'mdi-weather-night' });
    expect(updateSourceIcon('bitcoin-news')).toEqual({ icon: 'mdi-bitcoin' });
  });
  it('keeps only media that resolve to a mirrored image', () => {
    const media = [{ url: '/api/help/assets/' + 'b'.repeat(64), alt: 'one' }, { url: 'https://elsewhere.test/a.png', alt: 'two' }, { url: '/api/blog/assets/id_thumb_189832d0', alt: 'three' }];
    expect(updateImages(item({ media }), 'https://backend.test').map(image => image.alt)).toEqual(['one', 'three']);
    expect(updateImages(item({ media: [] }), 'https://backend.test')).toEqual([]);
  });
});


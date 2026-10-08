import { describe, expect, it } from 'vitest';
import { updateLink, updateImage, updateSource } from './helpUpdates';
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
  });
  it('keeps legacy blog-filter links and safely defaults unknown filters', () => {
    expect(updateSource('blog')).toBe('gero-blog'); expect(updateSource('bad')).toBe('all'); expect(updateSource('midnight-news')).toBe('midnight-news');
  });
});

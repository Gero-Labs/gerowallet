import { describe, expect, it } from 'vitest';
import type { PublishedHelpArticle } from '@/api/help.api';
import { renderHelpArticle } from './helpRichText';
const text = (value: string) => ({ nodeType: 'text', value, data: {}, marks: [] });
function article(content: unknown[], assets = {}): PublishedHelpArticle {
  return { body: { nodeType: 'document', data: {}, content }, assets } as PublishedHelpArticle;
}
describe('Help rich-text boundary', () => {
  it('escapes author text and rejects executable links', () => {
    const html = renderHelpArticle(article([{ nodeType: 'hyperlink', data: { uri: 'javascript:alert(1)' }, content: [text('<script>unsafe</script>')] }]), 'https://api.gerowallet.io');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('javascript:'); expect(html).toContain('&lt;script&gt;');
  });
  it('renders only mirrored raster images and escapes their alternative text', () => {
    const node = { nodeType: 'embedded-asset-block', data: { target: { sys: { id: 'image' } } }, content: [] };
    expect(renderHelpArticle(article([node], { image: { url: 'https://tracker.invalid/x.png', title: 'x', contentType: 'image/png' } }), 'https://api.gerowallet.io')).toBe('');
    const html = renderHelpArticle(article([node], { image: { url: '/api/help/assets/' + 'a'.repeat(64), title: '" onerror="bad', contentType: 'image/png' } }), 'https://api.gerowallet.io');
    expect(html).toContain('https://api.gerowallet.io/api/help/assets/'); expect(html).toContain('&quot;'); expect(html).not.toContain('alt="" onerror=');
  });
});

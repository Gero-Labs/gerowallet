import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './renderMarkdown';

describe('renderMarkdown', () => {
  it('renders bold', () => {
    expect(renderMarkdown('**ADA:** 1,516')).toBe('<p><strong>ADA:</strong> 1,516</p>');
  });

  it('renders a bullet list', () => {
    expect(renderMarkdown('- GERO: 7,747\n- SNEK: 1,265')).toBe(
      '<ul><li>GERO: 7,747</li><li>SNEK: 1,265</li></ul>',
    );
  });

  it('renders a numbered list', () => {
    expect(renderMarkdown('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
  });

  it('renders inline code', () => {
    expect(renderMarkdown('pool `pool12vscr8i`')).toBe('<p>pool <code>pool12vscr8i</code></p>');
  });

  it('renders headings', () => {
    expect(renderMarkdown('## Tokens')).toBe('<div class="md-h md-h2">Tokens</div>');
  });

  it('renders an http(s) link but never javascript: urls', () => {
    expect(renderMarkdown('[Gero](https://gerowallet.io)')).toBe(
      '<p><a href="https://gerowallet.io" target="_blank" rel="noopener noreferrer">Gero</a></p>',
    );
    // non-http scheme is left as escaped literal text, never an anchor
    const evil = renderMarkdown('[x](javascript:alert(1))');
    expect(evil).not.toMatch(/<a /);
    expect(evil).toMatch(/javascript:alert/);
  });

  it('escapes HTML so injected markup cannot execute (XSS)', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)> and <script>bad()</script>');
    expect(out).not.toMatch(/<img/);
    expect(out).not.toMatch(/<script/);
    expect(out).toMatch(/&lt;img/);
    expect(out).toMatch(/&lt;script&gt;/);
  });

  it('keeps code content escaped', () => {
    expect(renderMarkdown('`<b>hi</b>`')).toBe('<p><code>&lt;b&gt;hi&lt;/b&gt;</code></p>');
  });

  it('separates paragraphs on a blank line and joins wrapped lines with <br>', () => {
    expect(renderMarkdown('line one\nline two\n\npara two')).toBe(
      '<p>line one<br>line two</p><p>para two</p>',
    );
  });
});

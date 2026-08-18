import { describe, expect, it } from 'vitest';
import { iconForUrl, parseSafeUrl, safeExternalHref, socialBrandOf, toSafeLinks } from '@/shared/utils/externalLink';

describe('parseSafeUrl', () => {
  it('accepts http and https', () => {
    expect(parseSafeUrl('https://github.com/foo')?.hostname).toBe('github.com');
    expect(parseSafeUrl('http://example.com')?.hostname).toBe('example.com');
  });

  it('rejects non-web schemes', () => {
    for (const raw of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'chrome-extension://abc/options.html',
    ]) {
      expect(parseSafeUrl(raw), raw).toBeUndefined();
    }
  });

  it('rejects non-strings and unparseable input', () => {
    for (const raw of [undefined, null, 42, {}, [], '', 'not a url', '/relative/path']) {
      expect(parseSafeUrl(raw)).toBeUndefined();
    }
  });
});

describe('safeExternalHref', () => {
  it('returns a normalized href for safe links', () => {
    expect(safeExternalHref('https://github.com/foo')).toBe('https://github.com/foo');
  });

  it('returns undefined for unsafe links', () => {
    expect(safeExternalHref('javascript:alert(1)')).toBeUndefined();
  });
});

describe('socialBrandOf', () => {
  it('matches exact hosts and subdomains', () => {
    expect(socialBrandOf('https://github.com/foo')).toBe('github');
    expect(socialBrandOf('https://www.youtube.com/watch?v=1')).toBe('youtube');
    expect(socialBrandOf('https://youtu.be/1')).toBe('youtube');
    expect(socialBrandOf('https://x.com/foo')).toBe('x');
    expect(socialBrandOf('https://twitter.com/foo')).toBe('x');
    expect(socialBrandOf('https://t.me/foo')).toBe('telegram');
    expect(socialBrandOf('https://www.linkedin.com/in/foo')).toBe('linkedin');
    expect(socialBrandOf('https://instagram.com/foo')).toBe('instagram');
    expect(socialBrandOf('https://discord.com/invite/foo')).toBe('discord');
  });

  it('is case-insensitive on the host', () => {
    expect(socialBrandOf('https://GitHub.COM/foo')).toBe('github');
  });

  // The reason this module exists: a substring test hands an attacker the brand icon.
  it('does not match a brand domain that only appears elsewhere in the URL', () => {
    for (const raw of [
      'https://evil.example/?github.com',
      'https://evil.example/github.com',
      'https://evil.example/#https://github.com',
      'https://github.com.evil.example/foo',
      'https://notgithub.com/foo',
      'https://evil.example/?u=youtube.com',
    ]) {
      expect(socialBrandOf(raw), raw).toBeUndefined();
    }
  });

  it('returns undefined for unsafe links', () => {
    expect(socialBrandOf('javascript:alert("github.com")')).toBeUndefined();
  });
});

describe('iconForUrl', () => {
  it('maps known brands and falls back to a generic glyph', () => {
    expect(iconForUrl('https://github.com/foo')).toBe('mdi-github');
    expect(iconForUrl('https://youtu.be/1')).toBe('mdi-youtube');
    expect(iconForUrl('https://example.com')).toBe('mdi-link');
    expect(iconForUrl('https://evil.example/?github.com')).toBe('mdi-link');
    expect(iconForUrl('javascript:alert(1)')).toBe('mdi-link');
  });

  it('has no icon of its own for brands rendered as images', () => {
    // x / telegram render a logo <v-img>, so they fall through to the generic glyph.
    expect(iconForUrl('https://x.com/foo')).toBe('mdi-link');
    expect(iconForUrl('https://t.me/foo')).toBe('mdi-link');
  });
});

describe('toSafeLinks', () => {
  it('drops entries that are not safe web URLs', () => {
    const links = [
      { uri: 'https://github.com/foo' },
      { uri: 'javascript:alert(1)' },
      { uri: 'not a url' },
      { uri: null },
      {},
      null,
      { uri: 'https://x.com/foo' },
    ];
    expect(toSafeLinks(links)).toEqual([
      { href: 'https://github.com/foo', brand: 'github', icon: 'mdi-github' },
      { href: 'https://x.com/foo', brand: 'x', icon: 'mdi-link' },
    ]);
  });

  it('returns an empty array for missing or non-array input', () => {
    expect(toSafeLinks(undefined)).toEqual([]);
    expect(toSafeLinks(null)).toEqual([]);
    expect(toSafeLinks('https://github.com')).toEqual([]);
  });
});

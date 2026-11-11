import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/shared/utils/renderMarkdown';
import { bodyLinkAllowed, splitBody } from './announcementBody';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const media = [{ sha256: A }];

describe('splitBody', () => {
  it('lifts an image on a line of its own out of the prose', () => {
    expect(splitBody(`Intro.\n\n![The new screen](media:${A})\n\nMore text.`, media)).toEqual([
      { kind: 'prose', markdown: 'Intro.\n' },
      { kind: 'image', sha256: A, alt: 'The new screen' },
      { kind: 'prose', markdown: '\nMore text.' },
    ]);
  });

  it('accepts an empty alt, surrounding spaces and Windows line endings', () => {
    expect(splitBody(`a\r\n  ![](media:${A})  \r\nb`, media)).toEqual([
      { kind: 'prose', markdown: 'a' },
      { kind: 'image', sha256: A, alt: '' },
      { kind: 'prose', markdown: 'b' },
    ]);
  });

  it('leaves a hash the document does not list as text', () => {
    const body = `![x](media:${B})`;
    expect(splitBody(body, media)).toEqual([{ kind: 'prose', markdown: body }]);
  });

  it('leaves an inline image, a remote image and a list item as text', () => {
    for (const body of [`See ![x](media:${A}) here`, '![x](https://evil.test/pixel.png)', `- ![x](media:${A})`, `> ![x](media:${A})`]) {
      expect(splitBody(body, media)).toEqual([{ kind: 'prose', markdown: body }]);
    }
  });

  it('never makes an image the renderer would draw: what stays is literal text', () => {
    const [segment] = splitBody(`![x](media:${B}) and ![y](https://evil.test/p.png)`, media);
    const html = renderMarkdown(segment && segment.kind === 'prose' ? segment.markdown : '', { emphasis: true, linkAllowed: bodyLinkAllowed });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a ');
  });

  it('gives nothing for an empty body', () => {
    expect(splitBody('', media)).toEqual([]);
    expect(splitBody('\n \n', media)).toEqual([]);
  });
});

describe('bodyLinkAllowed', () => {
  it('allows the sites of Gero over https and nothing else', () => {
    expect(bodyLinkAllowed('https://gerowallet.io/blog/post')).toBe(true);
    expect(bodyLinkAllowed('https://support.gerowallet.io/help?x=1&y=2')).toBe(true);
    for (const url of ['http://gerowallet.io/', 'https://gerowallet.io.evil.test/', 'https://gerowallet.io@evil.test/', 'https://evil.test/gerowallet.io', 'https://gerowallet.io:8443/']) {
      expect(bodyLinkAllowed(url)).toBe(false);
    }
  });

  it('unlinks a disallowed link in a rendered body and keeps its words', () => {
    const html = renderMarkdown('Read [the guide](https://gerowallet.io/guide) or [claim now](https://gero-airdrop.test/).', { emphasis: true, linkAllowed: bodyLinkAllowed });
    expect(html).toContain('<a href="https://gerowallet.io/guide"');
    expect(html).toContain('or claim now.');
    expect(html).not.toContain('gero-airdrop');
  });
});

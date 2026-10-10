import { describe, expect, it } from 'vitest';
import { addHeadingIds } from './helpToc';

describe('article headings', () => {
  it('gives each h2 a stable positional id and lists it for the rail', () => {
    const html = '<h2>Before you start</h2><p>Text</p><h2>Steps <b>now</b></h2><ol><li><p>One</p></li></ol><h3>Sub</h3><h2></h2>';
    const first = addHeadingIds(html);
    expect(first.headings).toEqual([{ id: 'help-section-1', text: 'Before you start' }, { id: 'help-section-2', text: 'Steps now' }]);
    expect(first.html).toContain('<h2 id="help-section-1">Before you start</h2>');
    expect(first.html).toContain('<h2 id="help-section-2">Steps <b>now</b></h2>');
    expect(first.html).toContain('<h3>Sub</h3>');
    expect(addHeadingIds(html)).toEqual(first);
  });
  it('leaves an article without headings, or without markup, untouched', () => {
    expect(addHeadingIds('<p>Only a paragraph</p>')).toEqual({ html: '<p>Only a paragraph</p>', headings: [] });
    expect(addHeadingIds('')).toEqual({ html: '', headings: [] });
  });
  it('never turns escaped text into markup', () => {
    const { html } = addHeadingIds('<h2>&lt;img src=x onerror=alert(1)&gt;</h2>');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });
});

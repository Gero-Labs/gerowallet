import { describe, it, expect } from 'vitest';
import { renderMarkdown, referenceMarkerIndex, REFERENCE_MARKER_ATTR } from './renderMarkdown';

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

// CIP-108 proposal bodies are real documents, not captions. A census of the 12
// newest mainnet actions found tables in 7, h4+ in 4, nested lists in 3 and
// horizontal rules in 2 — every construct below is one a real proposal ships,
// and each was rendering as literal punctuation before.
describe('renderMarkdown, governance document constructs', () => {
  it('renders headings down to h6, not just h3', () => {
    expect(renderMarkdown('#### Alignment with G.1')).toBe(
      '<div class="md-h md-h4">Alignment with G.1</div>',
    );
    expect(renderMarkdown('###### Deep')).toBe('<div class="md-h md-h6">Deep</div>');
    // Seven hashes is not a heading in any dialect; it stays literal.
    expect(renderMarkdown('####### Nope')).toBe('<p>####### Nope</p>');
  });

  it('renders a horizontal rule', () => {
    expect(renderMarkdown('above\n\n---\n\nbelow')).toBe('<p>above</p><hr><p>below</p>');
    expect(renderMarkdown('***')).toBe('<hr>');
    expect(renderMarkdown('___')).toBe('<hr>');
  });

  it('renders a blockquote, whose marker survived HTML escaping as &gt;', () => {
    expect(renderMarkdown('> quoted claim')).toBe('<blockquote><p>quoted claim</p></blockquote>');
  });

  it('nests a list by indentation instead of flattening it', () => {
    expect(renderMarkdown('- outer\n  - inner\n- second')).toBe(
      '<ul><li>outer<ul><li>inner</li></ul></li><li>second</li></ul>',
    );
  });

  it('renders a pipe table inside its own scroll box', () => {
    const out = renderMarkdown('| Item | Ada |\n| --- | --- |\n| Audit | 120,000 |');
    expect(out).toBe(
      '<div class="md-table"><table>' +
        '<thead><tr><th>Item</th><th>Ada</th></tr></thead>' +
        '<tbody><tr><td>Audit</td><td>120,000</td></tr></tbody>' +
        '</table></div>',
    );
  });

  it('leaves a pipe line alone when no separator row follows it', () => {
    expect(renderMarkdown('a | b')).toBe('<p>a | b</p>');
  });

  it('marks up a [n] marker only when the caller says that index exists', () => {
    const options = { hasReference: (n: number) => n <= 2 };
    const out = renderMarkdown('See [1] and [2] and [9].', options);
    expect(out).toContain(`<button type="button" class="md-ref" ${REFERENCE_MARKER_ATTR}="1">[1]</button>`);
    expect(out).toContain(`<button type="button" class="md-ref" ${REFERENCE_MARKER_ATTR}="2">[2]</button>`);
    // No reference at index 9, so no invented destination.
    expect(out).toContain('[9]');
    expect(out).not.toContain(`${REFERENCE_MARKER_ATTR}="9"`);
  });

  it('leaves every [n] marker literal when the caller resolves nothing', () => {
    expect(renderMarkdown('See [1].')).toBe('<p>See [1].</p>');
  });
});

// The wallet runs a HASH-MODE router. A `#gov-ref-2` href is not a
// same-document jump here: it overwrites the route in the address bar, and a
// reload of that address hits the catch-all and lands on the wallet home with
// the proposal gone. So the marker is a real button and the view scrolls.
describe('renderMarkdown, [n] markers are controls and not fragment links', () => {
  const options = { hasReference: () => true };

  it('never emits a fragment href, and never an inline handler', () => {
    const out = renderMarkdown('See [2].', options);
    expect(out).not.toContain('href');
    expect(out).not.toMatch(/\bon[a-z]+=/i);
    expect(out).toContain('<button type="button"');
  });

  it('emits a natively focusable control, so Enter and Space work without a key handler', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('See [2].', options);
    const marker = el.querySelector('button.md-ref') as HTMLButtonElement;
    expect(marker).toBeTruthy();
    expect(marker.type).toBe('button');
    expect(marker.textContent).toBe('[2]');
    // The bracket glyphs are the non-colour cue; the accessible name is the
    // marker itself, as a printed footnote reference reads.
    expect(marker.getAttribute(REFERENCE_MARKER_ATTR)).toBe('2');
  });

  it('resolves the index from any node inside the marker, and from nothing else', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('See [2] and plain text.', options);
    const marker = el.querySelector('button.md-ref') as HTMLElement;
    expect(referenceMarkerIndex(marker)).toBe(2);
    expect(referenceMarkerIndex(el)).toBeNull();
    expect(referenceMarkerIndex(null)).toBeNull();
  });
});

// Both of these are output corruption inside a renderer whose whole contract is
// that nothing an author wrote reaches the DOM as markup.
describe('renderMarkdown, inline pass ordering', () => {
  it('does not splice a marker into the href of a link whose URL contains [12]', () => {
    // Real shape: an archive permalink carrying a bracketed section number.
    const out = renderMarkdown('See [the note](https://example.test/doc[12].pdf) please.', {
      hasReference: () => true,
    });
    expect(out).toBe(
      '<p>See <a href="https://example.test/doc[12].pdf" target="_blank" rel="noopener noreferrer">' +
        'the note</a> please.</p>',
    );
    // The href must be intact: no control, and no raw template text, inside it.
    expect(out).not.toContain(`<button type="button" class="md-ref" ${REFERENCE_MARKER_ATTR}="12">`);
  });

  it('still marks up a real [n] alongside such a link', () => {
    const out = renderMarkdown('[doc](https://example.test/a[3]b) and [3].', { hasReference: () => true });
    expect(out).toContain('href="https://example.test/a[3]b"');
    expect(out).toContain(`${REFERENCE_MARKER_ATTR}="3">[3]</button>`);
    // Exactly one control: the one outside the link.
    expect(out.match(/<button/g)).toHaveLength(1);
  });

  it('leaves a markdown image as literal text instead of an anchor with a stray "!"', () => {
    // A remote <img> in wallet chrome is a tracking pixel and a CSP question,
    // and silently turning an embed into an outbound link would manufacture a
    // destination the author never wrote as one.
    const out = renderMarkdown('![Budget chart](https://example.test/chart.png)');
    expect(out).toBe('<p>![Budget chart](https://example.test/chart.png)</p>');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('<img');
  });

  it('keeps a plain link working next to an image', () => {
    const out = renderMarkdown('![alt](https://a.test/x.png) then [real](https://b.test/)');
    expect(out).toContain('![alt](https://a.test/x.png)');
    expect(out).toContain('<a href="https://b.test/" target="_blank" rel="noopener noreferrer">real</a>');
  });
});

// The inline pass parks each finished fragment in a numbered slot so no later
// rule can reach inside it, and puts them all back at the end. A slot that is
// still parked when the string leaves is a raw token in the DOM, which is both
// a visible defect (the fragment it stood for is simply gone) and a claim the
// renderer's own contract makes: the only tags in the output are its own.
describe('renderMarkdown, no internal placeholder survives to the output', () => {
  it('renders a linked image as an anchor whose text is the literal image markdown', () => {
    // `[![alt](img)](href)` — a linked banner or logo, ordinary in CIP-108
    // bodies. Both rules apply as written: the image degrades to literal text,
    // and the anchor the author DID write survives with that text inside it.
    // No destination is invented, and no <img> is fetched.
    const out = renderMarkdown('[![Gero logo](https://img.test/logo.png)](https://gerowallet.io/)');
    expect(out).toBe(
      '<p><a href="https://gerowallet.io/" target="_blank" rel="noopener noreferrer">' +
        '![Gero logo](https://img.test/logo.png)</a></p>',
    );
    expect(out).not.toContain('<img');
    expect(out).not.toMatch(/md-slot-/);
  });

  it('restores every slot when they nest several deep', () => {
    // code inside bold inside link text, with an image beside it: the image
    // slot ends up INSIDE the link slot, which is the nesting the old
    // inner-last restore order assumed could not happen.
    const out = renderMarkdown('[**bold `code`** and ![img](https://i.test/x.png)](https://h.test/)');
    expect(out).toBe(
      '<p><a href="https://h.test/" target="_blank" rel="noopener noreferrer">' +
        '<strong>bold <code>code</code></strong> and ![img](https://i.test/x.png)</a></p>',
    );
  });

  it('leaves no token behind for any nesting of code, bold, image, link and [n]', () => {
    const shapes = [
      '[![alt](https://i.test/a.png)](https://h.test/)',
      '[read `pool1abc`](https://a.test/)',
      '**[bolded link](https://a.test/)**',
      '[**bold text**](https://a.test/)',
      '`[1] inside code`',
      '![alt with [2] inside](https://i.test/a.png)',
      '[link text with [2]](https://a.test/) and [2] outside',
      '| [![a](https://i.test/a.png)](https://h.test/) | `x` |\n| --- | --- |\n| [2] | ok |',
      '> [![a](https://i.test/a.png)](https://h.test/)',
      '#### [![a](https://i.test/a.png)](https://h.test/)',
      '- [![a](https://i.test/a.png)](https://h.test/)',
    ];
    for (const shape of shapes) {
      const out = renderMarkdown(shape, { hasReference: () => true });
      expect(out, shape).not.toMatch(/md-slot-/);
      // Nothing in the output may look like a token of any generation.
      expect(out, shape).not.toMatch(/<md-[a-z]+-\d+>/);
    }
  });

  it('cannot be handed a forged token by the author, whatever it is spelled like', () => {
    // The token is angle-bracketed precisely because escaping has already
    // removed every `<` the author wrote, so a proposal that types one gets it
    // back as visible text — it can neither collect a real fragment nor
    // disappear.
    const out = renderMarkdown('`real` then <md-slot-0> and <md-code-0>');
    expect(out).toBe('<p><code>real</code> then &lt;md-slot-0&gt; and &lt;md-code-0&gt;</p>');
  });

  it('keeps a forged token literal even as the text of a real link', () => {
    const out = renderMarkdown('[<md-slot-0>](https://a.test/) and `code`');
    expect(out).toBe(
      '<p><a href="https://a.test/" target="_blank" rel="noopener noreferrer">&lt;md-slot-0&gt;</a>' +
        ' and <code>code</code></p>',
    );
  });

  it('never expands a substitution pattern an author wrote into a fragment', () => {
    // `$&`, `$'`, `` $` `` and `$1` are special ONLY in a replacement string. A
    // stored fragment is part author text, so putting one back with
    // `replace(token, fragment)` would splice surrounding document text in at
    // those spellings. Escaping does not cover this: only `&` of the four is an
    // escaped character, and `$&amp;` still opens with `$&`.
    expect(renderMarkdown('head `$&` tail')).toBe('<p>head <code>$&amp;</code> tail</p>');
    expect(renderMarkdown("a `$'` b `$1` c")).toBe("<p>a <code>$'</code> b <code>$1</code> c</p>");
    // `` $` `` cannot sit in a code span, so link text carries that one.
    expect(renderMarkdown('[a $` b](https://a.test/)')).toBe(
      '<p><a href="https://a.test/" target="_blank" rel="noopener noreferrer">a $` b</a></p>',
    );
    // And where the fragment is restored INTO another fragment rather than into
    // the document — a code span inside link text.
    expect(renderMarkdown("[see `$&` and `$'`](https://a.test/)")).toBe(
      '<p><a href="https://a.test/" target="_blank" rel="noopener noreferrer">' +
        "see <code>$&amp;</code> and <code>$'</code></a></p>",
    );
  });
});

// A reference marker inside LINK TEXT used to cost the anchor outright: the
// link pattern could not cross the inner `]`, so the line stayed literal text
// with a pressable button sitting in the middle of it.
describe('renderMarkdown, a [n] marker inside link text', () => {
  const options = { hasReference: () => true };

  it('keeps the anchor and leaves the marker as text inside it', () => {
    const out = renderMarkdown('See [see note [2] here](https://example.test) please.', options);
    expect(out).toBe(
      '<p>See <a href="https://example.test" target="_blank" rel="noopener noreferrer">' +
        'see note [2] here</a> please.</p>',
    );
  });

  it('never nests a control inside the anchor', () => {
    // Two interactive controls, one inside the other, is an accessibility
    // defect however the click handling is wired.
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('[see note [2] here](https://example.test)', options);
    const anchor = el.querySelector('a') as HTMLAnchorElement;
    expect(anchor).toBeTruthy();
    expect(anchor.textContent).toBe('see note [2] here');
    expect(el.querySelectorAll('a button, a a')).toHaveLength(0);
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });

  it('still marks up the same marker where it stands outside a link', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('[see note [2] here](https://example.test) and [2].', options);
    expect(el.querySelectorAll('a')).toHaveLength(1);
    // Exactly one control, and it is not inside the anchor.
    expect(el.querySelectorAll('button.md-ref')).toHaveLength(1);
    expect(el.querySelectorAll('a button')).toHaveLength(0);
  });

  it('claims one level of nesting and no more, leaving a deeper shape literal', () => {
    // Not a regression: `[a [b [c] d] e](url)` rendered as literal text before
    // too. It is here so the pattern's limit is a stated outcome rather than a
    // surprise, and so nobody reads the fix as full bracket balancing.
    const out = renderMarkdown('[a [b [c] d] e](https://x.test/)', options);
    expect(out).toBe('<p>[a [b [c] d] e](https://x.test/)</p>');
  });

  it('does not let a bracketed alt turn an image into an anchor with a stray "!"', () => {
    // The alt tolerates the same one level of brackets the link text does, so
    // the image rule still matches first and the whole thing stays literal.
    const out = renderMarkdown('![a[1]b](https://x.test/i.png)', options);
    expect(out).toBe('<p>![a[1]b](https://x.test/i.png)</p>');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('<button');
  });
});

// The header above REFERENCE_MARKER_ATTR names three attribute values that vary
// with author input and gives each a reason. A reason nothing checks is a
// comment the next reader will relax. These enforce the two that are shaped by
// a pattern rather than by escaping.
describe('renderMarkdown, the author-derived attribute values keep their shape', () => {
  it('writes nothing but digits into the reference attribute', () => {
    const out = renderMarkdown('See [7] and [999].', { hasReference: () => true });
    const values = [...out.matchAll(new RegExp(`${REFERENCE_MARKER_ATTR}="([^"]*)"`, 'g'))].map(m => m[1]);
    expect(values).toEqual(['7', '999']);
    // The claim is not "it is escaped", it is that a quote, a space or a letter
    // cannot occur in it at all — that is what makes interpolating it safe.
    for (const value of values) expect(value).toMatch(/^\d{1,3}$/);
  });

  it('does not treat a four-digit marker as a marker at all', () => {
    // `\d{1,3}` is the constraint the digits-only claim rests on, so the far
    // side of it is worth pinning too: no attribute is written, and the text
    // survives intact rather than being silently truncated to three digits.
    const out = renderMarkdown('See [1000].', { hasReference: () => true });
    expect(out).toBe('<p>See [1000].</p>');
    expect(out).not.toContain(REFERENCE_MARKER_ATTR);
  });

  it('writes nothing but a level 1..6 into the heading class', () => {
    // `lvl` is the LENGTH of a `#{1,6}` run, never a substring of author text.
    for (let lvl = 1; lvl <= 6; lvl += 1) {
      expect(renderMarkdown(`${'#'.repeat(lvl)} T`)).toBe(`<div class="md-h md-h${lvl}">T</div>`);
    }
    // Seven hashes is not a heading, so no class is built from it.
    expect(renderMarkdown('####### T')).toBe('<p>####### T</p>');
  });
});

// Not an injection — the value stays escaped and stays quoted — but the
// destination stops being the author's. A wallet that sends someone to a URL
// nobody wrote is the same class of defect as one that renders a tag nobody
// wrote.
describe('renderMarkdown, a URL cannot absorb constructed markup', () => {
  it('does not fold a code span in the URL into the href', () => {
    const out = renderMarkdown('[t](https://a.test/`x`)');
    // The link does not form: the reader is sent nowhere, rather than to
    // `https://a.test/<code>x</code>`.
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('href');
    expect(out).toContain('x');
  });

  it('does not fold bold in the URL into the href', () => {
    const out = renderMarkdown('[t](https://a.test/**y**.png)');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('href');
    expect(out).toContain('y');
  });

  it('never emits an href containing a tag, whatever the URL was spelled like', () => {
    const shapes = [
      '[t](https://a.test/`x`)',
      '[t](https://a.test/**y**.png)',
      '[t](https://a.test/`a`/**b**/c)',
      '[t](https://a.test/x) then [u](https://b.test/`z`)',
    ];
    for (const shape of shapes) {
      const out = renderMarkdown(shape, { hasReference: () => true });
      expect(out, shape).not.toMatch(/href="[^"]*[<>]/);
      expect(out, shape).not.toMatch(/md-slot-/);
    }
  });

  it('still links every URL that is only unusual, not corrupted', () => {
    // `<`/`>` are the only characters this excludes, and an author who types
    // one has `&lt;` here — so nothing an author can write loses its link.
    const out = renderMarkdown('[a](https://a.test/doc[12].pdf) [b](https://b.test/x?q=1&y=2) [c](https://c.test/a<b)');
    expect(out).toContain('href="https://a.test/doc[12].pdf"');
    expect(out).toContain('href="https://b.test/x?q=1&amp;y=2"');
    expect(out).toContain('href="https://c.test/a&lt;b"');
    expect(out.match(/<a /g)).toHaveLength(3);
  });
});

/** Deepest chain of block containers in a rendered document. */
function maxBlockNesting(html: string): number {
  const root = document.createElement('div');
  root.innerHTML = html;
  let max = 0;
  const walk = (node: Element, depth: number): void => {
    const next = /^(BLOCKQUOTE|UL|OL)$/.test(node.tagName) ? depth + 1 : depth;
    if (next > max) max = next;
    for (const child of Array.from(node.children)) walk(child, next);
  };
  for (const child of Array.from(root.children)) walk(child, 0);
  return max;
}

// renderBlocks recursed once per blockquote level and renderList once per
// indentation level, both driven by author text: `'> '.repeat(5000)` threw
// RangeError. The throw lands inside the computed that renders a proposal body,
// so a crafted action blanked the proposal view for everyone who opened it.
describe('renderMarkdown, nesting depth is bounded', () => {
  it('survives a blockquote nested thousands deep, with the text still in the output', () => {
    const out = renderMarkdown(`${'> '.repeat(5000)}ruinous`);
    expect(out).toContain('ruinous');
    // Capped, not unbounded — and the quote markers past the cap are visible
    // text rather than dropped content.
    expect((out.match(/<blockquote>/g) ?? []).length).toBeLessThanOrEqual(16);
    expect(out).toContain('&gt;');
  });

  it('survives a list indented thousands deep, keeping every single item', () => {
    const lines: string[] = [];
    for (let i = 0; i < 5000; i += 1) lines.push(`${' '.repeat(i)}- item${i}`);
    const out = renderMarkdown(lines.join('\n'));
    expect((out.match(/<li>/g) ?? []).length).toBe(5000);
    expect(out).toContain('item0');
    expect(out).toContain('item4999');
    expect((out.match(/<ul>/g) ?? []).length).toBeLessThanOrEqual(16);
  });

  it('leaves nesting a real document reaches exactly as it was', () => {
    expect(renderMarkdown('> > deep enough')).toBe(
      '<blockquote><blockquote><p>deep enough</p></blockquote></blockquote>',
    );
    expect(renderMarkdown('- a\n  - b\n    - c')).toBe(
      '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>',
    );
    // A list inside a quote, the deepest shape the mainnet census found.
    expect(renderMarkdown('> - a\n>   - b')).toBe(
      '<blockquote><ul><li>a<ul><li>b</li></ul></li></ul></blockquote>',
    );
  });

  // Each case above drives ONE construct to the cap. The budget is shared
  // between them precisely because they share a call stack, and it is a MIXED
  // document that decides whether the sharing is real — so these two exercise
  // the shapes the single-construct cases cannot reach.
  it('spends one shared budget across a blockquote and the list inside it', () => {
    const bare: string[] = [];
    const quoted: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      bare.push(`${' '.repeat(i * 2)}- item${i}`);
      quoted.push(`> ${' '.repeat(i * 2)}- item${i}`);
    }
    const bareOut = renderMarkdown(bare.join('\n'));
    const quotedOut = renderMarkdown(quoted.join('\n'));

    // Nothing throws, and no item is dropped for being over-indented.
    expect((quotedOut.match(/<li>/g) ?? []).length).toBe(2000);
    expect(quotedOut).toContain('item0');
    expect(quotedOut).toContain('item1999');

    // The quote SPENDS a level the list then does not get: 16 list levels bare,
    // 15 wrapped in one blockquote. A per-construct budget would hand out 16
    // either way, and the whole chain would be 17 deep.
    expect((bareOut.match(/<ul>/g) ?? []).length).toBe(16);
    expect((quotedOut.match(/<blockquote>/g) ?? []).length).toBe(1);
    expect((quotedOut.match(/<ul>/g) ?? []).length).toBe(15);
    expect(maxBlockNesting(quotedOut)).toBe(16);
  });

  it('caps alternating quote and list levels, keeping the text past the cap', () => {
    // `> - a`, `> > - b`, `> > > - c`: every level opens a quote AND the list
    // inside it, so the two constructs interleave all the way down.
    const shallow: string[] = [];
    const deep: string[] = [];
    for (let k = 1; k <= 500; k += 1) shallow.push(`${'> '.repeat(k)}- item${k}`);
    for (let k = 1; k <= 2000; k += 1) deep.push(`${'> '.repeat(k)}- item${k}`);

    const shallowOut = renderMarkdown(shallow.join('\n'));
    const deepOut = renderMarkdown(deep.join('\n'));

    // The container chain stops in the same place whether the author wrote 500
    // levels or 2000: bounded by the cap, not by the document. One over the cap
    // is the innermost list itself — a list emits its own `<ul>` at whatever
    // depth it is entered, and only its NESTED levels consult the budget.
    expect((shallowOut.match(/<blockquote>/g) ?? []).length).toBe(16);
    expect((deepOut.match(/<blockquote>/g) ?? []).length).toBe(16);
    expect(maxBlockNesting(deepOut)).toBe(maxBlockNesting(shallowOut));
    expect(maxBlockNesting(deepOut)).toBeLessThanOrEqual(17);

    // Content past the cap is kept, as the visible text it already was.
    expect(deepOut).toContain('item1');
    expect(deepOut).toContain('item2000');
    expect(deepOut).toContain('&gt;');
  });
});

// The depth cap covers author-driven RECURSION. It does not cover author-driven
// REPETITION, and `restoreSlots` used to be quadratic in exactly that: it walked
// the slot table and split the WHOLE document once per slot, O(slots x
// document). A flat body — no nesting anywhere — carrying a few thousand inline
// constructs froze the proposal view just as the RangeError did, and anyone can
// submit a governance action. Resolving each slot once, in ascending order,
// makes the work follow total content instead of the product of the two.
describe('renderMarkdown, slot restoration is linear in the document', () => {
  const LINES = 8000;

  it('renders a large flat body well inside a generous time bound', () => {
    const lines: string[] = [];
    for (let i = 0; i < LINES; i += 1) {
      // Four lifted-or-marked constructs per line, and no blank lines: the
      // whole document is ONE paragraph, so it is one `renderInline` call over
      // one slot table — the shape the old cost model punished hardest.
      lines.push(
        `Item ${i} spends \`pool1abc${i}\` on [work ${i}](https://a.test/${i}), **${i}** ada. [1]`,
      );
    }
    const body = lines.join('\n');

    const started = performance.now();
    const out = renderMarkdown(body, { hasReference: () => true });
    const elapsed = performance.now() - started;

    // Measured on this machine: ~2.9s for a QUARTER of this document under the
    // quadratic restore, so roughly 11s at 8000 lines; ~12ms after. The bound
    // sits two orders of magnitude above the linear cost, so a loaded CI box
    // cannot flake it, and far below the quadratic one.
    expect(elapsed).toBeLessThan(2000);

    // And it did the work: a "fix" that got fast by rendering less must fail.
    expect(out.match(/<code>/g)).toHaveLength(LINES);
    expect(out.match(/<a /g)).toHaveLength(LINES);
    expect(out.match(/<strong>/g)).toHaveLength(LINES);
    expect(out.match(/<button/g)).toHaveLength(LINES);
    expect(out).not.toMatch(/md-slot-/);
  });
});

// A separate cost model from the slot table, and it survived that fix: an
// UNCLOSED destination used to make the link and image patterns consume to the
// end of the document, fail to find `)`, backtrack the whole tail, then pay for
// it again at the next `[`. Measured before the bound: 8.1s at 512 KB of
// `[a](https://a.test/`, and 39s at 928 KB. A proposal body arrives from the API
// with no length cap and is rendered in a computed, so that froze the view for
// anyone opening a governance action anyone could submit.
describe('renderMarkdown, a malformed body cannot blow up the cost', () => {
  /** `unit` repeated to fill `kb` kilobytes. */
  function fill(unit: string, kb: number): string {
    return unit.repeat(Math.ceil((kb * 1024) / unit.length));
  }

  // Both bad shapes: an unclosed link destination and an unclosed image one.
  // The image pattern is the more expensive of the two, since its destination
  // bound must stay a superset of the link's.
  it.each([
    ['an unclosed link destination', '[a](https://a.test/'],
    ['an unclosed image destination', '![a](x'],
  ])('stays linear on %s', (_label, unit) => {
    // Quadratic cost quadruples per doubling; linear cost doubles. Comparing
    // the two sizes rather than asserting a wall-clock number keeps this from
    // flaking on a loaded machine: a slow box slows both halves equally.
    const small = fill(unit, 128);
    const large = fill(unit, 512); // 4x the input

    const t1 = performance.now();
    renderMarkdown(small);
    const smallMs = performance.now() - t1;

    const t2 = performance.now();
    renderMarkdown(large);
    const largeMs = performance.now() - t2;

    // Linear predicts ~4x, quadratic ~16x. 8x sits between them with room for
    // timer noise on a tiny `smallMs`, and the floor keeps a near-zero
    // measurement from making the ratio meaningless.
    expect(largeMs / Math.max(smallMs, 0.5)).toBeLessThan(8);
  });

  it('still renders a well-formed body of the same size', () => {
    const out = renderMarkdown(fill('[a](https://a.test/x) ', 128));
    // The bound may only cost the shapes that were already unparseable.
    expect((out.match(/<a /g) ?? []).length).toBeGreaterThan(1000);
  });

  // The bound sits on the part AFTER the scheme, because `https?://` is matched
  // separately, so the longest url that still links is scheme + 2048.
  const HOST = 'a.test/';
  function url(afterScheme: number): string {
    return `https://${HOST}${'x'.repeat(afterScheme - HOST.length)}`;
  }

  it('links a maximum-length url, and keeps an over-long one as literal text', () => {
    expect(renderMarkdown(`[t](${url(2048)})`)).toMatch(/<a /);

    // One character past the bound: no anchor, and the text is still shown
    // rather than dropped, which is the same outcome any unparseable link had.
    const out = renderMarkdown(`[t](${url(2049)})`);
    expect(out).not.toMatch(/<a /);
    expect(out).toContain('[t](');
  });

  it('keeps the image pattern a superset of the link pattern at the bounds', () => {
    // The invariant `INLINE_TEXT` documents: whatever `[…](…)` the link rule
    // could match, the image rule lifts the `![…](…)` spelling of first, so a
    // maximum-size linked image stays literal instead of becoming an anchor
    // with a stray "!" in front of it. This is the case that would break first
    // if the image bounds were ever tightened to equal the link's.
    const out = renderMarkdown(`![${'a'.repeat(1024)}](${url(2048)})`);
    expect(out).not.toMatch(/<a /);
    expect(out).toContain('![');
  });
});

// Governance metadata is authored by whoever submitted the action — anyone can
// submit one. These cases pin the escape-first contract for every construct the
// governance surface added, because a table cell or a quote must not become an
// injection vector the way a paragraph never was.
// Governance rationales are prose and use `_word_` freely: a real Cardano
// Foundation rationale rendered a literal `_NOTE on 'Internal Voting':_` in the
// wallet. Emphasis is opt-in so chat about tokens keeps its underscores.
describe('renderMarkdown, opt-in emphasis', () => {
  it('leaves underscores and asterisks literal by default', () => {
    const out = renderMarkdown("_NOTE on 'Internal Voting':_ and *aside*");
    expect(out).not.toMatch(/<em>/);
    expect(out).toContain('_NOTE');
    expect(out).toContain('*aside*');
  });

  it('renders both spellings as emphasis when the caller opts in', () => {
    const out = renderMarkdown('_constitutional_ and *unconstitutional*', { emphasis: true });
    expect(out).toContain('<em>constitutional</em>');
    expect(out).toContain('<em>unconstitutional</em>');
  });

  it('keeps intra-word underscores literal even with emphasis on', () => {
    // The whole reason emphasis was excluded: these must never become markup.
    const out = renderMarkdown('SNEK_ADA pairs with some_field_name and pool_id_hex', {
      emphasis: true,
    });
    expect(out).not.toMatch(/<em>/);
    expect(out).toContain('SNEK_ADA');
    expect(out).toContain('some_field_name');
  });

  it('does not treat a lone or unclosed mark as emphasis', () => {
    const out = renderMarkdown('a _lone underscore and 3 * 4 = 12', { emphasis: true });
    expect(out).not.toMatch(/<em>/);
  });

  it('leaves bold intact and does not double-wrap it', () => {
    const out = renderMarkdown('**bold** then _em_', { emphasis: true });
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>em</em>');
    expect(out).not.toMatch(/<em>\s*<\/em>/);
  });

  it('still escapes author content inside emphasis', () => {
    const out = renderMarkdown('_<script>steal()</script>_', { emphasis: true });
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('&lt;script&gt;');
  });

  it('does not format inside a code span', () => {
    const out = renderMarkdown('`_not_ emphasis`', { emphasis: true });
    expect(out).toContain('<code>_not_ emphasis</code>');
  });

  it('stays linear on a body full of stray underscores', () => {
    const unit = 'a _b '.repeat(1);
    const small = unit.repeat(4000);
    const large = unit.repeat(16000);
    const t1 = performance.now();
    renderMarkdown(small, { emphasis: true });
    const smallMs = performance.now() - t1;
    const t2 = performance.now();
    renderMarkdown(large, { emphasis: true });
    const largeMs = performance.now() - t2;
    // 4x the input: linear predicts ~4x, quadratic ~16x.
    expect(largeMs / Math.max(smallMs, 0.5)).toBeLessThan(8);
  });
});

describe('renderMarkdown, untrusted-author safety', () => {
  it('renders an embedded script, an onerror attribute and a javascript: url inert', () => {
    const out = renderMarkdown(
      '<script>steal()</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))',
    );
    expect(out).not.toMatch(/<script/i);
    // No element carries the handler: `onerror=` may only survive as visible
    // text inside an escaped `&lt;img …&gt;`, never as a real attribute.
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/<[a-z][^>]*onerror/i);
    expect(out).not.toMatch(/<a /);
    // Every one of them survives as visible, escaped text instead.
    expect(out).toContain('&lt;script&gt;steal()&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('javascript:alert');
  });

  it('keeps table cells escaped', () => {
    const out = renderMarkdown('| a | b |\n| --- | --- |\n| <img src=x onerror=alert(1)> | ok |');
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('<td>&lt;img src=x onerror=alert(1)&gt;</td>');
  });

  it('keeps blockquote and heading content escaped', () => {
    expect(renderMarkdown('> <script>x</script>')).toContain('&lt;script&gt;');
    expect(renderMarkdown('#### <script>x</script>')).toContain('&lt;script&gt;');
  });

  it('cannot be tricked into forging a code-span placeholder', () => {
    // The placeholder is spelled with angle brackets precisely because escaping
    // has already removed every `<` the author wrote.
    const out = renderMarkdown('<md-code-0> and `real`');
    expect(out).toContain('&lt;md-code-0&gt;');
    expect(out).toContain('<code>real</code>');
  });
});

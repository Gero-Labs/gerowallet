// The bug these cases exist for: the previous version zipped a FILTERED link
// array back against references[i], so one ipfs:// entry slid every subsequent
// label onto the wrong link. Nothing in the sampled mainnet data triggered it,
// which is exactly why it needed pinning rather than eyeballing.
import { describe, it, expect } from 'vitest';
import { hasReferenceIndex, referenceElementId, toReferenceLinks } from './references';

describe('toReferenceLinks', () => {
  it('keeps each label with its own href', () => {
    const links = toReferenceLinks([
      { uri: 'https://a.test/one', label: '[1] First' },
      { uri: 'https://b.test/two', label: '[2] Second' },
    ]);
    expect(links.map(l => [l.href, l.label])).toEqual([
      ['https://a.test/one', '[1] First'],
      ['https://b.test/two', '[2] Second'],
    ]);
  });

  it('does not slide labels when an unsafe reference is dropped', () => {
    const links = toReferenceLinks([
      { uri: 'ipfs://QmSomething', label: '[1] IPFS doc' },
      { uri: 'https://b.test/two', label: '[2] Second' },
      { uri: 'https://c.test/three', label: '[3] Third' },
    ]);
    expect(links).toHaveLength(2);
    expect(links[0].label).toBe('[2] Second');
    expect(links[1].label).toBe('[3] Third');
    // The survivors keep their ORIGINAL positions, so a [2] marker in the prose
    // still lands on the entry its author numbered 2.
    expect(links.map(l => l.number)).toEqual([2, 3]);
  });

  it('drops every non-http scheme, including javascript:', () => {
    const links = toReferenceLinks([
      { uri: 'javascript:alert(1)', label: 'evil' },
      { uri: 'mailto:a@b.test', label: 'mail' },
      { uri: 'not a url', label: 'junk' },
      { uri: 'https://ok.test/', label: 'fine' },
    ]);
    expect(links.map(l => l.label)).toEqual(['fine']);
  });

  it('falls back to the hostname on an EMPTY-STRING label, which this data really has', () => {
    const links = toReferenceLinks([{ uri: 'https://adastat.net/governances/59fd', label: '' }]);
    expect(links[0].label).toBe('adastat.net');
  });

  it('falls back to the hostname when the label is absent entirely', () => {
    expect(toReferenceLinks([{ uri: 'https://cips.cardano.org/cps/CPS-0020' }])[0].label).toBe(
      'cips.cardano.org',
    );
  });

  it('brands on the parsed hostname, never on a substring', () => {
    // `https://evil.example/?github.com` must not wear the GitHub icon: the
    // icon would then vouch for a site it has nothing to do with.
    expect(toReferenceLinks([{ uri: 'https://github.com/a' }])[0].icon).toBe('mdi-github');
    expect(toReferenceLinks([{ uri: 'https://evil.example/?github.com' }])[0].icon).toBe('mdi-link');
  });

  it('handles a missing references array', () => {
    expect(toReferenceLinks(null)).toEqual([]);
    expect(toReferenceLinks(undefined)).toEqual([]);
  });
});

describe('hasReferenceIndex', () => {
  it('accepts only the markers that have a surviving reference', () => {
    const has = hasReferenceIndex(
      toReferenceLinks([
        { uri: 'ipfs://dropped', label: 'one' },
        { uri: 'https://b.test/', label: 'two' },
      ]),
    );
    // [1] was dropped as unsafe, so its marker stays literal rather than being
    // repointed at some other author's document — or rendered as a control that
    // would do nothing when pressed.
    expect(has(1)).toBe(false);
    expect(has(2)).toBe(true);
    expect(has(9)).toBe(false);
  });
});

describe('referenceElementId', () => {
  // Deliberately never used as an href: the extension's router is hash-mode, so
  // `#gov-ref-2` is read as a ROUTE, not as a same-document fragment.
  it('is the original index, so a gap left by a dropped entry is preserved', () => {
    const links = toReferenceLinks([
      { uri: 'ipfs://dropped', label: 'one' },
      { uri: 'https://b.test/', label: 'two' },
    ]);
    expect(links.map(link => referenceElementId(link.number))).toEqual(['gov-ref-2']);
  });
});

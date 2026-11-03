// The lookalike warning (R8). No NFT verified flag exists in any data source, so the page warns
// when the collection it is showing has the name of a top-200 collection under another policy
// id. Names are compared case-insensitively with the ends trimmed; nothing else is folded, so
// the warning never fires on a mere resemblance.
import { describe, expect, it } from 'vitest';
import { candidateNames, collectionFieldOf, findLookalike, normalizeCollectionName, nameStem } from './lookalike';

const REAL = 'aa'.repeat(28);
const COPY = 'bb'.repeat(28);
const TOP = [
  { policyId: REAL, name: 'SpaceBudz' },
  { policyId: 'cc'.repeat(28), name: 'Clay Nation' },
  { policyId: 'dd'.repeat(28) },
];

describe('normalizeCollectionName', () => {
  it('trims and lower-cases', () => {
    expect(normalizeCollectionName('  SpaceBudz \n')).toBe('spacebudz');
  });

  it('leaves the inside of a name alone', () => {
    expect(normalizeCollectionName('Space  Budz')).toBe('space  budz');
  });

  it('folds compatibility forms: a name in fullwidth letters, or with a ligature, is the name', () => {
    expect(normalizeCollectionName('\uFF33\uFF50\uFF41\uFF43\uFF45\uFF22\uFF55\uFF44\uFF5A')).toBe('spacebudz');
    expect(normalizeCollectionName('Of\uFB01ce Cats')).toBe('office cats');
  });

  it('drops the characters that show nothing: zero-width, word joiner, BOM and the bidi controls', () => {
    for (const hidden of ['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF', '\u200E', '\u200F', '\u202A', '\u202B', '\u202C', '\u202D', '\u202E']) {
      expect(normalizeCollectionName(`Space${hidden}Budz`), `U+${hidden.charCodeAt(0).toString(16)}`).toBe('spacebudz');
      expect(normalizeCollectionName(`${hidden}SpaceBudz${hidden}`)).toBe('spacebudz');
    }
  });

  it('still trims the ends, after the hidden characters are gone', () => {
    expect(normalizeCollectionName(' \u200B SpaceBudz \uFEFF ')).toBe('spacebudz');
  });

  // Not folded, on purpose: a Cyrillic "a" looks like a Latin one and is a different letter. A
  // confusable table is a different feature; the policy ID shown beside every name is the
  // protection against what this does not catch.
  it('does not fold letters of another script that only look alike', () => {
    expect(normalizeCollectionName('Sp\u0430ceBudz')).not.toBe('spacebudz');
  });

  it('is empty for anything that is not text', () => {
    for (const value of [undefined, null, 4, {}]) expect(normalizeCollectionName(value)).toBe('');
  });
});

describe('nameStem', () => {
  it('drops the serial an NFT carries after the collection name', () => {
    expect(nameStem('SpaceBudz #1234')).toBe('SpaceBudz');
    expect(nameStem('SpaceBudz#7')).toBe('SpaceBudz');
    expect(nameStem('Cat 42')).toBe('Cat');
    expect(nameStem('Cat42')).toBe('Cat');
    expect(nameStem('Clay Nation_0007')).toBe('Clay Nation');
  });

  it('leaves a name with no serial, and one that is only a number', () => {
    expect(nameStem('Clay Nation')).toBe('Clay Nation');
    expect(nameStem('1234')).toBe('1234');
  });
});

describe('collectionFieldOf', () => {
  it('reads the collection or project an NFT names, at the top of its metadata or in its attributes', () => {
    expect(collectionFieldOf({ name: 'SpaceBudz #1', collection: 'SpaceBudz' })).toBe('SpaceBudz');
    expect(collectionFieldOf({ Project: 'Clay Nation' })).toBe('Clay Nation');
    expect(collectionFieldOf({ attributes: { CollectionName: 'Cool Cats' } })).toBe('Cool Cats');
    expect(collectionFieldOf({ attributes: { project: 'Cool Cats' } })).toBe('Cool Cats');
  });

  it('never takes the NFT\'s own name for the collection', () => {
    expect(collectionFieldOf({ name: 'SpaceBudz #1' })).toBeUndefined();
  });

  it('is nothing for metadata that has no such field or holds something other than text', () => {
    for (const metadata of [undefined, null, 'x', 4, {}, { collection: 7 }, { collection: ['a'] }, { attributes: 'x' }, { collection: '  ' }]) {
      expect(collectionFieldOf(metadata), JSON.stringify(metadata)).toBeUndefined();
    }
  });
});

describe('candidateNames', () => {
  it('collects the held name, each NFT\'s collection field and the stem of each NFT name, once each', () => {
    expect(
      candidateNames({
        held: 'Cool Cats',
        items: [
          { name: 'SpaceBudz #1', collection: 'SpaceBudz' },
          { name: 'SpaceBudz #2' },
          { name: '' },
          {},
        ],
      }),
    ).toEqual(['Cool Cats', 'SpaceBudz']);
  });

  it('is empty when nothing names the collection', () => {
    expect(candidateNames({ items: [] })).toEqual([]);
  });
});

describe('findLookalike', () => {
  it('finds the popular collection a name copies, with its policy id', () => {
    expect(findLookalike(['SpaceBudz'], COPY, TOP)).toEqual({ name: 'SpaceBudz', policyId: REAL });
  });

  it('finds a copy whose name hides a zero-width character, is typed in fullwidth letters or starts with a BOM', () => {
    for (const name of ['Space\u200BBudz', '\uFF33\uFF50\uFF41\uFF43\uFF45\uFF22\uFF55\uFF44\uFF5A', '\uFEFFSpaceBudz', 'Space\u202EBudz']) {
      expect(findLookalike([name], COPY, TOP), JSON.stringify(name)).toEqual({ name: 'SpaceBudz', policyId: REAL });
    }
  });

  it('finds the copy through the stem of an NFT name that hides a zero-width character', () => {
    expect(findLookalike(candidateNames({ items: [{ name: 'Space\u200BBudz #12' }] }), COPY, TOP)).toEqual({ name: 'SpaceBudz', policyId: REAL });
  });

  it('ignores case and the spaces around the name', () => {
    expect(findLookalike(['  SPACEBUDZ '], COPY, TOP)).toEqual({ name: 'SpaceBudz', policyId: REAL });
    expect(findLookalike(['clay nation'], COPY, TOP)).toEqual({ name: 'Clay Nation', policyId: 'cc'.repeat(28) });
  });

  it('is not fooled into more: another spelling is not a match', () => {
    expect(findLookalike(['Space Budz'], COPY, TOP)).toBeNull();
    expect(findLookalike(['SpaceBudz 2'], COPY, TOP)).toBeNull();
  });

  it('does not warn about a collection against itself', () => {
    expect(findLookalike(['SpaceBudz'], REAL, TOP)).toBeNull();
  });

  it('compares policy ids without regard to case', () => {
    expect(findLookalike(['SpaceBudz'], REAL.toUpperCase(), TOP)).toBeNull();
  });

  it('warns when the collection\'s name is shared by another popular collection under a different policy, even if it is popular itself', () => {
    const top = [...TOP, { policyId: COPY, name: 'SpaceBudz' }];
    expect(findLookalike(['SpaceBudz'], COPY, top)).toEqual({ name: 'SpaceBudz', policyId: REAL });
  });

  it('takes the first match in the order given (the list is ranked by volume)', () => {
    const top = [{ policyId: 'ee'.repeat(28), name: 'Same' }, { policyId: 'ff'.repeat(28), name: 'same' }];
    expect(findLookalike(['SAME'], COPY, top)?.policyId).toBe('ee'.repeat(28));
  });

  it('never matches an empty name, a nameless entry or an empty list', () => {
    expect(findLookalike(['', '   '], COPY, [{ policyId: REAL, name: '' }, { policyId: REAL }])).toBeNull();
    expect(findLookalike(['SpaceBudz'], COPY, [])).toBeNull();
    expect(findLookalike([], COPY, TOP)).toBeNull();
  });
});

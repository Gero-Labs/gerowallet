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

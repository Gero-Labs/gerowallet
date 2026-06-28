import { describe, it, expect } from 'vitest';
import { buildRefs } from './refBuilder';
import type { CopilotCategoryFlags } from './preferences';

const cats = (over: Partial<CopilotCategoryFlags> = {}): CopilotCategoryFlags => ({
  bags: true,
  watchlist: true,
  whales: false,
  launches: false,
  governance: false,
  ...over,
});

// walletStore.tokens is keyed BY unit (the object key IS the assetId/unit).
const tokens = {
  lovelace: {},
  uSNEK: { metadata: { ticker: 'SNEK' } },
  uGERO: { name: 'GeroToken' },
};

describe('buildRefs', () => {
  it('builds held + watched refs, excludes lovelace, dedupes across loops', () => {
    // uSNEK is both held and watchlisted -> appears once, as held
    const refs = buildRefs(tokens as never, ['uSNEK', 'uWATCH'], cats());
    expect(refs).toEqual([
      { unit: 'uSNEK', ticker: 'SNEK', held: true },
      { unit: 'uGERO', ticker: 'GeroToken', held: true },
      { unit: 'uWATCH', ticker: 'uWATCH', held: false },
    ]);
  });

  it('bags off -> no held refs, watched refs intact', () => {
    const refs = buildRefs(tokens as never, ['uWATCH'], cats({ bags: false }));
    expect(refs).toEqual([{ unit: 'uWATCH', ticker: 'uWATCH', held: false }]);
  });

  it('watchlist off -> no watched refs, held refs intact', () => {
    const refs = buildRefs(tokens as never, ['uWATCH'], cats({ watchlist: false }));
    expect(refs.every((r) => r.held)).toBe(true);
    expect(refs.find((r) => r.unit === 'uWATCH')).toBeUndefined();
  });

  it('both categories off -> empty', () => {
    expect(buildRefs(tokens as never, ['uWATCH'], cats({ bags: false, watchlist: false }))).toEqual(
      [],
    );
  });

  it('resolves ticker by precedence: metadata.ticker > name > metadata.name > unit prefix', () => {
    const t = {
      aaaaaaaaaa: { metadata: { ticker: 'TICK', name: 'MetaName' }, name: 'TopName' },
      bbbbbbbbbb: { name: 'TopName' },
      cccccccccc: { metadata: { name: 'MetaName' } },
      dddddddddd: {},
    };
    const refs = buildRefs(t as never, [], cats());
    expect(refs.map((r) => r.ticker)).toEqual(['TICK', 'TopName', 'MetaName', 'dddddd']);
  });

  it('excludes lovelace from the watchlist too', () => {
    const refs = buildRefs({} as never, ['lovelace', 'uX'], cats());
    expect(refs).toEqual([{ unit: 'uX', ticker: 'uX', held: false }]);
  });
});

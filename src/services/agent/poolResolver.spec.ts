// src/services/agent/poolResolver.spec.ts
import { describe, it, expect } from 'vitest';
import { createPoolResolver } from './poolResolver';

interface FakePoolItem {
  ticker: string;
  pool_id_bech32: string;
}

function makeFakeSearch(items: FakePoolItem[]) {
  return async (_symbol: string) => ({ items });
}

describe('createPoolResolver', () => {
  it('matches a pool by case-insensitive ticker and returns pool_id_bech32', async () => {
    const searchFn = makeFakeSearch([
      { ticker: 'GERO', pool_id_bech32: 'pool1gero123' },
      { ticker: 'ADAPOOLS', pool_id_bech32: 'pool1ada456' },
    ]);
    const resolve = createPoolResolver(searchFn);
    expect(await resolve('gero')).toBe('pool1gero123');
    expect(await resolve('GERO')).toBe('pool1gero123');
    expect(await resolve('adapools')).toBe('pool1ada456');
  });

  it('returns null when no ticker matches', async () => {
    const searchFn = makeFakeSearch([
      { ticker: 'GERO', pool_id_bech32: 'pool1gero123' },
    ]);
    const resolve = createPoolResolver(searchFn);
    expect(await resolve('SNEK')).toBeNull();
    expect(await resolve('')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { mergeSolanaHistory, searchSolanaHistory, solanaHistoryFromNexus } from './solanaHistory';

const sig = (c: string) => c.repeat(88);
const tx = (c: string, slot: number) => ({ signature: sig(c), slot, blockTime: 1731456000, success: true });

describe('solanaHistoryFromNexus', () => {
  it('keeps well-formed rows and drops the rest', () => {
    const rows = solanaHistoryFromNexus([
      { signature: sig('a'), slot: 10, blockTime: 1731456000, success: false, fee: 5000 },
      { signature: sig('b'), slot: 9, blockTime: null, success: true, fee: null },
      { signature: 'not-base58!', slot: 8 },
      { signature: sig('c'), slot: -1 },
      { signature: sig('d') },
      null,
    ]);
    expect(rows).toEqual([
      { signature: sig('a'), slot: 10, blockTime: 1731456000, success: false, fee: 5000 },
      { signature: sig('b'), slot: 9, blockTime: 0, success: true },
    ]);
  });

  it('reads nothing from a body that is not a list', () => {
    expect(solanaHistoryFromNexus({ signature: sig('a'), slot: 1 })).toEqual([]);
  });
});

describe('mergeSolanaHistory', () => {
  it('orders newest first and keeps the first copy of a signature', () => {
    const synced = { ...tx('a', 10), fee: 1 };
    expect(mergeSolanaHistory([synced, tx('b', 30)], [tx('a', 10), tx('c', 5)]).map((t) => [t.signature[0], t.slot]))
      .toEqual([['b', 30], ['a', 10], ['c', 5]]);
    expect(mergeSolanaHistory([synced], [tx('a', 10)])[0]).toBe(synced);
  });
});

describe('searchSolanaHistory', () => {
  it('matches part of a signature, ignoring case', () => {
    const rows = [tx('a', 1), tx('B', 2)];
    expect(searchSolanaHistory(rows, ' bbb ').map((t) => t.slot)).toEqual([2]);
    expect(searchSolanaHistory(rows, '')).toHaveLength(2);
  });
});

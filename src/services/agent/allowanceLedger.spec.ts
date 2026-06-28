import { describe, it, expect } from 'vitest';
import { recordSpend, spentInWindow, spentTotal } from './allowanceLedger';
import type { SpendRecord } from './allowancePolicy';

const record = (ts: number, amountLovelace: bigint): SpendRecord => ({ ts, amountLovelace });

describe('recordSpend', () => {
  it('prepends the new record so the ledger is newest-first', () => {
    const existing: SpendRecord[] = [record(1000, 5_000000n)];
    const result = recordSpend(existing, record(2000, 3_000000n), 10);
    expect(result[0].ts).toBe(2000);
    expect(result[1].ts).toBe(1000);
  });

  it('caps to maxRecords by dropping the oldest entries beyond the cap', () => {
    const existing: SpendRecord[] = [
      record(3000, 1n),
      record(2000, 2n),
      record(1000, 3n),
    ];
    const result = recordSpend(existing, record(4000, 4n), 3);
    expect(result).toHaveLength(3);
    expect(result[0].ts).toBe(4000);
    expect(result[1].ts).toBe(3000);
    expect(result[2].ts).toBe(2000);
    // oldest (ts=1000) should be dropped
  });

  it('does not mutate the original ledger', () => {
    const existing: SpendRecord[] = [record(1000, 5_000000n)];
    recordSpend(existing, record(2000, 3_000000n), 10);
    expect(existing).toHaveLength(1);
  });

  it('works with an empty ledger', () => {
    const result = recordSpend([], record(1000, 5_000000n), 5);
    expect(result).toHaveLength(1);
    expect(result[0].ts).toBe(1000);
  });
});

describe('spentInWindow', () => {
  it('sums only records at or after sinceTs using exact bigint arithmetic', () => {
    const ledger: SpendRecord[] = [
      record(5000, 10_000000n),
      record(3000, 7_000000n),
      record(1000, 2_000000n), // before sinceTs=2000, excluded
    ];
    const result = spentInWindow(ledger, 2000);
    expect(result).toBe(17_000000n);
  });

  it('includes records exactly at sinceTs', () => {
    const ledger: SpendRecord[] = [
      record(2000, 5_000000n),
      record(1999, 3_000000n),
    ];
    expect(spentInWindow(ledger, 2000)).toBe(5_000000n);
  });

  it('returns 0n for an empty ledger', () => {
    expect(spentInWindow([], 1000)).toBe(0n);
  });

  it('returns 0n when all records are older than sinceTs', () => {
    const ledger: SpendRecord[] = [record(500, 10_000000n)];
    expect(spentInWindow(ledger, 1000)).toBe(0n);
  });
});

describe('spentTotal', () => {
  it('sums all records using exact bigint arithmetic', () => {
    const ledger: SpendRecord[] = [
      record(1000, 10_000000n),
      record(2000, 20_000000n),
      record(3000, 5_000000n),
    ];
    expect(spentTotal(ledger)).toBe(35_000000n);
  });

  it('returns 0n for an empty ledger', () => {
    expect(spentTotal([])).toBe(0n);
  });

  it('handles a single record', () => {
    expect(spentTotal([record(1000, 99_000000n)])).toBe(99_000000n);
  });
});

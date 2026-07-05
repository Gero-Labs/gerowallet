import type { SpendRecord } from './allowancePolicy';

/**
 * Prepend `record` to `ledger` (newest-first order) and cap the result to
 * `maxRecords`, dropping the oldest entries that exceed the cap.
 * Returns a new array; never mutates the original ledger.
 */
export function recordSpend(
  ledger: SpendRecord[],
  record: SpendRecord,
  maxRecords: number,
): SpendRecord[] {
  return [record, ...ledger].slice(0, maxRecords);
}

/**
 * Sum the lovelace amounts for all records with `ts >= sinceTs`.
 * Uses exact bigint arithmetic.
 */
export function spentInWindow(ledger: SpendRecord[], sinceTs: number): bigint {
  let total = 0n;
  for (const r of ledger) {
    if (r.ts >= sinceTs) total += r.amountLovelace;
  }
  return total;
}

/**
 * Sum the lovelace amounts for ALL records in the ledger.
 * Uses exact bigint arithmetic.
 */
export function spentTotal(ledger: SpendRecord[]): bigint {
  let total = 0n;
  for (const r of ledger) total += r.amountLovelace;
  return total;
}

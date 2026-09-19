import { describe, expect, it } from 'vitest';
import { liveMidnightRow } from './midnightTxSelection';

const LEDGER = '58d446313ec1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5e450';
const USDM = 'aa'.repeat(32);
const row = (over: Record<string, unknown>) => ({ hash: LEDGER, token: USDM, status: 'pending', ...over });

describe('liveMidnightRow', () => {
  it('hands back the same object while the row is unchanged', () => {
    const selected = row({});
    expect(liveMidnightRow(selected, [row({ hash: 'other' }), selected])).toBe(selected);
  });

  it('follows the confirmed row that replaced the pending one, whatever the hash spelling', () => {
    // The 2026-09-16 screenshot: the list showed the confirmed row (block
    // height, block time) while the pane still rendered the clicked pending
    // object — "Pending", the typed amount, and a UTxO fetch that had failed
    // while the tx was unindexed.
    const clicked = row({ hash: `0x${LEDGER.toUpperCase()}` });
    const confirmed = row({ status: 'confirmed', blockHeight: 2_599_815 });
    expect(liveMidnightRow(clicked, [confirmed])).toBe(confirmed);
  });

  it('keeps two colors of one transaction apart', () => {
    const night = row({ token: 'NIGHT', status: 'confirmed' });
    expect(liveMidnightRow(row({}), [night])).toBeNull();
  });

  it('is null once the row is gone, so the pane empties instead of going stale', () => {
    expect(liveMidnightRow(row({}), [])).toBeNull();
  });
});

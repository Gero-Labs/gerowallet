import { describe, expect, it } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';
import { paymentUtxos, PENDING_SPEND_WINDOW_MS, pendingSpentRefs, withoutPendingSpends } from './pendingSpends';

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const txId = (n: number) => n.toString(16).padStart(64, '0');
const utxo = (n: number, index = 0) =>
  [{ txId: txId(n), index }, { address: 'addr_test1own', value: { coins: 2_000_000n } }] as unknown as Cardano.Utxo;
const pendingTx = (inputs: Array<[number, number]>, submittedMs = NOW - 60_000, pending = true) => ({
  pending,
  tx_timestamp: Math.floor(submittedMs / 1000),
  body: { inputs: inputs.map(([n, index]) => ({ txId: txId(n), index })) },
});

describe('withoutPendingSpends', () => {
  it('drops the UTxOs a pending transaction spends', () => {
    const kept = withoutPendingSpends([utxo(1), utxo(2), utxo(3)], [pendingTx([[2, 0]])], NOW);
    expect(kept.map(([txIn]) => txIn.txId)).toEqual([txId(1), txId(3)]);
  });

  it('matches the output index, not just the transaction', () => {
    const kept = withoutPendingSpends([utxo(1, 0), utxo(1, 1)], [pendingTx([[1, 1]])], NOW);
    expect(kept.map(([txIn]) => txIn.index)).toEqual([0]);
  });

  it('hides a UTxO whose pending input carries the index as a string', () => {
    const kept = withoutPendingSpends(
      [utxo(1, 0), utxo(2, 0)],
      [{ pending: true, tx_timestamp: Math.floor((NOW - 60_000) / 1000), body: { inputs: [{ txId: txId(1), index: '0' }] } }],
      NOW,
    );
    expect(kept.map(([txIn]) => txIn.txId)).toEqual([txId(2)]);
  });

  it('ignores confirmed transactions', () => {
    const set = [utxo(1)];
    expect(withoutPendingSpends(set, [pendingTx([[1, 0]], NOW - 60_000, false)], NOW)).toBe(set);
  });

  it('frees the inputs of a transaction older than its validity window', () => {
    const set = [utxo(1)];
    expect(withoutPendingSpends(set, [pendingTx([[1, 0]], NOW - PENDING_SPEND_WINDOW_MS - 1000)], NOW)).toBe(set);
  });

  it('returns the same array when nothing is pending, so callers keep their identity checks', () => {
    const set = [utxo(1), utxo(2)];
    expect(withoutPendingSpends(set, [], NOW)).toBe(set);
    expect(withoutPendingSpends(set, undefined, NOW)).toBe(set);
  });

  it('skips malformed records instead of throwing', () => {
    const records = [
      null, {}, { pending: true }, { pending: true, tx_timestamp: 'soon' },
      { pending: true, tx_timestamp: NOW / 1000, body: { inputs: [null, { txId: 'x' }] } },
    ];
    expect(pendingSpentRefs(records as never, NOW).size).toBe(0);
  });
});

describe('paymentUtxos', () => {
  it('leaves out the collateral and what a pending transaction spends', () => {
    const kept = paymentUtxos([utxo(1), utxo(2), utxo(3)], utxo(3), [pendingTx([[1, 0]])], NOW);
    expect(kept.map(([txIn]) => txIn.txId)).toEqual([txId(2)]);
  });

  it('pays from the collateral when it is all the wallet has', () => {
    const kept = paymentUtxos([utxo(1)], utxo(1), [], NOW);
    expect(kept).toHaveLength(1);
  });

  it('keeps everything with no collateral and nothing pending', () => {
    const all = [utxo(1), utxo(2)];
    expect(paymentUtxos(all, null, [], NOW)).toBe(all);
  });
});

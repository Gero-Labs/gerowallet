import { describe, expect, it, vi } from 'vitest';
import {
  PENDING_EXPIRY_MS, canLookUpPending, checkPendingTx, isUnconfirmedPending, keptRowsToCheck, notIncludedAfterReset, pendingRowsToKeep,
} from './midnightPendingSends';
import { historyHashForSubmittedTx } from './midnightTxHash';
import { awaitSubmittedTx } from '@/api/midnightSubmitRecovery';
import type { MidnightTransaction } from './midnightTypes';

const row = (hash: string, status: MidnightTransaction['status'], timestamp: number, extra: Partial<MidnightTransaction> = {}): MidnightTransaction => ({
  hash, type: 'send', token: 'NIGHT', amount: 1_000_000n, counterparty: 'mn_addr1to', timestamp, status, fee: 0n, isShielded: false, ...extra,
});

describe('"Not confirmed"', () => {
  it('a pending row past 30 minutes, or one kept through a reset; never a fresh or a confirmed one', () => {
    expect(isUnconfirmedPending(row('a', 'pending', 1), PENDING_EXPIRY_MS)).toBe(false);
    expect(isUnconfirmedPending(row('a', 'pending', 1), PENDING_EXPIRY_MS + 1)).toBe(true);
    expect(isUnconfirmedPending(row('a', 'pending', 0), PENDING_EXPIRY_MS * 9)).toBe(false); // no send time
    expect(isUnconfirmedPending(row('a', 'pending', 1_000, { beforeReset: { at: 2_000, upgrade: false } }), 2_000)).toBe(true);
    expect(isUnconfirmedPending(row('a', 'confirmed', 1), PENDING_EXPIRY_MS * 4)).toBe(false);
  });
});

describe('which hash a pending row is keyed by', () => {
  it('only a ledger-hash row can be looked up (Check again), checked after a reset, or listed as not included', () => {
    const ledger = row('aa', 'pending', 1, { ledgerHash: true, beforeReset: { at: 5, upgrade: true } });
    const extrinsic = row('bb', 'pending', 1, { beforeReset: { at: 5, upgrade: true } });
    expect(canLookUpPending(ledger)).toBe(true);
    expect(canLookUpPending(extrinsic)).toBe(false);
    expect(keptRowsToCheck([ledger, extrinsic])).toEqual([ledger]);
    // An extrinsic-hash row is never "not found", so never in the card: it stays "Not confirmed".
    expect(notIncludedAfterReset([extrinsic])).toEqual([]);
    expect(isUnconfirmedPending(extrinsic, 6)).toBe(true);
  });

  it('a submit whose reply named the ledger hash is keyed by it; one that did not, by the extrinsic hash', () => {
    expect(historyHashForSubmittedTx({ txHash: '0xEXT1', ledgerTxHash: '0xLEDGER' })).toBe('ledger');
    expect(historyHashForSubmittedTx({ txHash: '0xEXT1' })).toBe('ext1');
  });

  it('the lost-reply lookup by identifier is unaffected: what it recovers carries the ledger hash', async () => {
    const graphql = vi.fn().mockResolvedValue({ transactions: [{ __typename: 'RegularTransaction', hash: '0xABCD', transactionResult: { status: 'SUCCESS' } }] });
    const recovered = await awaitSubmittedTx('id-1', { graphql, sleep: async () => undefined });
    expect(graphql).toHaveBeenCalledWith(expect.stringContaining('offset: {identifier: $id}'), { id: 'id-1' });
    expect(recovered.ledgerTxHash).toBe('abcd');
    expect(historyHashForSubmittedTx(recovered)).toBe('abcd');
  });
});

describe('a chain reset', () => {
  it('keeps only pending rows, marked with the reset and its cause; an earlier mark stays', () => {
    const kept = pendingRowsToKeep([
      row('a', 'pending', 1, { ledgerHash: true }),
      row('b', 'confirmed', 2),
      row('c', 'pending', 3, { beforeReset: { at: 50, upgrade: false } }),
    ], 100, true);
    expect(kept.map((tx) => tx.hash)).toEqual(['a', 'c']);
    expect(kept[0]).toMatchObject({ beforeReset: { at: 100, upgrade: true }, ledgerHash: true });
    expect(kept[1].beforeReset).toEqual({ at: 50, upgrade: false });
  });

  it('a kept row is listed as not included only once the lookup after the rebuild did not find it', () => {
    const kept = row('a', 'pending', 1, { ledgerHash: true, beforeReset: { at: 1_000, upgrade: true } });
    expect(notIncludedAfterReset([kept])).toEqual([]);
    const notFound = { ...kept, beforeReset: { at: 1_000, upgrade: true, notFound: true } };
    expect(notIncludedAfterReset([notFound])).toEqual([notFound]);
    expect(keptRowsToCheck([notFound])).toEqual([]);
    expect(notIncludedAfterReset([{ ...notFound, status: 'confirmed' }])).toEqual([]);
  });
});

describe('Check again', () => {
  const found = (status: string) => ({ transactions: [{ __typename: 'RegularTransaction', hash: '0xAB', transactionResult: { status } }] });

  it('asks the indexer by ledger hash and reads its answer', async () => {
    const graphql = vi.fn().mockResolvedValue(found('SUCCESS'));
    await expect(checkPendingTx(graphql, '0xABCD')).resolves.toBe('confirmed');
    expect(graphql).toHaveBeenCalledWith(expect.stringContaining('offset: {hash: $hash}'), { hash: 'abcd' });
    await expect(checkPendingTx(vi.fn().mockResolvedValue(found('PARTIAL_SUCCESS')), 'ab')).resolves.toBe('confirmed');
    await expect(checkPendingTx(vi.fn().mockResolvedValue(found('FAILURE')), 'ab')).resolves.toBe('failed');
  });

  it('nothing found, or no answer, is "still not confirmed"', async () => {
    await expect(checkPendingTx(vi.fn().mockResolvedValue({ transactions: [] }), 'ab')).resolves.toBe('notFound');
    await expect(checkPendingTx(vi.fn().mockRejectedValue(new Error('down')), 'ab')).resolves.toBe('notFound');
  });
});

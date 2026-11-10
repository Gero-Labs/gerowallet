import { describe, expect, it, vi } from 'vitest';
import {
  LOOKUP_MARGIN_MS, LOOKUP_MAX_RETRIES, PENDING_EXPIRY_MS, SEND_TTL_MS, canLookUpPending, checkPendingTx, isUnconfirmedPending,
  keptRowsRetryDelay, keptRowsToCheck, notIncludedAfterReset, pendingLookupDeadline, pendingRowsToKeep,
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
    // Only a row the lookup could have asked about.
    expect(notIncludedAfterReset([{ ...notFound, ledgerHash: undefined }])).toEqual([]);
  });
});

describe('the lookup', () => {
  // Sent at T; the indexer's latest block at `tip` (epoch ms, as the indexer sends it).
  const T = 1_800_000_000_000;
  const sent = row('ab', 'pending', T, { ledgerHash: true });
  const reply = (transactions: unknown[], tip: number | null = T + 60 * 60_000) => ({
    transactions, ...(tip === null ? {} : { block: { height: 10, timestamp: tip } }),
  });
  const found = (status: string | null) => reply([{ __typename: 'RegularTransaction', hash: '0xAB', transactionResult: status ? { status } : null }]);
  const ask = (data: unknown, tx = sent) => checkPendingTx(vi.fn().mockResolvedValue(data), tx);

  it('asks the indexer by ledger hash, with its latest block, and reads its answer', async () => {
    const graphql = vi.fn().mockResolvedValue(found('SUCCESS'));
    // A row for another hash is not this send.
    await expect(checkPendingTx(graphql, { ...sent, hash: '0xABCD' })).resolves.toBe('notFound');
    expect(graphql).toHaveBeenCalledWith(expect.stringContaining('offset: {hash: $hash}'), { hash: 'abcd' });
    expect(graphql.mock.calls[0][0]).toContain('block { height timestamp }');
    await expect(ask(found('SUCCESS'))).resolves.toBe('confirmed');
    await expect(ask(found('PARTIAL_SUCCESS'))).resolves.toBe('confirmed');
    await expect(ask(found('FAILURE'))).resolves.toBe('failed');
  });

  it('a row with the hash but no result yet is found, not "not found"', async () => {
    await expect(ask(found(null))).resolves.toBe('waiting');
    await expect(ask(reply([{ __typename: 'RegularTransaction', hash: 'ab' }]))).resolves.toBe('waiting');
  });

  it('a failed lookup is no answer: unknown, never not found', async () => {
    await expect(checkPendingTx(vi.fn().mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })), sent)).resolves.toBe('unknown');
    await expect(checkPendingTx(vi.fn().mockRejectedValue(new Error('Request failed with status code 501')), sent)).resolves.toBe('unknown');
    // An answer without a transactions list (a changed schema, an error body) can't say "not found".
    await expect(ask(null)).resolves.toBe('unknown');
    await expect(ask({ block: { height: 10, timestamp: T * 2 } })).resolves.toBe('unknown');
    await expect(ask({ transactions: 'nope' })).resolves.toBe('unknown');
  });

  it('not found only from an indexer past the send\'s time to live, plus a margin', async () => {
    const deadline = T + SEND_TTL_MS.unshielded + LOOKUP_MARGIN_MS;
    expect(pendingLookupDeadline(sent)).toBe(deadline);
    expect(pendingLookupDeadline({ ...sent, isShielded: true })).toBe(T + SEND_TTL_MS.shielded + LOOKUP_MARGIN_MS);
    await expect(ask(reply([], deadline))).resolves.toBe('waiting');
    await expect(ask(reply([], deadline + 1))).resolves.toBe('notFound');
    // The indexer's block time in seconds reads the same.
    await expect(ask(reply([], Math.ceil((deadline + 1_000) / 1000)))).resolves.toBe('notFound');
    // A shielded send lives longer.
    await expect(ask(reply([], deadline + 1), { ...sent, isShielded: true })).resolves.toBe('waiting');
    // No latest block in the answer: it can't tell.
    await expect(ask(reply([], null))).resolves.toBe('waiting');
  });

  it('tries again with a backoff, not before a too-early row\'s deadline, and stops after a few tries', () => {
    const now = T + 60_000;
    expect(keptRowsRetryDelay([sent], 0, true, now)).toBe(30_000);
    expect(keptRowsRetryDelay([sent], 2, true, now)).toBe(120_000);
    expect(keptRowsRetryDelay([sent], 5, true, now)).toBe(10 * 60_000);
    // Too early: wait for the deadline (but never more than 10 minutes).
    expect(keptRowsRetryDelay([sent], 0, false, now)).toBe(pendingLookupDeadline(sent) - now + 30_000);
    expect(keptRowsRetryDelay([{ ...sent, isShielded: true }], 0, false, now)).toBe(10 * 60_000);
    expect(keptRowsRetryDelay([sent], LOOKUP_MAX_RETRIES, true, now)).toBeNull();
    expect(keptRowsRetryDelay([], 0, true, now)).toBeNull();
  });
});

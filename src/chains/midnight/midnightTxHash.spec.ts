import { describe, expect, it } from 'vitest';
import { finalizedLedgerTxHash, historyHashForSubmittedTx, midnightTxRowKey, normalizeMidnightTxHash } from './midnightTxHash';

// The two hashes from the mainnet send that produced two history rows on
// 2026-09-16: the extrinsic hash the node returned, and the ledger hash the
// indexer reported for the same transaction.
const EXTRINSIC = '0xb12f2a03e5b1a7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2';
const LEDGER = '608a95f738c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7';

describe('normalizeMidnightTxHash', () => {
  it('folds case and drops the 0x prefix', () => {
    expect(normalizeMidnightTxHash('0xABCdef')).toBe('abcdef');
    expect(normalizeMidnightTxHash('ABCdef')).toBe('abcdef');
    expect(normalizeMidnightTxHash('0XABC')).toBe('abc');
  });

  it('is total over empty input', () => {
    expect(normalizeMidnightTxHash('')).toBe('');
    expect(normalizeMidnightTxHash(undefined as unknown as string)).toBe('');
  });
});

describe('finalizedLedgerTxHash', () => {
  it('reads transactionHash() off a finalized tx and normalizes it', () => {
    expect(finalizedLedgerTxHash({ transactionHash: () => LEDGER.toUpperCase() })).toBe(LEDGER);
    expect(finalizedLedgerTxHash({ transactionHash: () => `0x${LEDGER}` })).toBe(LEDGER);
  });

  it('is undefined for anything that cannot produce a hash, and never throws', () => {
    // The SDK throws on a proven-but-unbound tx ("Transaction hash is
    // available for proven, signed and bound transactions only"). Enriching a
    // history row must never turn a successful proof into a failure.
    expect(finalizedLedgerTxHash({ transactionHash: () => { throw new Error('bound only'); } })).toBeUndefined();
    expect(finalizedLedgerTxHash({ transactionHash: () => 42 })).toBeUndefined();
    expect(finalizedLedgerTxHash({ transactionHash: () => '' })).toBeUndefined();
    expect(finalizedLedgerTxHash({ transactionHash: () => '0x' })).toBeUndefined();
    expect(finalizedLedgerTxHash({ serialize: () => new Uint8Array() })).toBeUndefined();
    expect(finalizedLedgerTxHash(null)).toBeUndefined();
    expect(finalizedLedgerTxHash(undefined)).toBeUndefined();
  });
});

describe('historyHashForSubmittedTx', () => {
  it('keys the row on the ledger hash when the relay or the wallet produced one', () => {
    expect(historyHashForSubmittedTx({ txHash: EXTRINSIC, ledgerTxHash: `0x${LEDGER}` })).toBe(LEDGER);
    expect(historyHashForSubmittedTx({ txHash: EXTRINSIC, ledgerTxHash: LEDGER })).toBe(LEDGER);
  });

  it('falls back to the extrinsic hash for a relay that predates the field', () => {
    expect(historyHashForSubmittedTx({ txHash: EXTRINSIC })).toBe(EXTRINSIC.slice(2));
    expect(historyHashForSubmittedTx({ txHash: EXTRINSIC, ledgerTxHash: '' })).toBe(EXTRINSIC.slice(2));
  });

  it('produces the exact key gero-sync will deliver for the confirmed row', () => {
    // The dedupe in midnightStore is `normalize(hash)::token`; the indexer
    // hands hashes out bare and lowercase, so the pending row must match
    // that spelling for the confirmed row to replace it in place.
    expect(historyHashForSubmittedTx({ txHash: EXTRINSIC, ledgerTxHash: `0x${LEDGER.toUpperCase()}` }))
      .toBe(normalizeMidnightTxHash(LEDGER));
  });
});

describe('midnightTxRowKey', () => {
  it('folds the hash but keeps the token verbatim, so two colors of one tx stay distinct', () => {
    expect(midnightTxRowKey({ hash: `0x${LEDGER.toUpperCase()}`, token: 'NIGHT' })).toBe(`${LEDGER}::NIGHT`);
    expect(midnightTxRowKey({ hash: LEDGER, token: 'NIGHT' })).not.toBe(midnightTxRowKey({ hash: LEDGER, token: 'aa'.repeat(32) }));
  });
});

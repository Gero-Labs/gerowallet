// A transaction Gero submitted is stored in full while pending; Gero Sync may confirm it with a
// "thin" record (no CBOR yet). Replacing the stored record dropped the body, so a vote delegation
// read as a self transfer until a background heal (QA, issue 1518).
import { describe, expect, it } from 'vitest';
import { mergeTxRecord } from './txRecordMerge';

const BODY = { certificates: [{ __typename: 'VoteDelegationCertificate' }], fee: 180000n };
const pending = {
  id: 'tx1', tx_hash: 'tx1', pending: true, tx_timestamp: 100, block_height: 0,
  cbor: '84a4…', body: BODY, utxo: null,
};
const thinConfirmed = {
  id: 'tx1', tx_hash: 'tx1', pending: false, tx_timestamp: 120, block_height: 14244019,
  cbor: undefined, body: undefined, utxo: { inputs: [{ address: 'addr1me' }], outputs: [{ address: 'addr1me' }] },
};

describe('mergeTxRecord', () => {
  it('keeps the body it holds when a thin confirmed record replaces the pending one', () => {
    const merged = mergeTxRecord(pending, thinConfirmed);
    expect(merged.body).toBe(BODY);
    expect(merged.cbor).toBe('84a4…');
    // Everything the confirmation brings wins: status, time, block, UTxOs.
    expect(merged.pending).toBe(false);
    expect(merged.tx_timestamp).toBe(120);
    expect(merged.block_height).toBe(14244019);
    expect(merged.utxo).toEqual(thinConfirmed.utxo);
  });

  it('takes a full incoming record as it is', () => {
    const full = { ...thinConfirmed, cbor: '84a4…new', body: { ...BODY } };
    expect(mergeTxRecord(pending, full)).toBe(full);
  });

  it('stores a new record, or one replacing a record that had no body either, as it is', () => {
    expect(mergeTxRecord(undefined, thinConfirmed)).toBe(thinConfirmed);
    const thinPending = { ...pending, cbor: undefined, body: undefined };
    expect(mergeTxRecord(thinPending, thinConfirmed)).toBe(thinConfirmed);
  });
});

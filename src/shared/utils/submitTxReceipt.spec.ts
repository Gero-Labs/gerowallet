import { describe, expect, it } from 'vitest';
import { TX_SUBMIT_UNCONFIRMED_MESSAGE } from '@/chrome/config';
import { submittedTxId, UnconfirmedTxSubmission } from './submitTxReceipt';

describe('software submission receipt', () => {
  it('returns the acknowledged ID', async () => {
    await expect(submittedTxId(Promise.resolve({ data: { txId: ' confirmed ' } }))).resolves.toBe('confirmed');
  });

  it.each([
    undefined, {}, { data: { txId: 42 } }, { data: { txId: ' ' } },
    { error: 'The message port closed', data: { txId: 'stale' } },
    { data: { error: 42, txId: 'stale' } },
    { data: { error: TX_SUBMIT_UNCONFIRMED_MESSAGE, txId: 'stale' } },
  ])('marks a missing or contradictory receipt as unconfirmed', async reply => {
    await expect(submittedTxId(Promise.resolve(reply))).rejects.toBeInstanceOf(UnconfirmedTxSubmission);
  });

  it('distinguishes a lost reply from an explicit worker refusal', async () => {
    await expect(submittedTxId(Promise.reject(new Error('port closed')))).rejects.toBeInstanceOf(UnconfirmedTxSubmission);
    await expect(submittedTxId(Promise.resolve({ data: { error: 'BadInputsUTxO', txId: 'stale' } })))
      .rejects.toThrow('BadInputsUTxO');
  });
});

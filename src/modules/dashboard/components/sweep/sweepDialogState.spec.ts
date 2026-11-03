// The figures the sweep panels show, from the dialog's state: real formatting, no DOM.
import { describe, expect, it } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';
import type { SendRecipient } from '@/models/send-flow.types';
import { maxLimitFigures, sweepDoneSummary, sweepFeeBreakdown } from './sweepDialogState';

const payment = (outputs: [string, number][], fee = 200_000): Cardano.Tx =>
  ({ body: { outputs: outputs.map(([address, coins]) => ({ address, value: { coins: BigInt(coins) } })), fee: BigInt(fee) } }) as unknown as Cardano.Tx;
const built = (merges: number, mergeFee: number) => ({ merges: new Array(merges).fill({}) as Cardano.Tx[], mergeFee: BigInt(mergeFee) });
const own = ['own-payment', 'own-change'];

describe('sweepDoneSummary', () => {
  it('counts only what left the wallet, to the one recipient', () => {
    const summary = sweepDoneSummary('tx-1', payment([['own-change', 5_000_000], ['recipient', 204_000_000]]), built(2, 400_000), own);
    expect(summary).toEqual({ txId: 'tx-1', amount: '₳204', address: 'recipient', recipients: 1, steps: 3, fee: '₳0.6' });
  });

  it('adds every fee: the payment and each merge', () => {
    expect(sweepDoneSummary('tx', payment([['recipient', 1_000_000]], 180_000), built(10, 4_821_905), own).fee).toBe('₳5.001905');
  });

  it('names several recipients by their count, summing what they get', () => {
    const summary = sweepDoneSummary('tx', payment([['alice', 10_000_000], ['own-payment', 1_000_000], ['bob', 2_500_000]]), built(1, 200_000), own);
    expect(summary.amount).toBe('₳12.5');
    expect(summary.recipients).toBe(2);
    expect(summary.address).toBe('');
  });

  it('keeps one recipient paid twice as one', () => {
    const summary = sweepDoneSummary('tx', payment([['alice', 1_000_000], ['alice', 2_000_000]]), built(1, 200_000), own);
    expect(summary).toMatchObject({ amount: '₳3', address: 'alice', recipients: 1 });
  });
});

describe('maxLimitFigures', () => {
  const recipient = (id: string, quantity: string): SendRecipient =>
    ({ id, selectedTokens: [{ ticker: 'ADA', quantity }, { ticker: 'HOSKY', quantity: '5' }] }) as unknown as SendRecipient;
  const selection = { utxos: [], truncated: true, total: 2144, limit: 200 };

  it('is nothing while every candidate fits, or without a Max recipient', () => {
    expect(maxLimitFigures({ ...selection, truncated: false }, [recipient('a', '10')], new Set(['a']), 'ADA')).toBeNull();
    expect(maxLimitFigures(selection, [recipient('a', '10')], new Set(), 'ADA')).toBeNull();
    expect(maxLimitFigures(null, [recipient('a', '10')], new Set(['a']), 'ADA')).toBeNull();
  });

  it('sums the ADA Max put on its recipients and counts what stays behind', () => {
    const figures = maxLimitFigures(selection, [recipient('a', '1199.995686'), recipient('b', '7'), recipient('c', '0.5')], new Set(['a', 'c']), 'ADA');
    expect(figures).toEqual({ amount: '₳1,200.495686', total: 2144, max: 200, remaining: 1944 });
  });
});

describe('sweepFeeBreakdown', () => {
  it('is nothing without a sweep or a built payment', () => {
    expect(sweepFeeBreakdown(null, 200_000)).toBeNull();
    expect(sweepFeeBreakdown(built(1, 200_000), undefined)).toBeNull();
  });

  it('splits the fee between the merges and the payment', () => {
    expect(sweepFeeBreakdown(built(10, 4_821_905), BigInt(480_238))).toEqual({ merges: 10, mergeFee: '₳4.821905', paymentFee: '₳0.480238' });
  });
});

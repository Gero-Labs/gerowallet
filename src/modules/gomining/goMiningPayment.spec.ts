// Paying an order: the checks that stand between a backend quote and the wallet's
// own send, the exact satoshi reading of a typed amount, and the fee estimate the
// wallet shows before the user signs.
import { describe, expect, it } from 'vitest';
import type { GoMiningOrder } from '@/api/gomining-api';
import {
  QUOTE_MARGIN_MS,
  estimatePaymentFeeSats,
  isFinalOrderStatus,
  orderPaymentProblem,
  orderStatusKey,
  parseBtcInput,
  satsToBtcInput,
} from './goMiningPayment';
import { calculateTxSize } from '@/chains/bitcoin/bitcoinCoinSelection';

const NOW = 1_800_000_000_000;
const ORDER: GoMiningOrder = {
  id: 'ord_1',
  collectionId: 7,
  powerTh: 2,
  energyEfficiency: 20,
  priceUsd: 39.5,
  status: 'awaiting_payment',
  payment: { address: 'tb1qdeposit', amountSats: 61_234, network: 'Testnet', expiresAt: NOW + 10 * 60_000 },
  txid: null,
  createdAt: '2026-10-27T10:00:00.000Z',
};
const wallet = { network: 'Testnet', isValidAddress: (address: string) => address === 'tb1qdeposit' };

describe('orderPaymentProblem', () => {
  it('finds nothing wrong with a fresh quote on this network', () => {
    expect(orderPaymentProblem(ORDER, wallet, NOW)).toBeNull();
  });

  it('refuses an order that no longer waits for payment', () => {
    expect(orderPaymentProblem({ ...ORDER, status: 'payment_detected' }, wallet, NOW)).toBe('status');
    expect(orderPaymentProblem({ ...ORDER, status: 'expired' }, wallet, NOW)).toBe('status');
    expect(orderPaymentProblem({ ...ORDER, txid: 'ab'.repeat(32) }, wallet, NOW)).toBe('status');
  });

  it("refuses a quote for another network than the wallet's", () => {
    expect(orderPaymentProblem({ ...ORDER, payment: { ...ORDER.payment, network: 'Mainnet' } }, wallet, NOW)).toBe('network');
  });

  it('refuses an address the wallet does not accept on its network', () => {
    expect(orderPaymentProblem({ ...ORDER, payment: { ...ORDER.payment, address: 'bc1qmainnet' } }, wallet, NOW)).toBe('address');
  });

  it('refuses a quote with too little time left to get the payment out', () => {
    const closing = { ...ORDER, payment: { ...ORDER.payment, expiresAt: NOW + QUOTE_MARGIN_MS } };
    expect(orderPaymentProblem(closing, wallet, NOW)).toBe('expired');
    expect(orderPaymentProblem(closing, wallet, NOW - 1)).toBeNull();
  });
});

describe('parseBtcInput', () => {
  it.each([
    ['0.00061234', 61_234],
    ['1', 100_000_000],
    ['1.', 100_000_000],
    ['.5', 50_000_000],
    [' 0.1 ', 10_000_000],
    ['0.00000001', 1],
    ['21000000', 2_100_000_000_000_000],
  ])('reads %s as %d sats', (input, sats) => {
    expect(parseBtcInput(input)).toBe(sats);
  });

  it.each(['', '.', '0', '0.000000001', '-1', '1e-3', '1,5', '21000000.00000001', 'abc', '0x10'])('refuses %j', (input) => {
    expect(parseBtcInput(input)).toBeNull();
  });
});

describe('satsToBtcInput', () => {
  it('writes sats as a plain BTC amount', () => {
    expect(satsToBtcInput(61_234)).toBe('0.00061234');
    expect(satsToBtcInput(150_000_000)).toBe('1.50000000');
    expect(satsToBtcInput(0)).toBe('0.00000000');
    expect(parseBtcInput(satsToBtcInput(2_100_000_000_000_000))).toBe(2_100_000_000_000_000);
  });
});

describe('estimatePaymentFeeSats', () => {
  it('adds inputs largest first until amount and fee are covered', () => {
    const utxos = [BigInt(20_000), BigInt(50_000), BigInt(30_000)];
    // 50 000 alone cannot pay 61 234; 50 000 + 30 000 can.
    expect(estimatePaymentFeeSats(utxos, 61_234, 10)).toBe(calculateTxSize(2, 2) * 10);
  });

  it('says so when the wallet cannot cover amount and fee', () => {
    expect(estimatePaymentFeeSats([BigInt(61_234)], 61_234, 10)).toBeNull();
    expect(estimatePaymentFeeSats([], 1, 1)).toBeNull();
  });
});

describe('order status', () => {
  it('names every status and stops at the final ones', () => {
    expect(orderStatusKey('under_review')).toBe('gomining.orderUnderReview');
    expect(['completed', 'expired', 'failed'].every((s) => isFinalOrderStatus(s as GoMiningOrder['status']))).toBe(true);
    expect(['awaiting_payment', 'payment_detected', 'under_review'].some((s) => isFinalOrderStatus(s as GoMiningOrder['status']))).toBe(false);
  });
});

/**
 * Paying a GoMining miner order from the wallet.
 *
 * gero-backend quotes each order as an exact satoshi amount to a deposit address
 * of its own, valid until `expiresAt`. The wallet pays it with its ordinary
 * `SEND_BITCOIN` path, which the user signs, and only after `orderPaymentProblem`
 * finds nothing wrong: the order still waits for payment, on this wallet's
 * network, to an address valid there, with enough of the quote left to get the
 * transaction out.
 */

import { calculateTxSize } from '@/chains/bitcoin/bitcoinCoinSelection';
import type { GoMiningOrder, GoMiningOrderStatus } from '@/api/gomining-api';

const ORDER_STATUS_KEYS: Record<GoMiningOrderStatus, string> = {
  awaiting_payment: 'gomining.orderAwaitingPayment',
  payment_detected: 'gomining.orderPaymentDetected',
  completed: 'gomining.orderCompleted',
  expired: 'gomining.orderExpired',
  under_review: 'gomining.orderUnderReview',
  failed: 'gomining.orderFailed',
};

export function orderStatusKey(status: GoMiningOrderStatus): string {
  return ORDER_STATUS_KEYS[status];
}

/** No later status follows these, so nothing is polled for them. */
export function isFinalOrderStatus(status: GoMiningOrderStatus): boolean {
  return status === 'completed' || status === 'expired' || status === 'failed';
}

const SATS_PER_BTC = 100_000_000;
const MAX_SATS = 21_000_000 * SATS_PER_BTC;

/** Less than this left on the quote and the wallet will not start paying it. */
export const QUOTE_MARGIN_MS = 2 * 60_000;

export type OrderPaymentProblem = 'status' | 'network' | 'address' | 'expired';

export function orderPaymentProblem(
  order: GoMiningOrder,
  wallet: { network: string; isValidAddress: (address: string, network: string) => boolean },
  now = Date.now(),
): OrderPaymentProblem | null {
  if (order.status !== 'awaiting_payment' || order.txid) return 'status';
  if (order.payment.network !== wallet.network) return 'network';
  if (!wallet.isValidAddress(order.payment.address, wallet.network)) return 'address';
  if (order.payment.expiresAt - QUOTE_MARGIN_MS <= now) return 'expired';
  return null;
}

/**
 * A typed BTC amount in satoshis, read digit by digit so no float rounding is
 * involved. Null for anything that is not a plain positive amount with at most 8
 * decimals.
 */
export function parseBtcInput(input: string): number | null {
  const match = /^(\d{0,8})(?:\.(\d{0,8}))?$/.exec(input.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const value = Number(match[1] || '0') * SATS_PER_BTC + Number((match[2] ?? '').padEnd(8, '0'));
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_SATS ? value : null;
}

/** Satoshis as a plain BTC string for an input field (123456 → "0.00123456"). */
export function satsToBtcInput(sats: number): string {
  const digits = String(Math.max(0, Math.trunc(sats))).padStart(9, '0');
  return `${digits.slice(0, -8)}.${digits.slice(-8)}`;
}

/**
 * The network fee for paying `amountSats` at `feeRate` sat/vB: inputs picked
 * largest first, as the wallet's coin selection does by default, plus the payment
 * and a change output. Null when the UTxOs cannot cover amount and fee.
 */
export function estimatePaymentFeeSats(utxoValues: readonly bigint[], amountSats: number, feeRate: number): number | null {
  const sorted = [...utxoValues].sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
  let total = BigInt(0);
  for (let i = 0; i < sorted.length; i++) {
    total += sorted[i];
    const fee = calculateTxSize(i + 1, 2) * feeRate;
    if (total >= BigInt(amountSats) + BigInt(Math.ceil(fee))) return Math.ceil(fee);
  }
  return null;
}

import type { Cardano } from '@cardano-sdk/core';
import type { BuiltSweep } from '@/api/sweepBuild';
import type { InputSelection } from '@/api/nexusInputSelection';
import type { SendRecipient, Token } from '@/models/send-flow.types';
import { decimalToBaseUnits } from '@/shared/utils/amount';
import { formatAda } from '@/shared/utils/format';

/**
 * The figures Quick Send's sweep panels show, worked out from the dialog's state. Pure,
 * so each is testable on its own; the dialog only passes its refs in.
 */

type SweepFees = Pick<BuiltSweep, 'merges' | 'mergeFee'>;

export interface SweepDoneSummary {
  /** The payment's transaction id. */
  txId: string;
  /** What left the wallet, every recipient together, formatted. */
  amount: string;
  /** The one recipient's address; empty when the payment went to several. */
  address: string;
  /** Distinct addresses outside the wallet the payment paid. */
  recipients: number;
  /** Transactions the send went out as: the merges plus the payment. */
  steps: number;
  /** Every transaction's fee together, formatted. */
  fee: string;
}

/**
 * What the done panel shows once a sweep's payment is out. Outputs at the wallet's own
 * addresses are change, not a recipient.
 */
export function sweepDoneSummary(
  txId: string,
  payment: Cardano.Tx,
  built: SweepFees,
  ownAddresses: Iterable<string>,
): SweepDoneSummary {
  const own = new Set(ownAddresses);
  const recipients = new Set<string>();
  let amount = BigInt(0);
  let first = '';
  for (const output of payment.body.outputs) {
    const to = String(output.address);
    if (own.has(to)) continue;
    amount += BigInt(output.value.coins);
    if (recipients.size === 0) first = to;
    recipients.add(to);
  }
  return {
    txId,
    amount: formatAda(amount),
    address: recipients.size === 1 ? first : '',
    recipients: recipients.size,
    steps: built.merges.length + 1,
    fee: formatAda(BigInt(payment.body.fee) + BigInt(built.mergeFee)),
  };
}

export interface MaxLimitFigures {
  /** What Max put on the recipients it was pressed for, formatted. */
  amount: string;
  total: number;
  max: number;
  remaining: number;
}

/**
 * The note for a Max that could not sweep: only while the candidates were cut to the
 * request limit and a recipient still carries a Max amount.
 */
export function maxLimitFigures(
  selection: InputSelection | null,
  recipients: SendRecipient[],
  maxRecipientIds: ReadonlySet<string>,
  nativeTicker: string,
): MaxLimitFigures | null {
  if (!selection?.truncated || maxRecipientIds.size === 0) return null;
  let lovelace = BigInt(0);
  for (const recipient of recipients) {
    if (!maxRecipientIds.has(recipient.id)) continue;
    const ada = recipient.selectedTokens.find((token: Token) => token.ticker === nativeTicker);
    if (ada?.quantity) lovelace += decimalToBaseUnits(ada.quantity, 6);
  }
  return {
    amount: formatAda(lovelace),
    total: selection.total,
    max: selection.limit,
    remaining: selection.total - selection.limit,
  };
}

export interface SweepFeeBreakdown {
  merges: number;
  mergeFee: string;
  paymentFee: string;
}

/** How a sweep's fee splits between its merges and the payment; null without a sweep or a built payment. */
export function sweepFeeBreakdown(built: SweepFees | null, paymentFeeLovelace: bigint | number | undefined): SweepFeeBreakdown | null {
  if (!built || paymentFeeLovelace === undefined) return null;
  return {
    merges: built.merges.length,
    mergeFee: formatAda(built.mergeFee),
    paymentFee: formatAda(paymentFeeLovelace),
  };
}

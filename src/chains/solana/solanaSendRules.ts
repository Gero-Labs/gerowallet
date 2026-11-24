/**
 * What the worker checks before it signs a SOL transfer. Pure, so the send dialog shows
 * the same verdicts the worker would give.
 */
import { isValidSolanaAddress } from './solanaKeyManager';
import { estimateSolTransferFee } from './solanaTransaction';

/**
 * Lamports a 0-byte system account needs to be rent exempt
 * (`getMinimumBalanceForRentExemption(0)`: (128 + 0) × 3480 × 2). An account below it is
 * refused by the runtime, so a transfer may not leave the sender, or create the recipient,
 * with less than this (0 is fine for the sender: the account is closed).
 */
export const SOLANA_RENT_EXEMPT_MINIMUM = 890_880n;

/** Priority fee levels the user picks from. Prices come from Nexus `/api/sol/fees`. */
export type SolanaFeeLevel = 'standard' | 'fast';

/** Highest priority price the wallet pays, micro-lamports per compute unit (0.00003 SOL at 600 CU). */
export const MAX_PRIORITY_MICRO_LAMPORTS = 50_000_000n;

export interface SolanaPriorityPrices {
  median: number;
  p75: number;
}

/** Priority price for `level`, capped and never negative. */
export function priorityPriceFor(level: SolanaFeeLevel, prices: SolanaPriorityPrices | undefined): bigint {
  const raw = level === 'fast' ? prices?.p75 : prices?.median;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0n;
  const price = BigInt(Math.ceil(raw));
  return price > MAX_PRIORITY_MICRO_LAMPORTS ? MAX_PRIORITY_MICRO_LAMPORTS : price;
}

export type SolanaSendRefusal =
  | 'INVALID_ADDRESS'
  | 'SAME_ADDRESS'
  | 'INVALID_AMOUNT'
  | 'BALANCE_UNKNOWN'
  | 'INSUFFICIENT_FUNDS'
  | 'SENDER_BELOW_RENT'
  | 'RECIPIENT_BELOW_RENT'
  | 'RECIPIENT_UNVERIFIED';

export interface SolanaSendCheck {
  from: string;
  to: string;
  lamports: bigint;
  /** Sender's balance in lamports; null when not known yet. */
  balance: bigint | null;
  priorityMicroLamports: bigint;
  /**
   * Recipient's balance. undefined: not checked (the page). null: the read failed, so an
   * amount below the rent-exempt minimum is refused as unverifiable rather than signed.
   */
  recipientBalance?: bigint | null;
}

/** The first rule the transfer breaks, or null when it may be signed. */
export function checkSolTransfer(check: SolanaSendCheck): SolanaSendRefusal | null {
  if (!isValidSolanaAddress(check.to)) return 'INVALID_ADDRESS';
  if (check.to === check.from) return 'SAME_ADDRESS';
  if (check.lamports <= 0n) return 'INVALID_AMOUNT';
  if (check.balance === null) return 'BALANCE_UNKNOWN';
  const remaining = check.balance - check.lamports - estimateSolTransferFee(check.priorityMicroLamports);
  if (remaining < 0n) return 'INSUFFICIENT_FUNDS';
  if (remaining > 0n && remaining < SOLANA_RENT_EXEMPT_MINIMUM) return 'SENDER_BELOW_RENT';
  if (check.lamports < SOLANA_RENT_EXEMPT_MINIMUM) {
    if (check.recipientBalance === 0n) return 'RECIPIENT_BELOW_RENT';
    if (check.recipientBalance === null) return 'RECIPIENT_UNVERIFIED';
  }
  return null;
}

/** Largest amount that can be sent: the whole balance less the fee (closing the account). */
export function maxSendableLamports(balance: bigint | null, priorityMicroLamports: bigint): bigint {
  if (balance === null) return 0n;
  const max = balance - estimateSolTransferFee(priorityMicroLamports);
  return max > 0n ? max : 0n;
}

/**
 * The i18n key a page shows for a refusal or a worker error code. Rent keys take
 * `{amount}` (SOLANA_RENT_EXEMPT_MINIMUM in SOL) and `{ticker}`.
 */
export function solanaSendErrorKey(code: string | undefined): string {
  switch (code) {
    case 'INVALID_ADDRESS': return 'solana.invalidAddress';
    case 'SAME_ADDRESS': return 'solana.sameAddress';
    case 'INVALID_AMOUNT': return 'send.invalidAmount';
    case 'BALANCE_UNKNOWN': return 'solana.balanceUnknown';
    case 'INSUFFICIENT_FUNDS': return 'send.insufficientBalance';
    case 'SENDER_BELOW_RENT': return 'solana.senderBelowRent';
    case 'RECIPIENT_BELOW_RENT': return 'solana.recipientBelowRent';
    case 'RECIPIENT_UNVERIFIED': return 'solana.recipientUnverified';
    case 'BUILD_FAILED': return 'solana.signFailed';
    case 'SUBMIT_FAILED': return 'solana.submitFailed';
    case 'SEND_EXPIRED': return 'solana.hardware.sendExpired';
    case 'BAD_SIGNATURE': return 'solana.hardware.badSignature';
    case 'DEVICE_FAILED': return 'solana.hardware.signFailed';
    case 'TOKEN_UNKNOWN': return 'solana.token.unknown';
    case 'TOKEN_BALANCE': return 'send.insufficientBalance';
    case 'TOKEN_FROZEN': return 'solana.token.frozen';
    case 'TOKEN_NOT_TRANSFERABLE': return 'solana.token.notTransferable';
    case 'RECIPIENT_NOT_WALLET': return 'solana.token.recipientNotWallet';
    case 'RECIPIENT_WRONG_TOKEN': return 'solana.token.recipientWrongToken';
    case 'INSUFFICIENT_SOL': return 'solana.token.insufficientSol';
    case 'SIMULATION_FAILED': return 'solana.token.simulationFailed';
    case 'LOOKUP_FAILED': return 'solana.token.lookupFailed';
    default: return 'solana.sendFailed';
  }
}

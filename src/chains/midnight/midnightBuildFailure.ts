/**
 * Marks a failure of the wallet's own BUILD of a dApp connector request
 * (makeTransfer, balanceUnsealedTransaction, makeIntent), as opposed to the
 * steps around it: the credential, the PassKey prompt, the write gate, the
 * prover choice. Only a marked failure changes what the dApp is told when the
 * user then closes the prompt (DAppOverlay.vue): `InsufficientFunds` or
 * `InternalError` instead of `Rejected`. A wrong password followed by a
 * decline is still a decline.
 *
 * The mark crosses the worker → page boundary as a `buildFailure` field on the
 * reply; the error's message is kept, so the page still turns a ledger or
 * refusal code in it into the user's language.
 */
import { IntentInsufficientFundsError, isSdkInsufficientFunds, MIDNIGHT_DUST_COINS_SHORT } from './midnightConnectorIntent';

/** The connector error codes a build failure answers with (values of `MidnightErrorCode`). */
export type MidnightBuildFailure = 'InsufficientFunds' | 'InternalError';

/** Nexus's `errorCode` when the wallet does not hold what a build needs (a 422). */
export const NEXUS_INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS';

export class MidnightBuildFailedError extends Error {
  readonly buildFailure: MidnightBuildFailure;
  constructor(buildFailure: MidnightBuildFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MidnightBuildFailedError';
    this.buildFailure = buildFailure;
  }
}

/** Which code a failed build answers with: the wallet lacks a token or the DUST, or anything else. */
export function buildFailureOf(error: unknown): MidnightBuildFailure {
  if (error instanceof MidnightBuildFailedError) return error.buildFailure;
  if (error instanceof IntentInsufficientFundsError || isSdkInsufficientFunds(error)) return 'InsufficientFunds';
  if ((error as { errorCode?: unknown } | null)?.errorCode === NEXUS_INSUFFICIENT_FUNDS) return 'InsufficientFunds';
  // Too few DUST coins to pay within the validation-time limit (midnightDustSpread9.ts): the wallet lacks the DUST.
  if (error instanceof Error && error.message === MIDNIGHT_DUST_COINS_SHORT) return 'InsufficientFunds';
  return 'InternalError';
}

/** Runs one build step; whatever it throws comes out marked, its message unchanged. */
export async function asBuildStep<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof MidnightBuildFailedError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new MidnightBuildFailedError(buildFailureOf(error), message, { cause: error });
  }
}

/** The worker reply's `buildFailure` field: present only for a marked failure. */
export function buildFailureReply(error: unknown): { buildFailure?: MidnightBuildFailure } {
  return error instanceof MidnightBuildFailedError ? { buildFailure: error.buildFailure } : {};
}

/** Reads a reply's `buildFailure` back on the page; anything else is no mark. */
export function readBuildFailure(value: unknown): MidnightBuildFailure | undefined {
  return value === 'InsufficientFunds' || value === 'InternalError' ? value : undefined;
}

/**
 * Runs a build step on the page and marks what it throws IN PLACE, so the
 * error keeps its type: a Nexus `MidnightApiError` stays one for the screens
 * that branch on it.
 */
export async function markBuildStep<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error && typeof error === 'object' && !('buildFailure' in error)) {
      Object.assign(error, { buildFailure: buildFailureOf(error) });
    }
    throw error;
  }
}

/** Puts the mark from a worker reply back on the page's error. */
export function withBuildFailure<E extends Error>(error: E, value: unknown): E {
  const buildFailure = readBuildFailure(value);
  return buildFailure ? Object.assign(error, { buildFailure }) : error;
}

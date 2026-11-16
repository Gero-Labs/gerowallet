import { readBuildFailure, type MidnightBuildFailure } from '@/chains/midnight/midnightBuildFailure';
import { MidnightErrorCode } from '@/chrome/config';

/** What a declined makeTransfer / balanceUnsealedTransaction / makeIntent answers the dApp. */
export interface ConnectorDecline {
  code: string;
  reason: string;
}

/**
 * Remembers that the wallet's own build of a connector request failed, so that
 * closing the prompt afterwards tells the dApp why (`InsufficientFunds`,
 * `InternalError`) instead of `Rejected`. The panel keeps a failed request
 * open for a retry, so the decline comes later, from the user.
 *
 * - Only a failure marked as the build's (`buildFailure`, midnightBuildFailure.ts)
 *   counts. A wrong password, a cancelled PassKey prompt, a paused network or a
 *   stale approval is not the wallet failing to build: declining after one is `Rejected`.
 * - A failure belongs to the request whose build threw it, and only while that
 *   request is still the one shown: a build that fails after the user moved on
 *   says nothing about the next request.
 * - A successful build of the same request clears it; a later unmarked failure
 *   (a mistyped password on the retry) does not.
 */
export function useConnectorBuildFailure(currentRequestId: () => string | undefined) {
  let failure: { requestId: string; code: MidnightBuildFailure } | null = null;

  async function record<T>(build: () => Promise<T>): Promise<T> {
    const requestId = currentRequestId();
    try {
      const result = await build();
      if (failure?.requestId === requestId) failure = null;
      return result;
    } catch (error) {
      const code = readBuildFailure((error as { buildFailure?: unknown } | null)?.buildFailure);
      if (code && requestId !== undefined && requestId === currentRequestId()) failure = { requestId, code };
      throw error;
    }
  }

  /** The answer to the current request's decline. `subject` names it ("this transfer"). */
  function decline(subject: string, declined: string): ConnectorDecline {
    const code = failure && failure.requestId === currentRequestId() ? failure.code : undefined;
    failure = null;
    if (code === MidnightErrorCode.InsufficientFunds) {
      return { code: MidnightErrorCode.InsufficientFunds, reason: `The wallet cannot cover ${subject}` };
    }
    if (code) return { code: MidnightErrorCode.InternalError, reason: `The wallet could not build ${subject}` };
    return { code: MidnightErrorCode.Rejected, reason: declined };
  }

  return { record, decline };
}

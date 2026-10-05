/**
 * One place to turn a failed `POST /api/transactions/submit-tx` into something a
 * human (or a dApp) can act on.
 *
 * The backend submits through Ogmios and answers with the node's own rejection text
 * on 4xx, or a gateway/infrastructure failure on 5xx. Both wallet submit paths used
 * to discard that body — the axios path in `WalletBg.submitTx` replaced anything but
 * a 400/500/429/425 with `APIError.InvalidRequest.info`, and the CIP-30 path in
 * background.ts did the same with `response.statusText`. A mainnet reward withdrawal
 * rejected by the node therefore reached the user as "Inputs do not conform to this
 * spec or are otherwise invalid." plus "Request failed with status code 502", which
 * names neither the real cause nor anything the user can do (2026-09-21 ticket).
 *
 * Preserve the status classification from submitFailure.ts, while retaining the
 * server's reason and treating 5xx / no response as an unknown submission outcome.
 */
import { APIError, TX_SUBMIT_UNCONFIRMED_MESSAGE, TxSendError } from '@/chrome/config';
import { classifySubmitFailure } from '@/chrome/submitFailure';
import { ERROR } from '@/models/types';

/**
 * The server's own explanation, out of a plain-text body, a JSON error envelope, or
 * an axios `error.response.data`. Empty string when there is nothing quotable —
 * callers fall back to their generic message rather than printing "{}" at a user.
 */
export function submitFailureDetail(body: unknown): string {
  if (typeof body === 'string') return body.trim();
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    try {
      return JSON.stringify(body);
    } catch {
      return '';
    }
  }
  return '';
}

/** True when the response cannot establish whether the transaction was accepted. */
function isInfrastructureFailure(status: number | undefined): boolean {
  return status === undefined || classifySubmitFailure(status) === 'internal';
}

/**
 * Message for the wallet's own UI. English by design: this runs in the background
 * worker, which has no i18n — `friendlyTxError()` localizes it on the way to the
 * snackbar, keying off {@link TX_SUBMIT_UNCONFIRMED_MESSAGE}.
 *
 * @param status HTTP status, or `undefined` when the request never got a response.
 * @param body   Response body (string or parsed JSON), if any.
 */
export function describeSubmitFailure(status: number | undefined, body: unknown): string {
  const detail = submitFailureDetail(body);
  if (status === 425) return ERROR.fullMempool;
  if (status === 429) return TxSendError.Refused.info;
  if (isInfrastructureFailure(status)) {
    // Deliberately not "was not sent": the node may have accepted the transaction
    // before its answer was lost, so the only honest statement is that we don't know.
    const where = status === undefined ? '' : ` (HTTP ${status})`;
    return `${TX_SUBMIT_UNCONFIRMED_MESSAGE}${where}. It may still have reached the network, `
      + 'so check your transaction history before sending it again.';
  }
  return detail ? `${TxSendError.Failure.info} ${detail}` : TxSendError.Failure.info;
}

/**
 * A 200 whose body is not a 64-char tx id: the endpoint answered, we just don't
 * understand the answer. Distinct from {@link describeSubmitFailure}'s
 * `status === undefined` branch, which means the request never got a response at
 * all -- only that one is an outage, and claiming "try again in a moment" for a
 * successful HTTP response would be a guess (PR #1129 review).
 */
export function describeUnexpectedSubmitResponse(body: unknown): string {
  const detail = submitFailureDetail(body);
  const suffix = detail ? `: ${detail}` : '.';
  return `${TxSendError.Failure.info} The submission endpoint returned an unexpected response${suffix}`;
}

/** Marks the error above so a shared catch can rethrow it untouched. */
export const UNEXPECTED_SUBMIT_RESPONSE = 'submitResponseUnexpected';

export function unexpectedSubmitResponseError(body: unknown): Error {
  const error = new Error(describeUnexpectedSubmitResponse(body));
  (error as Error & { [UNEXPECTED_SUBMIT_RESPONSE]?: true })[UNEXPECTED_SUBMIT_RESPONSE] = true;
  return error;
}

export function isUnexpectedSubmitResponseError(error: unknown): boolean {
  return Boolean((error as Record<string, unknown> | null)?.[UNEXPECTED_SUBMIT_RESPONSE]);
}

/**
 * CIP-30 error object for dApp callers. Keeps the spec's `{code, info}` shape and the
 * status codes established by classifySubmitFailure, including InternalError for
 * every 5xx. Missing responses use TxSendError.Failure with an unknown outcome.
 *
 * The reason goes in `info`, because that is the field CIP-30 defines and the one a
 * conforming dApp renders; `message` carries the same text for callers that already
 * read it. Spreading TxSendError.Failure alone left `info` as the generic sentence,
 * so the detail never reached the user (PR #1129 review).
 */
export function dappSubmitError(status: number | undefined, body: unknown): unknown {
  const detail = submitFailureDetail(body);
  const kind = classifySubmitFailure(status);
  if (kind === 'mempoolFull') return ERROR.fullMempool;
  if (kind === 'refused') return TxSendError.Refused;
  const error = kind === 'internal' ? APIError.InternalError
    : kind === 'invalidRequest' && status !== undefined ? APIError.InvalidRequest
    : TxSendError.Failure;
  const info = isInfrastructureFailure(status)
    ? describeSubmitFailure(status, body)
    : detail || error.info;
  return { ...error, info, message: info };
}

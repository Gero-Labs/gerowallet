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
 * Split by who is at fault:
 *  - 4xx — the node rejected THIS transaction; surface its reason verbatim.
 *  - 5xx / no response — our submission path is down; say so, and say it's retryable.
 */
import { APIError, TX_SUBMIT_UNAVAILABLE_MESSAGE, TxSendError } from '@/chrome/config';
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

/** True when the failure is ours (gateway/outage) rather than a rejection of this tx. */
function isInfrastructureFailure(status: number | undefined): boolean {
  return status === undefined || status >= 500;
}

/**
 * Message for the wallet's own UI. English by design: this runs in the background
 * worker, which has no i18n — `friendlyTxError()` localizes it on the way to the
 * snackbar, keying off {@link TX_SUBMIT_UNAVAILABLE_MESSAGE}.
 *
 * @param status HTTP status, or `undefined` when the request never got a response.
 * @param body   Response body (string or parsed JSON), if any.
 */
export function describeSubmitFailure(status: number | undefined, body: unknown): string {
  const detail = submitFailureDetail(body);
  if (status === 425) return ERROR.fullMempool;
  if (status === 429) return TxSendError.Refused.info;
  if (isInfrastructureFailure(status)) {
    const where = status === undefined ? '' : ` (HTTP ${status})`;
    return `${TX_SUBMIT_UNAVAILABLE_MESSAGE}${where}. Please try again in a moment.`;
  }
  return detail ? `${TxSendError.Failure.info} ${detail}` : TxSendError.Failure.info;
}

/**
 * CIP-30 error object for dApp callers. Keeps the spec's `{code, info}` shape and the
 * existing mapping for 400/425/429/500; the change is that a 502/503/504 no longer
 * claims `APIError.InvalidRequest` (code -1, "inputs do not conform to this spec"),
 * which blamed the dApp's transaction for our gateway being down.
 */
export function dappSubmitError(status: number | undefined, body: unknown): unknown {
  const detail = submitFailureDetail(body);
  if (status === 425) return ERROR.fullMempool;
  if (status === 429) return TxSendError.Refused;
  if (status === 500) return APIError.InternalError;
  if (isInfrastructureFailure(status)) {
    return { ...TxSendError.Failure, message: describeSubmitFailure(status, body) };
  }
  return { ...TxSendError.Failure, message: detail || TxSendError.Failure.info };
}

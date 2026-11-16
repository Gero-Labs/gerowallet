// Midnight DApp Connector errors, page side.
//
// `@midnightntwrk/dapp-connector-api` 4.x types every rejection as
// `APIError = Error & { type: 'DAppConnectorAPIError'; code; reason }`, and
// dapps check `error.type` / `error.code`. The background builds that shape as
// a plain object, because chrome messaging and `window.postMessage` cannot
// carry an Error's own fields. Left as is, a dapp that prints the rejection
// shows `Error: [object Object]`. The page bridge turns it back into a real
// Error here.
//
// Imports only `config` so the page-world bundle stays small.

import { MidnightErrorCode } from './config';

export type MidnightConnectorError = Error & {
  type: 'DAppConnectorAPIError';
  code: string;
  reason: string;
};

const MIDNIGHT_ERROR_CODES: ReadonlySet<string> = new Set(Object.values(MidnightErrorCode));

/** A spec `APIError`: an Error whose message is `reason`, carrying `type`, `code` and `reason`. */
export function midnightConnectorError(code: string, reason: string): MidnightConnectorError {
  const err = new Error(reason) as MidnightConnectorError;
  err.type = 'DAppConnectorAPIError';
  err.code = code;
  err.reason = reason;
  return err;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Turn whatever error a Midnight connector call got back from the extension
 * into a spec `APIError`:
 * - the background's `{type:'DAppConnectorAPIError', code, reason, message}`
 *   keeps its code and reason (message falls back to `message`, then the code);
 * - anything else (a CIP-30 `{code, info}` such as the not-whitelisted refusal,
 *   a bare string from a lost runtime connection, a structured-cloned Error) is
 *   `InternalError` with the most readable text it carries.
 */
export function toMidnightConnectorError(raw: unknown): MidnightConnectorError {
  if (raw instanceof Error) {
    const fields = raw as Partial<MidnightConnectorError>;
    if (fields.type === 'DAppConnectorAPIError' && typeof fields.code === 'string' && typeof fields.reason === 'string') {
      return raw as MidnightConnectorError;
    }
    return midnightConnectorError(MidnightErrorCode.InternalError, raw.message || 'Unknown wallet error');
  }
  if (typeof raw === 'object' && raw !== null) {
    const fields = raw as Record<string, unknown>;
    const reason = nonEmptyString(fields['reason']) ?? nonEmptyString(fields['message']);
    const code = fields['code'];
    if (fields['type'] === 'DAppConnectorAPIError' && typeof code === 'string' && MIDNIGHT_ERROR_CODES.has(code)) {
      return midnightConnectorError(code, reason ?? code);
    }
    return midnightConnectorError(
      MidnightErrorCode.InternalError,
      reason ?? nonEmptyString(fields['info']) ?? 'Unknown wallet error',
    );
  }
  return midnightConnectorError(MidnightErrorCode.InternalError, nonEmptyString(raw) ?? 'Unknown wallet error');
}

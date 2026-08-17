import { APIError } from './config';

/**
 * Chrome extension messaging JSON-serializes responses, and Error instances
 * serialize to `{}` (message/stack are non-enumerable). A raw caught Error
 * forwarded through sendResponse therefore reaches the dApp as an opaque
 * `Uncaught {}` — this is exactly what broke CIP-30 signData on Opera, where
 * the missing chrome.sidePanel API made the approval flow throw.
 *
 * Convert Errors to a CIP-30 `{code, info}` shape; pass every intentional
 * error value (APIError/DataSignError/TxSignError objects, Midnight connector
 * shapes, plain strings) through untouched.
 */
export function toDappError(err: unknown): unknown {
  if (err instanceof Error) {
    return { ...APIError.InternalError, info: err.message || APIError.InternalError.info };
  }
  return err ?? APIError.InternalError;
}

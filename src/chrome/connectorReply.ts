/** What a DApp Connector handler answers: a result or an error. */
export interface ConnectorReply {
  data?: unknown;
  error?: unknown;
}

/**
 * Wraps a connector handler's `sendResponse` so the dapp is answered once only:
 * a handler's catch-all must never answer a request that was already answered.
 */
export function replyOnce(send: (opts: ConnectorReply) => void): (opts: ConnectorReply) => void {
  let replied = false;
  return (opts) => {
    if (replied) return;
    replied = true;
    send(opts);
  };
}

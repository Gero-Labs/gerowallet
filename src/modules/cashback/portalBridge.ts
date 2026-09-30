// Pure helpers for the Bring Cashback Portal postMessage bridge.
// Shapes follow the internal Bring Cashback portal migration design.

export type PortalInboundAction = 'LOGIN' | 'SIGN_MESSAGE' | 'POPUP_CLOSED';

/**
 * Upper bound on a claim challenge. Bring's `claim-initiate` returns a short
 * human-readable line; anything larger is not a claim and is refused before it
 * reaches the signing prompt.
 */
export const MAX_SIGN_MESSAGE_LENGTH = 2048;

/**
 * A portal message is trusted only when it comes from the exact portal origin
 * and is tagged `from: 'bringweb3'` with an action. Never widen this.
 */
export function isTrustedPortalMessage(event: MessageEvent, portalOrigin: string): boolean {
  if (!portalOrigin || event.origin !== portalOrigin) return false;
  const data = event.data as { from?: unknown; action?: unknown } | null | undefined;
  return !!data && data.from === 'bringweb3' && typeof data.action === 'string' && data.action.length > 0;
}

/**
 * The challenge of a `SIGN_MESSAGE` request, or null when the message carries
 * none the wallet should sign: not a string, empty, oversized, or containing
 * control characters (a challenge is one printable line; anything else could
 * hide text from the approval prompt).
 */
export function signRequestMessage(data: unknown): string | null {
  const message = (data as { messageToSign?: unknown } | null | undefined)?.messageToSign;
  if (typeof message !== 'string') return null;
  if (message.length === 0 || message.length > MAX_SIGN_MESSAGE_LENGTH) return null;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(message)) return null;
  return message;
}

/** CIP-30 signData payload: the UTF-8 bytes of the challenge, hex encoded. */
export function signPayloadHex(message: string): string {
  return Array.from(new TextEncoder().encode(message), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function sessionUpdateMessage(token: string) {
  return { to: 'bringweb3' as const, action: 'SESSION_UPDATE' as const, token };
}

export function signatureMessage(signature: string, key: string, message: string) {
  return { to: 'bringweb3' as const, action: 'SIGNATURE' as const, signature, key, message };
}

export function abortSignMessage() {
  return { to: 'bringweb3' as const, action: 'ABORT_SIGN_MESSAGE' as const };
}

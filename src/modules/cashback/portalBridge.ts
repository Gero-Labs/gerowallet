// Pure helpers for the Bring Cashback Portal postMessage bridge.
// Shapes follow the internal Bring Cashback portal migration design.

export type PortalInboundAction = 'LOGIN' | 'SIGN_MESSAGE' | 'POPUP_CLOSED';

/**
 * A portal message is trusted only when it comes from the exact portal origin
 * and is tagged `from: 'bringweb3'` with an action. Never widen this.
 */
export function isTrustedPortalMessage(event: MessageEvent, portalOrigin: string): boolean {
  if (!portalOrigin || event.origin !== portalOrigin) return false;
  const data = event.data as { from?: unknown; action?: unknown } | null | undefined;
  return !!data && data.from === 'bringweb3' && typeof data.action === 'string' && data.action.length > 0;
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

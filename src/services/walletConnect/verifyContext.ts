/**
 * What WalletConnect's Verify API says about a peer's claimed domain.
 *
 * A WalletConnect peer names its own URL in its metadata; nothing stops a
 * phishing site from claiming a real dApp's domain. The Verify API attests the
 * origin the pairing or request actually came from, and every session proposal
 * and session request carries its verdict (`verifyContext.verified`):
 *
 * - VALID: the attested origin matches the claimed domain.
 * - INVALID: it does not (the claim is false; `origin` is the real one).
 * - UNKNOWN: the Verify server could not attest anything.
 * - isScam: the origin is on WalletConnect's scam list. Refused outright.
 */

export type WcVerifyState = 'verified' | 'unverified' | 'mismatch' | 'scam';

export interface WcVerification {
  state: WcVerifyState;
  /** The origin the Verify API attested, when it gave one. */
  origin?: string;
}

const STATES: readonly WcVerifyState[] = ['verified', 'unverified', 'mismatch', 'scam'];

function httpsOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The verdict in a proposal's or request's `verifyContext`. Anything unreadable is unverified. */
export function assessWcVerification(verifyContext: unknown): WcVerification {
  const verified = (verifyContext as { verified?: { origin?: unknown; validation?: unknown; isScam?: unknown } } | null | undefined)?.verified;
  const origin = httpsOrigin(verified?.origin);
  const withOrigin = (state: WcVerifyState): WcVerification => (origin ? { state, origin } : { state });
  if (verified?.isScam === true) return withOrigin('scam');
  if (verified?.validation === 'VALID') return withOrigin('verified');
  if (verified?.validation === 'INVALID') return withOrigin('mismatch');
  return withOrigin('unverified');
}

/** A verdict handed to the UI, re-checked on the way in. */
export function readWcVerification(value: unknown): WcVerification | null {
  const v = value as { state?: unknown; origin?: unknown } | null | undefined;
  if (!v || !STATES.includes(v.state as WcVerifyState)) return null;
  const origin = httpsOrigin(v.origin);
  return origin ? { state: v.state as WcVerifyState, origin } : { state: v.state as WcVerifyState };
}

/**
 * URLs to put through the site blacklist: the claimed one and, when it differs,
 * the attested one. A mismatch is precisely the case where they differ.
 */
export function wcScanTargets(claimedUrl: string, verification: WcVerification): string[] {
  const targets = claimedUrl ? [claimedUrl] : [];
  if (verification.origin && httpsOrigin(claimedUrl) !== verification.origin) targets.push(verification.origin);
  return targets;
}

/** The URL whose risk to show: the attested origin when there is one, else the claim. */
export function wcRiskUrl(claimedUrl: string, verification: WcVerification | null): string {
  return verification?.origin ?? claimedUrl;
}

/** Query parameters that carry a verdict to a popup approval window. */
export function wcVerificationQuery(verification: WcVerification): Record<string, string> {
  return verification.origin ? { wc: verification.state, wcOrigin: verification.origin } : { wc: verification.state };
}

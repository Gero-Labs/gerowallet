/**
 * Bumped whenever the notice the user agreed to changes materially, so older
 * consent no longer counts. v3 (PRIV-01): the notice now says proof inputs can
 * include key material for the notes being spent, and covers dapp transfers.
 */
export const MIDNIGHT_PROVING_CONSENT_VERSION = 3;
export type MidnightRemoteProver = 'cloud' | 'zkpaas';
export interface MidnightProvingConsent {
  version: number;
  acceptedAt: number;
  provider: MidnightRemoteProver;
}

export function hasMidnightProvingConsent(consent: unknown, provider: MidnightRemoteProver): boolean {
  if (!consent || typeof consent !== 'object') return false;
  const value = consent as Partial<MidnightProvingConsent>;
  return value.version === MIDNIGHT_PROVING_CONSENT_VERSION && value.provider === provider
    && Number.isFinite(value.acceptedAt) && value.acceptedAt > 0;
}

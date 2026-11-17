/**
 * Bumped whenever the notice the user agreed to changes materially, so older
 * consent no longer counts. v3 (PRIV-01): the notice now says proof inputs can
 * include key material for the notes being spent, and covers dapp transfers.
 * v4: it names what that material is (the wallet-wide coin secret key, which
 * cannot be revoked, and the DUST secret key), and public sends in Gero Cloud
 * mode no longer need it (their fee is proven on this device).
 */
export const MIDNIGHT_PROVING_CONSENT_VERSION = 4;
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

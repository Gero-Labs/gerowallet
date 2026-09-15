export const MIDNIGHT_PROVING_CONSENT_VERSION = 2;
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

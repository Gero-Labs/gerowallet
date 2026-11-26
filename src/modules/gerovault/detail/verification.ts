/**
 * The verification state the vault screen shows, from the records this device keeps
 * (`VaultRecord.verifications`, spec 5.3), and the funding gate's state (spec 6.1).
 *
 * The per-cosigner state here is a display of what this device recorded. It never opens funding:
 * only `fundingVerified` (`verificationNumber.ts`), with this device's own acknowledgement of the
 * latest accepted manifest, does that. Until a verifier that can build that acknowledgement is
 * given, funding stays blocked.
 */
import { decodeManifest, verificationDigest, type CosignerVerification } from '@/shared/gerovault';
import type { StoredVaultParticipant, VaultRecord } from '@/modules/gerovault/contracts';

/**
 * - `checked`: a number, QR or external-file record for this vault's current verification set.
 * - `recorded`: such a record, but the vault has no manifest to compare it with.
 * - `stale`: the records are for an earlier set of keys or scripts.
 * - `providerOnly`: only a data provider's answer, which never counts.
 * - `unchecked`: nothing recorded.
 */
export type CosignerCheckState = 'checked' | 'recorded' | 'stale' | 'providerOnly' | 'unchecked';

export interface CosignerCheck {
  readonly credential: string;
  readonly state: CosignerCheckState;
  /** The method of the record the state comes from. */
  readonly method?: CosignerVerification['method'];
  /** Unix seconds of that record. */
  readonly at?: number;
}

/** The current verification digest of the stored manifest, or undefined without one. */
export function currentVerificationDigest(record: Pick<VaultRecord, 'manifest'>): string | undefined {
  if (!record.manifest) return undefined;
  const decoded = decodeManifest(record.manifest.cbor);
  if (decoded.ok !== true) return undefined;
  try {
    return verificationDigest(decoded.manifest);
  } catch {
    return undefined;
  }
}

const CEREMONY: readonly CosignerVerification['method'][] = ['number', 'qr', 'external', 'endorsed'];

/** What this device recorded for one cosigner. */
export function cosignerCheck(
  credential: string,
  records: readonly CosignerVerification[],
  digest: string | undefined,
): CosignerCheck {
  const mine = records.filter(r => r.credential === credential);
  const newest = (list: readonly CosignerVerification[]) => [...list].sort((a, b) => b.at - a.at)[0];
  const ceremony = mine.filter(r => CEREMONY.includes(r.method)) as Exclude<CosignerVerification, { method: 'provider' }>[];
  if (ceremony.length > 0) {
    if (digest === undefined) {
      const r = newest(ceremony) as CosignerVerification;
      return { credential, state: 'recorded', method: r.method, at: r.at };
    }
    const current = ceremony.filter(r => r.verificationDigest === digest);
    const r = newest(current.length > 0 ? current : ceremony) as CosignerVerification;
    return { credential, state: current.length > 0 ? 'checked' : 'stale', method: r.method, at: r.at };
  }
  const provider = newest(mine.filter(r => r.method === 'provider'));
  if (provider) return { credential, state: 'providerOnly', method: provider.method, at: provider.at };
  return { credential, state: 'unchecked' };
}

/** Every cosigner's check, in the order given (this wallet's own entry left out). */
export function cosignerChecks(record: Pick<VaultRecord, 'manifest' | 'verifications'>, participants: readonly StoredVaultParticipant[]): readonly CosignerCheck[] {
  const digest = currentVerificationDigest(record);
  return participants.filter(p => !p.self).map(p => cosignerCheck(p.credential, record.verifications, digest));
}

// -------------------------------------------------------------------------------------------------
// The funding gate

/**
 * Why deposits from this wallet are blocked:
 * - `CANDIDATE`: the vault is quarantined until accepted;
 * - `NO_MANIFEST`: no accepted manifest, so there is nothing the ceremony could have checked;
 * - `NOT_VERIFIED`: `fundingVerified` does not hold, or could not be checked on this device.
 */
export type FundingBlockReason = 'CANDIDATE' | 'NO_MANIFEST' | 'NOT_VERIFIED';

export type FundingState = { readonly verified: true } | { readonly verified: false; readonly reason: FundingBlockReason };

/**
 * Answers `fundingVerified` for an accepted vault with a manifest: this device's acknowledgement of
 * the latest accepted revision and its verification records (spec 6.1, step 2). False on any doubt.
 */
export type FundingVerifier = (record: VaultRecord) => Promise<boolean>;

/** The default: nothing on this device builds the acknowledgement yet, so funding stays blocked. */
export const noFundingVerifier: FundingVerifier = async () => false;

/** The funding gate for one vault. Never throws: a verifier that fails counts as not verified. */
export async function fundingState(record: VaultRecord, verifier: FundingVerifier = noFundingVerifier): Promise<FundingState> {
  if (record.status !== 'accepted') return { verified: false, reason: 'CANDIDATE' };
  if (!record.manifest) return { verified: false, reason: 'NO_MANIFEST' };
  let verified = false;
  try {
    verified = (await verifier(record)) === true;
  } catch {
    verified = false;
  }
  return verified ? { verified: true } : { verified: false, reason: 'NOT_VERIFIED' };
}

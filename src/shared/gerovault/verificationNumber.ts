/**
 * The verification ceremony and the funding gate (spec 5.3, 6.1; GV-61 #1729).
 *
 * Before anyone funds a vault, its cosigners compare the vault's keys with each other outside the
 * relay. What they compare is the verification set: the network, the two scripts, and every
 * participant with a script key as `{ credential, vaultKeys }`. Device bindings, viewers and
 * labels are not in it (each revision's attestations cover those), so only a change of keys or
 * scripts asks for the ceremony again.
 *
 * - The verification number: 40 decimal digits in 8 groups of 5, read aloud by voice or video.
 *   `d = blake2b(dkLen 40)( "gero-vault/v1|verification-number|" || canonical CBOR of the set )`,
 *   and group i (0 to 7) is the big-endian integer of `d[5i .. 5i+5]` modulo 100000, written with
 *   leading zeros: about 132.9 bits. They are digits, not words, so nobody ever reads a list of
 *   words to another person, and the screen tells users plainly that these are not recovery words.
 * - The QR, scanned in person: `gero-vault/v1|VERIFY|<network>|<vaultId>|<verificationDigest>`,
 *   with the full 256-bit `blake2b-256( "gero-vault/v1|verification|" || canonical CBOR of the set )`.
 * - An external cosigner, who has no Gero device, signs the verification digest with their vault
 *   payment key in an expired transaction (`attestation.ts`, method 1). The file comes from them to
 *   an owner other than the one who imported their keys, wherever there is one.
 *
 * Checks through a data provider (an ADA Handle, a known address, a shared vault) are recorded and
 * shown as resolved by a provider; they never verify anyone. There is no value threshold.
 *
 * PROVISIONAL: the tags, the QR payload and the vectors are fixed with the other clients' vectors
 * (GV-07 #1675).
 */
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { ATTESTATION_METHOD, AttestationRefusalCode, verifyAttestation } from './attestation';
import { bytesToHex, hexToBytes } from './cbor';
import { CborWritableMap, encodeCanonicalCbor } from './canonicalCbor';
import { GeroVaultError } from './errors';
import { MANIFEST_PROTOCOL, VaultManifest, WIRE_NETWORK, manifestHash, manifestScripts, normalizeManifest, taggedHash } from './manifest';
import type { ManifestAck } from './manifestCheck';
import { parseVaultScript } from './scripts';
import { VaultNetwork, VaultPublicKeys } from './types';

export const VERIFICATION_DIGEST_TAG = 'gero-vault/v1|verification|';
export const VERIFICATION_NUMBER_TAG = 'gero-vault/v1|verification-number|';
export const VERIFICATION_NUMBER_GROUPS = 8;
const NUMBER_BYTES = 40;
const GROUP_BYTES = 5;

const HEX32 = /^[0-9a-f]{64}$/;
const KEY_HASH = /^[0-9a-f]{56}$/;

function verificationSetBytes(manifest: VaultManifest): Uint8Array {
  const m = normalizeManifest(manifest);
  const keys = (k: VaultPublicKeys): CborWritableMap => ({ payment: hexToBytes(k.payment), stake: hexToBytes(k.stake) });
  const entry = (e: { credential: string; vaultKeys: VaultPublicKeys }): CborWritableMap => ({
    credential: hexToBytes(e.credential),
    vaultKeys: keys(e.vaultKeys),
  });
  return encodeCanonicalCbor({
    network: WIRE_NETWORK[m.network],
    paymentScript: hexToBytes(m.paymentScript),
    stakeScript: hexToBytes(m.stakeScript),
    owners: m.roles.owners.map(entry),
    backupHolders: m.roles.backupHolders.map(entry),
    guardians: m.roles.guardians.map(entry),
    external: m.roles.external.map(entry),
  });
}

/** The canonical CBOR of the verification set, hex. Throws `GeroVaultError('INVALID_MANIFEST')`. */
export function verificationSetCbor(manifest: VaultManifest): string {
  return bytesToHex(verificationSetBytes(manifest));
}

/** `blake2b-256( "gero-vault/v1|verification|" || verification set )`, hex: the QR's value. */
export function verificationDigest(manifest: VaultManifest): string {
  return taggedHash(VERIFICATION_DIGEST_TAG, verificationSetBytes(manifest));
}

/** The 8 groups of 5 digits of a 40-byte number digest. */
export function verificationNumberGroups(digest: string): readonly string[] {
  if (typeof digest !== 'string' || !/^[0-9a-f]{80}$/.test(digest)) {
    throw new GeroVaultError('INVALID_VERIFICATION', 'A verification number digest is 40 bytes of lowercase hex');
  }
  const d = hexToBytes(digest);
  const out: string[] = [];
  for (let i = 0; i < VERIFICATION_NUMBER_GROUPS; i++) {
    let n = 0n;
    for (const byte of d.subarray(GROUP_BYTES * i, GROUP_BYTES * (i + 1))) n = (n << 8n) | BigInt(byte);
    out.push((n % 100000n).toString().padStart(5, '0'));
  }
  return Object.freeze(out);
}

/** The digest the number comes from, 40 bytes as hex. */
export function verificationNumberDigest(manifest: VaultManifest): string {
  const tag = new TextEncoder().encode(VERIFICATION_NUMBER_TAG);
  const set = verificationSetBytes(manifest);
  const preimage = new Uint8Array(tag.length + set.length);
  preimage.set(tag, 0);
  preimage.set(set, tag.length);
  return bytesToHex(blake2b(preimage, { dkLen: NUMBER_BYTES }));
}

/** The verification number both cosigners read out: 8 groups of 5 digits. */
export function verificationNumber(manifest: VaultManifest): readonly string[] {
  return verificationNumberGroups(verificationNumberDigest(manifest));
}

// ---------------------------------------------------------------------------------------------
// QR in person

export const VERIFICATION_QR_TYPE = 'VERIFY';
const QR_MAX_LENGTH = 256;

/** `gero-vault/v1|VERIFY|<network>|<vaultId>|<verificationDigest>`, lowercase hex. */
export function verificationQrPayload(manifest: VaultManifest): string {
  const m = normalizeManifest(manifest);
  return [MANIFEST_PROTOCOL, VERIFICATION_QR_TYPE, WIRE_NETWORK[m.network], m.vaultId, verificationDigest(m)].join('|');
}

export interface VerificationQr {
  readonly network: VaultNetwork;
  readonly vaultId: string;
  readonly verificationDigest: string;
}

export type ParseVerificationQrResult = { readonly ok: true; readonly qr: VerificationQr } | { readonly ok: false; readonly code: 'MALFORMED_QR' };

/** Reads a scanned payload. Never throws. */
export function parseVerificationQr(payload: unknown): ParseVerificationQrResult {
  const malformed = { ok: false, code: 'MALFORMED_QR' } as const;
  if (typeof payload !== 'string' || payload.length > QR_MAX_LENGTH) return malformed;
  const parts = payload.split('|');
  if (parts.length !== 5 || parts[0] !== MANIFEST_PROTOCOL || parts[1] !== VERIFICATION_QR_TYPE) return malformed;
  const network = (Object.keys(WIRE_NETWORK) as VaultNetwork[]).find(n => WIRE_NETWORK[n] === parts[2]);
  if (!network || !HEX32.test(parts[3]) || !HEX32.test(parts[4])) return malformed;
  return { ok: true, qr: Object.freeze({ network, vaultId: parts[3], verificationDigest: parts[4] }) };
}

/**
 * Compares a scanned payload with this device's manifest. Only `MATCH` verifies the cosigner:
 * `DIFFERENT_KEYS` is the same vault id with another verification set. Throws only for an invalid
 * local manifest.
 */
export type VerificationQrComparison = 'MATCH' | 'OTHER_VAULT' | 'DIFFERENT_KEYS' | 'MALFORMED_QR';

export function compareVerificationQr(payload: unknown, manifest: VaultManifest): VerificationQrComparison {
  const m = normalizeManifest(manifest);
  const parsed = parseVerificationQr(payload);
  if (parsed.ok === false) return 'MALFORMED_QR';
  if (parsed.qr.network !== m.network || parsed.qr.vaultId !== m.vaultId) return 'OTHER_VAULT';
  return parsed.qr.verificationDigest === verificationDigest(m) ? 'MATCH' : 'DIFFERENT_KEYS';
}

// ---------------------------------------------------------------------------------------------
// Verification records

/** Checks resolved through a data provider: shown, never sufficient. */
export type ProviderCheck = 'adaHandle' | 'knownAddress' | 'sharedVault';
const PROVIDER_CHECKS: readonly ProviderCheck[] = ['adaHandle', 'knownAddress', 'sharedVault'];

/**
 * How this device verified one cosigner, kept in its own vault record. Number, QR and external
 * records are bound to the verification digest they compared.
 */
export type CosignerVerification =
  | {
      readonly method: 'number' | 'qr';
      readonly credential: Ed25519KeyHashHex;
      readonly verificationDigest: string;
      /** Unix seconds. */
      readonly at: number;
    }
  | {
      /** An external cosigner's attestation of the verification digest (method 1, `attestation.ts`). */
      readonly method: 'external';
      readonly credential: Ed25519KeyHashHex;
      readonly verificationDigest: string;
      /** The expired transaction, hex. */
      readonly proof: string;
      /** The owner whose device received the file from the external cosigner. */
      readonly receivedBy: Ed25519KeyHashHex;
      readonly at: number;
    }
  | {
      readonly method: 'provider';
      readonly provider: ProviderCheck;
      readonly credential: Ed25519KeyHashHex;
      readonly at: number;
    };

function assertCredential(credential: unknown): asserts credential is Ed25519KeyHashHex {
  if (typeof credential !== 'string' || !KEY_HASH.test(credential)) {
    throw new GeroVaultError('INVALID_KEY_HASH', 'A cosigner is named by a payment key hash, 28 bytes of lowercase hex');
  }
}

function assertTime(at: unknown): asserts at is number {
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) throw new GeroVaultError('INVALID_TIME', 'A time is unix seconds');
}

/** The record for a Gero cosigner whose verification number the user confirmed matches. */
export function numberVerification(manifest: VaultManifest, credential: Ed25519KeyHashHex, at: number): CosignerVerification {
  assertCredential(credential);
  assertTime(at);
  return Object.freeze({ method: 'number', credential, verificationDigest: verificationDigest(manifest), at });
}

/** The record for a Gero cosigner whose QR this device scanned; `undefined` unless it is a `MATCH`. */
export function qrVerification(manifest: VaultManifest, credential: Ed25519KeyHashHex, payload: unknown, at: number): CosignerVerification | undefined {
  assertCredential(credential);
  assertTime(at);
  if (compareVerificationQr(payload, manifest) !== 'MATCH') return undefined;
  return Object.freeze({ method: 'qr', credential, verificationDigest: verificationDigest(manifest), at });
}

/** The record for a check resolved through a provider. It never satisfies the requirement. */
export function providerResolution(credential: Ed25519KeyHashHex, provider: ProviderCheck, at: number): CosignerVerification {
  assertCredential(credential);
  assertTime(at);
  if (!PROVIDER_CHECKS.includes(provider)) throw new GeroVaultError('INVALID_VERIFICATION', 'Unknown provider check');
  return Object.freeze({ method: 'provider', provider, credential, at });
}

export type ExternalVerificationRefusal = 'NOT_AN_EXTERNAL' | 'NOT_AN_OWNER' | 'WRONG_ROUTE' | AttestationRefusalCode;

interface ExternalRoute {
  readonly importedBy: string;
  readonly owners: readonly string[];
}

function routeAllowed(route: ExternalRoute, receivedBy: string): boolean {
  if (!route.owners.includes(receivedBy)) return false;
  return receivedBy !== route.importedBy || route.owners.every(o => o === route.importedBy);
}

async function checkExternalRecord(
  m: VaultManifest,
  digest: string,
  credential: string,
  proof: unknown,
  receivedBy: unknown,
): Promise<'OK' | ExternalVerificationRefusal> {
  const external = m.roles.external.find(e => e.credential === credential);
  if (!external) return 'NOT_AN_EXTERNAL';
  const owners = m.roles.owners.map(e => e.credential as string);
  if (typeof receivedBy !== 'string' || !owners.includes(receivedBy)) return 'NOT_AN_OWNER';
  const check = await verifyAttestation({ method: ATTESTATION_METHOD.EXPIRED_TX, proof: proof as string }, credential, { kind: 'verification', digest });
  if (check.ok === false) return check.code;
  return routeAllowed({ importedBy: external.importedBy, owners }, receivedBy) ? 'OK' : 'WRONG_ROUTE';
}

/**
 * The record for an external cosigner, from the expired transaction they signed over this vault's
 * verification digest and the owner (`receivedBy`) whose device received it from them. Refused
 * when the proof does not verify, or when `receivedBy` is the owner who imported the external's
 * keys while another owner exists.
 */
export async function externalVerification(
  manifest: VaultManifest,
  credential: Ed25519KeyHashHex,
  proof: string,
  receivedBy: Ed25519KeyHashHex,
  at: number,
): Promise<{ readonly ok: true; readonly record: CosignerVerification } | { readonly ok: false; readonly code: ExternalVerificationRefusal }> {
  assertCredential(credential);
  assertTime(at);
  const m = normalizeManifest(manifest);
  const digest = verificationDigest(m);
  const result = await checkExternalRecord(m, digest, credential, proof, receivedBy);
  if (result !== 'OK') return { ok: false, code: result };
  return { ok: true, record: Object.freeze({ method: 'external', credential, verificationDigest: digest, proof, receivedBy, at }) };
}

// ---------------------------------------------------------------------------------------------
// The funding gate

export type CosignerRole = 'owner' | 'backupHolder' | 'external';

/**
 * - `verified`: by the number or the QR (a Gero cosigner), or by their own attestation received by
 *   a second owner (an external cosigner), for this verification set;
 * - `importerOnly`: an external cosigner's attestation reached only the owner who imported their
 *   keys, while another owner exists;
 * - `stale`: verified for another verification set only: verify again;
 * - `providerOnly`: resolved by a provider only;
 * - `unverified`: nothing recorded.
 */
export type CosignerVerificationState = 'verified' | 'importerOnly' | 'stale' | 'providerOnly' | 'unverified';

export interface CosignerStatus {
  readonly credential: Ed25519KeyHashHex;
  readonly role: CosignerRole;
  readonly state: CosignerVerificationState;
  /** How a `verified` cosigner was verified (the QR when both were done). */
  readonly method?: 'number' | 'qr' | 'external';
  /** Provider checks recorded for this cosigner, to show as "resolved by a provider". */
  readonly providers: readonly ProviderCheck[];
}

function ackMatches(m: VaultManifest, ack: ManifestAck): boolean {
  return ack?.ok === true && ack.vaultId === m.vaultId && ack.manifestHash === manifestHash(m);
}

function wellFormed(r: CosignerVerification): boolean {
  if (!r || typeof r !== 'object' || typeof r.credential !== 'string' || !KEY_HASH.test(r.credential)) return false;
  if (r.method === 'provider') return PROVIDER_CHECKS.includes(r.provider);
  return (r.method === 'number' || r.method === 'qr' || r.method === 'external')
    && typeof r.verificationDigest === 'string' && HEX32.test(r.verificationDigest);
}

/**
 * How this device verified each cosigner. The cosigners are read from the scripts: every payment
 * key of both branches except this device's own (`ack.ownCredential`). `ack` must be the result of
 * `checkManifestBeforeAck` for this very manifest. External records are verified again here.
 * Throws for an invalid manifest or an ack of another manifest.
 */
export async function cosignerVerificationStatus(
  manifest: VaultManifest,
  ack: ManifestAck,
  records: readonly CosignerVerification[],
): Promise<readonly CosignerStatus[]> {
  const m = normalizeManifest(manifest);
  if (!ackMatches(m, ack)) throw new GeroVaultError('INVALID_VERIFICATION', 'The acknowledgement is of another manifest');
  const digest = verificationDigest(m);
  const { payment } = manifestScripts(m);
  const parsed = parseVaultScript(payment.script);
  const inScripts = [...parsed.owners, ...(parsed.kind === 'backup' ? parsed.backups : [])];
  const roleOf = (credential: string): CosignerRole =>
    m.roles.owners.some(e => e.credential === credential) ? 'owner'
      : m.roles.backupHolders.some(e => e.credential === credential) ? 'backupHolder' : 'external';
  const valid = (Array.isArray(records) ? records : []).filter(wellFormed);
  const out: CosignerStatus[] = [];
  for (const credential of inScripts.filter(c => c !== ack.ownCredential).sort()) {
    const role = roleOf(credential);
    const mine = valid.filter(r => r.credential === credential);
    const providers = PROVIDER_CHECKS.filter(p => mine.some(r => r.method === 'provider' && r.provider === p));
    let state: CosignerVerificationState = providers.length > 0 ? 'providerOnly' : 'unverified';
    let method: CosignerStatus['method'];
    if (role === 'external') {
      const attested = mine.filter((r): r is Extract<CosignerVerification, { method: 'external' }> => r.method === 'external');
      if (attested.some(r => r.verificationDigest !== digest)) state = 'stale';
      for (const r of attested.filter(x => x.verificationDigest === digest)) {
        const result = await checkExternalRecord(m, digest, credential, r.proof, r.receivedBy);
        if (result === 'OK') {
          state = 'verified';
          method = 'external';
          break;
        }
        if (result === 'WRONG_ROUTE') state = 'importerOnly';
      }
    } else {
      const ceremony = mine.filter((r): r is Extract<CosignerVerification, { method: 'number' | 'qr' }> => r.method === 'number' || r.method === 'qr');
      const current = ceremony.filter(r => r.verificationDigest === digest);
      method = current.some(r => r.method === 'qr') ? 'qr' : current.length > 0 ? 'number' : undefined;
      if (method) state = 'verified';
      else if (ceremony.length > 0) state = 'stale';
    }
    out.push(Object.freeze({ credential, role, state, ...(method ? { method } : {}), providers: Object.freeze(providers) }));
  }
  return Object.freeze(out);
}

/**
 * The ceremony step of the funding order (spec 6.1): true only when `ack` is this device's
 * successful check of this very manifest with every change authorised (`attestationsVerified`),
 * and every cosigner the scripts name, other than this device, is `verified`. It takes no amount:
 * there is no value below which the ceremony may be skipped. The other steps of the funding order
 * are checked elsewhere. Never throws.
 */
export async function fundingVerified(manifest: VaultManifest, ack: ManifestAck, records: readonly CosignerVerification[]): Promise<boolean> {
  try {
    if (ack?.ok !== true || ack.attestationsVerified !== true) return false;
    const status = await cosignerVerificationStatus(manifest, ack, records);
    return status.length > 0 && status.every(c => c.state === 'verified');
  } catch {
    return false;
  }
}

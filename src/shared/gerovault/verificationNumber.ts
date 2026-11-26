/**
 * The verification ceremony and the funding gate (spec 5.3, 6.1; GV-61 #1729).
 *
 * Before anyone funds a vault, its cosigners compare the vault's keys with each other outside the
 * relay. What they compare is the verification set: the network, the two scripts, and every
 * participant with a script key as `{ credential, vaultKeys }`. Device bindings, viewers and
 * labels are not in it (each revision's signatures cover those), so only a change of keys or
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
 *   payment key in an expired transaction (`attestation.ts`, method 1). The file must reach an
 *   owner other than the one who imported their keys, by a route the importer does not control.
 *   That owner's device records it, and endorses it for the other devices: an endorsement is
 *   signed by the receiving device over the verification digest, the external's credential and the
 *   attestation's hash. It is stored per vault, not in the manifest. Software cannot prove where a
 *   file came from: an importer who substituted a key they hold can sign for it themselves, which is
 *   why the attestation must come from the external person directly.
 *
 * Checks through a data provider (an ADA Handle, a known address, a shared vault) are recorded and
 * shown as resolved by a provider; they never verify anyone. There is no value threshold.
 *
 * PROVISIONAL: the tags, the QR payload and the vectors are fixed with the other clients' vectors
 * (GV-07 #1675).
 */
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { ATTESTATION_METHOD, AttestationRefusalCode, ingestAttestation, verifyAttestation, verifyEd25519 } from './attestation';
import { bytesToHex, hexToBytes } from './cbor';
import { CborWritableMap, encodeCanonicalCbor } from './canonicalCbor';
import { GeroVaultError } from './errors';
import {
  MANIFEST_PROTOCOL,
  VaultManifest,
  WIRE_NETWORK,
  bindingDigest,
  manifestHash,
  manifestScripts,
  normalizeManifest,
  taggedHash,
  verifyDeviceSignature,
} from './manifest';
import { isManifestAck } from './ackBrand';
import type { ManifestAck } from './manifestCheck';
import { parseVaultScript } from './scripts';
import { VaultNetwork, VaultPublicKeys } from './types';

export const VERIFICATION_DIGEST_TAG = 'gero-vault/v1|verification|';
export const VERIFICATION_NUMBER_TAG = 'gero-vault/v1|verification-number|';
export const EXTERNAL_ENDORSEMENT_TAG = 'gero-vault/v1|external-endorsement|';
export const VERIFICATION_NUMBER_GROUPS = 8;
const NUMBER_BYTES = 40;
const GROUP_BYTES = 5;

const HEX16 = /^[0-9a-f]{32}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{128}$/;
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
// External endorsements

/** What an owner device signs when its owner received an external's attestation directly. */
export interface ExternalEndorsementBody {
  readonly verificationDigest: string;
  readonly externalCredential: Ed25519KeyHashHex;
  /** `blake2b-256` of the external attestation's stored proof bytes. */
  readonly externalAttestationHash: string;
  readonly endorserDeviceId: string;
}

export interface ExternalEndorsement extends ExternalEndorsementBody {
  /** 64 bytes, lowercase hex: by the endorsing device's key over `externalEndorsementDigest`. */
  readonly signature: string;
}

/** The hash an endorsement names: `blake2b-256` of the attestation's stored proof bytes, hex. */
export function externalAttestationHash(proof: string): string {
  const bytes = typeof proof === 'string' && /^(?:[0-9a-f]{2})+$/.test(proof) ? hexToBytes(proof) : undefined;
  if (!bytes) throw new GeroVaultError('INVALID_VERIFICATION', 'A proof is lowercase hex');
  return bytesToHex(blake2b(bytes, { dkLen: 32 }));
}

function endorsementBodyOk(e: ExternalEndorsementBody): boolean {
  return Boolean(e) && typeof e === 'object' && HEX32.test(e.verificationDigest ?? '') && KEY_HASH.test(e.externalCredential ?? '')
    && HEX32.test(e.externalAttestationHash ?? '') && HEX16.test(e.endorserDeviceId ?? '');
}

/**
 * What the endorsing device signs:
 * `blake2b-256( "gero-vault/v1|external-endorsement|" || CBOR of { verificationDigest, externalCredential, externalAttestationHash, endorserDeviceId } )`.
 */
export function externalEndorsementDigest(body: ExternalEndorsementBody): string {
  if (!endorsementBodyOk(body)) throw new GeroVaultError('INVALID_VERIFICATION', 'An endorsement names a digest, a credential, a hash and a device');
  return taggedHash(EXTERNAL_ENDORSEMENT_TAG, encodeCanonicalCbor({
    verificationDigest: hexToBytes(body.verificationDigest),
    externalCredential: hexToBytes(body.externalCredential),
    externalAttestationHash: hexToBytes(body.externalAttestationHash),
    endorserDeviceId: hexToBytes(body.endorserDeviceId),
  }));
}

/** The body this device signs to endorse an external's attestation it received directly. */
export function externalEndorsementBody(
  manifest: VaultManifest,
  externalCredential: Ed25519KeyHashHex,
  proof: string,
  endorserDeviceId: string,
): ExternalEndorsementBody {
  const body = { verificationDigest: verificationDigest(manifest), externalCredential, externalAttestationHash: externalAttestationHash(proof), endorserDeviceId };
  if (!endorsementBodyOk(body)) throw new GeroVaultError('INVALID_VERIFICATION', 'An endorsement names a credential and a device');
  return Object.freeze(body);
}

export type EndorsementRefusalCode =
  | 'MALFORMED'
  | 'DIGEST_MISMATCH'
  | 'NOT_AN_EXTERNAL'
  | 'UNBOUND_DEVICE'
  | 'ENDORSER_IS_IMPORTER'
  | 'ATTESTATION_HASH_MISMATCH'
  | 'BAD_SIGNATURE'
  | AttestationRefusalCode;

/**
 * An endorsement is valid when its digest is this manifest's verification digest, the endorsing
 * device's binding is an owner's in the manifest with a verified owner attestation, that owner is
 * not the external's importer, the attestation it names verifies against the external's key over
 * the same digest, and the endorsing device signed it. Never throws.
 */
export async function verifyExternalEndorsement(
  manifest: VaultManifest,
  endorsement: ExternalEndorsement,
  proof: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: EndorsementRefusalCode }> {
  try {
    if (!endorsementBodyOk(endorsement) || !HEX64.test(endorsement.signature ?? '')) return { ok: false, code: 'MALFORMED' };
    const m = normalizeManifest(manifest);
    const digest = verificationDigest(m);
    if (endorsement.verificationDigest !== digest) return { ok: false, code: 'DIGEST_MISMATCH' };
    const external = m.roles.external.find(e => e.credential === endorsement.externalCredential);
    if (!external) return { ok: false, code: 'NOT_AN_EXTERNAL' };
    const owner = m.roles.owners.find(e => e.devices.some(d => d.deviceId === endorsement.endorserDeviceId));
    const device = owner?.devices.find(d => d.deviceId === endorsement.endorserDeviceId);
    if (!device) return { ok: false, code: 'UNBOUND_DEVICE' };
    const attested = await verifyDeviceSignature(device)
      && (await verifyAttestation(device.attestation, owner.credential, { kind: 'binding', digest: bindingDigest(device) })).ok;
    if (!attested) return { ok: false, code: 'UNBOUND_DEVICE' };
    if (owner.credential === external.importedBy) return { ok: false, code: 'ENDORSER_IS_IMPORTER' };
    if (externalAttestationHash(proof) !== endorsement.externalAttestationHash) return { ok: false, code: 'ATTESTATION_HASH_MISMATCH' };
    const check = await verifyAttestation({ method: ATTESTATION_METHOD.EXPIRED_TX, proof }, external.credential, { kind: 'verification', digest });
    if (check.ok === false) return check;
    const signed = await verifyEd25519(hexToBytes(device.ed25519Pub), hexToBytes(endorsement.signature), hexToBytes(externalEndorsementDigest(endorsement)));
    return signed ? { ok: true } : { ok: false, code: 'BAD_SIGNATURE' };
  } catch {
    return { ok: false, code: 'MALFORMED' };
  }
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
      /** An external cosigner's attestation this device's owner received directly. */
      readonly method: 'external';
      readonly credential: Ed25519KeyHashHex;
      readonly verificationDigest: string;
      /** The expired transaction in its stored form, hex. */
      readonly proof: string;
      readonly at: number;
    }
  | {
      /** An external cosigner's attestation another owner received, with that owner device's endorsement. */
      readonly method: 'endorsed';
      readonly credential: Ed25519KeyHashHex;
      readonly verificationDigest: string;
      readonly proof: string;
      readonly endorsement: ExternalEndorsement;
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

export type ExternalVerificationRefusal = 'NOT_AN_EXTERNAL' | 'NOT_AN_OWNER' | 'WRONG_ROUTE' | 'INVALID_ACK' | AttestationRefusalCode;

function ackMatches(m: VaultManifest, ack: ManifestAck): boolean {
  return isManifestAck(ack) && ack.vaultId === m.vaultId && ack.manifestHash === manifestHash(m);
}

/** The importer is the only Gero owner: then the attestation alone suffices. */
function importerIsOnlyOwner(m: VaultManifest, importedBy: string): boolean {
  return m.roles.owners.every(e => e.credential === importedBy);
}

/**
 * The record for an external cosigner whose attestation (the expired transaction over this
 * vault's verification digest) this device's owner received directly from them. The proof is
 * taken as a wallet returned it and stored in its canonical form. Refused when this device's
 * owner imported the external's keys while another owner exists: that owner must receive it.
 */
export async function externalVerification(
  manifest: VaultManifest,
  ack: ManifestAck,
  credential: Ed25519KeyHashHex,
  proof: string,
  at: number,
): Promise<{ readonly ok: true; readonly record: CosignerVerification } | { readonly ok: false; readonly code: ExternalVerificationRefusal }> {
  assertCredential(credential);
  assertTime(at);
  const m = normalizeManifest(manifest);
  if (!ackMatches(m, ack)) return { ok: false, code: 'INVALID_ACK' };
  const external = m.roles.external.find(e => e.credential === credential);
  if (!external) return { ok: false, code: 'NOT_AN_EXTERNAL' };
  if (ack.ownRole !== 'owner') return { ok: false, code: 'NOT_AN_OWNER' };
  const digest = verificationDigest(m);
  const ingested = await ingestAttestation({ method: ATTESTATION_METHOD.EXPIRED_TX, proof }, credential, { kind: 'verification', digest });
  if (ingested.ok === false) return ingested;
  if (ack.ownCredential === external.importedBy && !importerIsOnlyOwner(m, external.importedBy)) return { ok: false, code: 'WRONG_ROUTE' };
  return { ok: true, record: Object.freeze({ method: 'external', credential, verificationDigest: digest, proof: ingested.attestation.proof, at }) };
}

/** The record for an external cosigner verified by another owner device's endorsement. */
export async function endorsedVerification(
  manifest: VaultManifest,
  endorsement: ExternalEndorsement,
  proof: string,
  at: number,
): Promise<{ readonly ok: true; readonly record: CosignerVerification } | { readonly ok: false; readonly code: EndorsementRefusalCode }> {
  assertTime(at);
  const check = await verifyExternalEndorsement(manifest, endorsement, proof);
  if (check.ok === false) return check;
  return {
    ok: true,
    record: Object.freeze({
      method: 'endorsed',
      credential: endorsement.externalCredential,
      verificationDigest: endorsement.verificationDigest,
      proof,
      endorsement: Object.freeze({ ...endorsement }),
      at,
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// The funding gate

export type CosignerRole = 'owner' | 'backupHolder' | 'external';

/**
 * - `verified`: by the number or the QR (a Gero cosigner), or by their own attestation received by
 *   an owner other than their importer (an external cosigner), for this verification set;
 * - `importerOnly`: an external cosigner's attestation reached only their importer, while another
 *   owner exists;
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
  readonly method?: 'number' | 'qr' | 'external' | 'endorsed';
  /** For an owner or backup holder: whether they have a device binding with a verified attestation. */
  readonly attested?: boolean;
  /** Provider checks recorded for this cosigner, to show as "resolved by a provider". */
  readonly providers: readonly ProviderCheck[];
}

function wellFormed(r: CosignerVerification): boolean {
  if (!r || typeof r !== 'object' || typeof r.credential !== 'string' || !KEY_HASH.test(r.credential)) return false;
  if (r.method === 'provider') return PROVIDER_CHECKS.includes(r.provider);
  return (r.method === 'number' || r.method === 'qr' || r.method === 'external' || r.method === 'endorsed')
    && typeof r.verificationDigest === 'string' && HEX32.test(r.verificationDigest);
}

type AttestationRecord = Extract<CosignerVerification, { method: 'external' | 'endorsed' }>;

/**
 * How this device verified each cosigner. The cosigners are read from the scripts: every payment
 * key of both branches except this device's own (`ack.ownCredential`). `ack` must be the result
 * of `checkManifestBeforeAck` for this very manifest (the latest accepted revision). External
 * records are verified again here. Throws for an invalid manifest or an ack of another manifest.
 */
export async function cosignerVerificationStatus(
  manifest: VaultManifest,
  ack: ManifestAck,
  records: readonly CosignerVerification[],
): Promise<readonly CosignerStatus[]> {
  const m = normalizeManifest(manifest);
  if (!ackMatches(m, ack)) throw new GeroVaultError('INVALID_VERIFICATION', 'The acknowledgement is not this device\'s check of this manifest');
  const digest = verificationDigest(m);
  const { payment } = manifestScripts(m);
  const parsed = parseVaultScript(payment.script);
  const inScripts = [...parsed.owners, ...(parsed.kind === 'backup' ? parsed.backups : [])];
  const valid = (Array.isArray(records) ? records : []).filter(wellFormed);
  const out: CosignerStatus[] = [];
  for (const credential of inScripts.filter(c => c !== ack.ownCredential).sort()) {
    const asGero = [...m.roles.owners, ...m.roles.backupHolders].find(e => e.credential === credential);
    const external = m.roles.external.find(e => e.credential === credential);
    const role: CosignerRole = m.roles.owners.some(e => e.credential === credential) ? 'owner' : asGero ? 'backupHolder' : 'external';
    const mine = valid.filter(r => r.credential === credential);
    const providers = PROVIDER_CHECKS.filter(p => mine.some(r => r.method === 'provider' && r.provider === p));
    let state: CosignerVerificationState = providers.length > 0 ? 'providerOnly' : 'unverified';
    let method: CosignerStatus['method'];
    if (external) {
      const attested = mine.filter((r): r is AttestationRecord => r.method === 'external' || r.method === 'endorsed');
      if (attested.some(r => r.verificationDigest !== digest)) state = 'stale';
      const onlyOwner = importerIsOnlyOwner(m, external.importedBy);
      for (const r of attested.filter(x => x.verificationDigest === digest)) {
        if (r.method === 'endorsed') {
          if ((await verifyExternalEndorsement(m, r.endorsement, r.proof)).ok && r.endorsement.externalCredential === credential) {
            state = 'verified';
            method = 'endorsed';
            break;
          }
          continue;
        }
        const proofOk = (await verifyAttestation({ method: ATTESTATION_METHOD.EXPIRED_TX, proof: r.proof }, credential, { kind: 'verification', digest })).ok;
        if (!proofOk) continue;
        if (onlyOwner || (ack.ownRole === 'owner' && ack.ownCredential !== external.importedBy)) {
          state = 'verified';
          method = 'external';
          break;
        }
        state = 'importerOnly';
      }
      out.push(Object.freeze({ credential, role, state, ...(method ? { method } : {}), providers: Object.freeze(providers) }));
      continue;
    }
    const ceremony = mine.filter((r): r is Extract<CosignerVerification, { method: 'number' | 'qr' }> => r.method === 'number' || r.method === 'qr');
    const current = ceremony.filter(r => r.verificationDigest === digest);
    method = current.some(r => r.method === 'qr') ? 'qr' : current.length > 0 ? 'number' : undefined;
    if (method) state = 'verified';
    else if (ceremony.length > 0) state = 'stale';
    out.push(Object.freeze({
      credential,
      role,
      state,
      ...(method ? { method } : {}),
      attested: (asGero?.devices.length ?? 0) > 0,
      providers: Object.freeze(providers),
    }));
  }
  return Object.freeze(out);
}

/**
 * The ceremony step of the funding order (spec 6.1). True only when:
 * - `ack` is this device's check of this very manifest, the latest accepted revision (whether that
 *   revision's own changes were accepted is revision acceptance, not funding);
 * - every owner and backup holder, this device's own participant included, has a device binding
 *   whose owner attestation verified (`ack.unattested` is empty);
 * - every other Gero cosigner is verified by the number or the QR for this verification set;
 * - every external cosigner is verified by their own attestation: received directly by this
 *   device's owner when that owner did not import them, or endorsed by another owner's device, or
 *   alone when their importer is the only owner.
 * It takes no amount: there is no value below which the ceremony may be skipped. Never throws.
 */
export async function fundingVerified(manifest: VaultManifest, ack: ManifestAck, records: readonly CosignerVerification[]): Promise<boolean> {
  try {
    if (!isManifestAck(ack) || ack.unattested.length > 0) return false;
    const status = await cosignerVerificationStatus(manifest, ack, records);
    return status.length > 0 && status.every(c => c.state === 'verified' && c.attested !== false);
  } catch {
    return false;
  }
}

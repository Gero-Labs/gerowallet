/**
 * The verification ceremony (spec 5.3, 6.1; GV-61 #1729).
 *
 * Until a vault is funded, the integrity of the exchanged vault keys rests on the relay and on the
 * vault's creator, and the ceremony is the only control. So every cosigner completes one of two
 * methods with this device before any funding, whatever the vault will hold:
 *
 * - 12 words, read out by voice or video. They are the first 132 bits of
 *   `blake2b-256( "gero-vault/v1|safety-code|" || canonical CBOR of the manifest )`, read most
 *   significant bit first as 12 indexes of 11 bits into the BIP-39 English wordlist. There is no
 *   checksum word: the 12 words are not a mnemonic and encode no key.
 * - QR in person: the full 256-bit manifest hash (`manifestHash`), compared by scanning a QR code.
 *
 * Why 132 bits: whoever controls what goes into two manifests can search for a pair that shows the
 * same code. With n bits that takes about 2^(n/2) attempts: about 2^30 for a 60-bit code, about
 * 2^66 for this one.
 *
 * A check resolved through a data provider (an ADA Handle, a known address, a shared vault) is
 * recorded and shown as "resolved by a provider" and never satisfies the requirement. There is no
 * value threshold and no commit-then-reveal exchange.
 *
 * PROVISIONAL: the domain tag, the QR payload and the test vectors are fixed with the other
 * clients' vectors (GV-07 #1675).
 */
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { wordlists } from 'bip39';
import { bytesToHex, hexToBytes } from './cbor';
import { GeroVaultError } from './errors';
import { MANIFEST_PROTOCOL, VaultManifest, WIRE_NETWORK, encodeManifest, manifestHash, normalizeManifest } from './manifest';
import { VaultNetwork } from './types';

export const SAFETY_CODE_TAG = 'gero-vault/v1|safety-code|';
export const SAFETY_CODE_WORD_COUNT = 12;
export const SAFETY_CODE_BITS = 132;
const BITS_PER_WORD = 11;

const HEX32 = /^[0-9a-f]{64}$/;
const KEY_HASH = /^[0-9a-f]{56}$/;

function englishWords(): readonly string[] {
  const words = wordlists['english'];
  if (!Array.isArray(words) || words.length !== 1 << BITS_PER_WORD) throw new Error('The BIP-39 English wordlist is not loaded');
  return words;
}

/** The hash the 12 words come from, 32 bytes as hex. Throws `GeroVaultError('INVALID_MANIFEST')`. */
export function safetyCodeDigest(manifest: VaultManifest): string {
  const tag = new TextEncoder().encode(SAFETY_CODE_TAG);
  const cbor = hexToBytes(encodeManifest(manifest));
  const preimage = new Uint8Array(tag.length + cbor.length);
  preimage.set(tag, 0);
  preimage.set(cbor, tag.length);
  return bytesToHex(blake2b(preimage, { dkLen: 32 }));
}

/** The 12 words of a digest: bits 0 to 131, most significant first, 11 bits per word. */
export function safetyCodeWordsFromDigest(digest: string): readonly string[] {
  if (typeof digest !== 'string' || !HEX32.test(digest)) {
    throw new GeroVaultError('INVALID_VERIFICATION', 'A safety code digest is 32 bytes of lowercase hex');
  }
  const bytes = hexToBytes(digest);
  const words = englishWords();
  const out: string[] = [];
  for (let w = 0; w < SAFETY_CODE_WORD_COUNT; w++) {
    let index = 0;
    for (let b = 0; b < BITS_PER_WORD; b++) {
      const bit = w * BITS_PER_WORD + b;
      index = (index << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
    out.push(words[index]);
  }
  return Object.freeze(out);
}

/** The 12 words both cosigners read out for this manifest. */
export function safetyCodeWords(manifest: VaultManifest): readonly string[] {
  return safetyCodeWordsFromDigest(safetyCodeDigest(manifest));
}

// ---------------------------------------------------------------------------------------------
// QR in person

export const SAFETY_QR_TYPE = 'VERIFY';
const QR_MAX_LENGTH = 256;
const VERSION_TEXT = /^[1-9][0-9]{0,9}$/;

/**
 * The QR payload: `gero-vault/v1|VERIFY|<network>|<vaultId>|<version>|<manifestHash>`, network as
 * `gero-xdev/v1` writes it, version in decimal, the rest lowercase hex. The comparison is on the
 * manifest hash; the other fields let the scanning device say which vault and revision it saw.
 */
export function safetyQrPayload(manifest: VaultManifest): string {
  const m = normalizeManifest(manifest);
  return [MANIFEST_PROTOCOL, SAFETY_QR_TYPE, WIRE_NETWORK[m.network], m.vaultId, String(m.version), manifestHash(m)].join('|');
}

export interface SafetyQr {
  readonly network: VaultNetwork;
  readonly vaultId: string;
  readonly version: number;
  readonly manifestHash: string;
}

export type ParseSafetyQrResult = { readonly ok: true; readonly qr: SafetyQr } | { readonly ok: false; readonly code: 'MALFORMED_QR' };

/** Reads a scanned payload. Never throws. */
export function parseSafetyQr(payload: unknown): ParseSafetyQrResult {
  const malformed = { ok: false, code: 'MALFORMED_QR' } as const;
  if (typeof payload !== 'string' || payload.length > QR_MAX_LENGTH) return malformed;
  const parts = payload.split('|');
  if (parts.length !== 6 || parts[0] !== MANIFEST_PROTOCOL || parts[1] !== SAFETY_QR_TYPE) return malformed;
  const network = (Object.keys(WIRE_NETWORK) as VaultNetwork[]).find(n => WIRE_NETWORK[n] === parts[2]);
  if (!network || !HEX32.test(parts[3]) || !VERSION_TEXT.test(parts[4]) || !HEX32.test(parts[5])) return malformed;
  const version = Number(parts[4]);
  if (version > 0xffffffff) return malformed;
  return { ok: true, qr: Object.freeze({ network, vaultId: parts[3], version, manifestHash: parts[5] }) };
}

/**
 * Compares a scanned payload with this device's manifest. Only `MATCH` verifies the cosigner;
 * `OTHER_REVISION` means one of the two devices holds another revision of the same vault, and
 * `DIFFERENT_MANIFEST` the same revision with different contents. Throws only for an invalid
 * local manifest.
 */
export type SafetyQrComparison = 'MATCH' | 'OTHER_VAULT' | 'OTHER_REVISION' | 'DIFFERENT_MANIFEST' | 'MALFORMED_QR';

export function compareSafetyQr(payload: unknown, manifest: VaultManifest): SafetyQrComparison {
  const m = normalizeManifest(manifest);
  const parsed = parseSafetyQr(payload);
  if (parsed.ok === false) return 'MALFORMED_QR';
  const { qr } = parsed;
  if (qr.network !== m.network || qr.vaultId !== m.vaultId) return 'OTHER_VAULT';
  if (qr.version !== m.version) return 'OTHER_REVISION';
  return qr.manifestHash === manifestHash(m) ? 'MATCH' : 'DIFFERENT_MANIFEST';
}

// ---------------------------------------------------------------------------------------------
// Verification records and the funding gate

/** Checks resolved through a data provider: shown, never sufficient. */
export type ProviderCheck = 'adaHandle' | 'knownAddress' | 'sharedVault';
const PROVIDER_CHECKS: readonly ProviderCheck[] = ['adaHandle', 'knownAddress', 'sharedVault'];

/**
 * How this device verified one cosigner, kept in its own vault record. A code or QR verification
 * is bound to the manifest hash it compared: a new revision needs a new ceremony.
 */
export type CosignerVerification =
  | {
      readonly method: 'code' | 'qr';
      readonly credential: Ed25519KeyHashHex;
      readonly manifestHash: string;
      /** Unix seconds. */
      readonly at: number;
    }
  | {
      readonly method: 'provider';
      readonly provider: ProviderCheck;
      readonly credential: Ed25519KeyHashHex;
      /** Unix seconds. */
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

/** The record for a cosigner whose 12 words the user confirmed match this manifest's. */
export function codeVerification(manifest: VaultManifest, credential: Ed25519KeyHashHex, at: number): CosignerVerification {
  assertCredential(credential);
  assertTime(at);
  return Object.freeze({ method: 'code', credential, manifestHash: manifestHash(manifest), at });
}

/** The record for a cosigner whose QR this device scanned; `undefined` unless the scan is a `MATCH`. */
export function qrVerification(
  manifest: VaultManifest,
  credential: Ed25519KeyHashHex,
  payload: unknown,
  at: number,
): CosignerVerification | undefined {
  assertCredential(credential);
  assertTime(at);
  if (compareSafetyQr(payload, manifest) !== 'MATCH') return undefined;
  return Object.freeze({ method: 'qr', credential, manifestHash: manifestHash(manifest), at });
}

/** The record for a check resolved through a provider. It never satisfies the requirement. */
export function providerResolution(credential: Ed25519KeyHashHex, provider: ProviderCheck, at: number): CosignerVerification {
  assertCredential(credential);
  assertTime(at);
  if (!PROVIDER_CHECKS.includes(provider)) throw new GeroVaultError('INVALID_VERIFICATION', 'Unknown provider check');
  return Object.freeze({ method: 'provider', provider, credential, at });
}

export type CosignerRole = 'owner' | 'backupHolder' | 'guardian' | 'delegate' | 'external';

/**
 * - `verified`: by the 12 words or the QR, for this manifest;
 * - `stale`: by the words or the QR, for another revision only: verify again;
 * - `providerOnly`: resolved by a provider only;
 * - `unverified`: nothing recorded.
 */
export type CosignerVerificationState = 'verified' | 'stale' | 'providerOnly' | 'unverified';

export interface CosignerStatus {
  readonly credential: Ed25519KeyHashHex;
  readonly role: CosignerRole;
  readonly state: CosignerVerificationState;
  /** How a `verified` cosigner was verified (the QR when both were done). */
  readonly method?: 'code' | 'qr';
  /** Provider checks recorded for this cosigner, to show as "resolved by a provider". */
  readonly providers: readonly ProviderCheck[];
}

function wellFormed(r: CosignerVerification): boolean {
  if (!r || typeof r !== 'object' || typeof r.credential !== 'string' || !KEY_HASH.test(r.credential)) return false;
  if (r.method === 'provider') return PROVIDER_CHECKS.includes(r.provider);
  return (r.method === 'code' || r.method === 'qr') && typeof r.manifestHash === 'string' && HEX32.test(r.manifestHash);
}

/** Everyone with a script key except `self`: owners, backup holders, guardians, delegates, external. */
function cosignersOf(m: VaultManifest, self: string | undefined): { credential: Ed25519KeyHashHex; role: CosignerRole }[] {
  const out: { credential: Ed25519KeyHashHex; role: CosignerRole }[] = [];
  const slots = [[m.roles.owners, 'owner'], [m.roles.backupHolders, 'backupHolder'], [m.roles.guardians, 'guardian'], [m.roles.delegates, 'delegate']] as const;
  for (const [list, role] of slots) for (const e of list) out.push({ credential: e.credential, role });
  for (const e of m.roles.external) out.push({ credential: e.credential, role: 'external' });
  return out.filter(c => c.credential !== self);
}

/**
 * How this device verified each cosigner of the manifest. `self` is this device's own payment key
 * hash, as `checkManifestBeforeAck` derived it from the device's own keys (`ownCredential`), never
 * a value from user input or the relay: whoever `self` names is left out. Omit it on a viewer's
 * device. Malformed records are ignored. Throws only for an invalid manifest.
 */
export function cosignerVerificationStatus(
  manifest: VaultManifest,
  records: readonly CosignerVerification[],
  self?: Ed25519KeyHashHex,
): readonly CosignerStatus[] {
  const m = normalizeManifest(manifest);
  const hash = manifestHash(m);
  const valid = (Array.isArray(records) ? records : []).filter(wellFormed);
  return Object.freeze(cosignersOf(m, self).map(c => {
    const mine = valid.filter(r => r.credential === c.credential);
    const ceremony = mine.filter((r): r is Extract<CosignerVerification, { method: 'code' | 'qr' }> => r.method !== 'provider');
    const current = ceremony.filter(r => r.manifestHash === hash);
    const method = current.some(r => r.method === 'qr') ? 'qr' : current.length > 0 ? 'code' : undefined;
    const providers = PROVIDER_CHECKS.filter(p => mine.some(r => r.method === 'provider' && r.provider === p));
    const state: CosignerVerificationState = method ? 'verified' : ceremony.length > 0 ? 'stale' : providers.length > 0 ? 'providerOnly' : 'unverified';
    return Object.freeze({ credential: c.credential, role: c.role, state, ...(method ? { method } : {}), providers: Object.freeze(providers) });
  }));
}

/**
 * The ceremony step of the funding order (spec 6.1, step 2): true only when this device has
 * verified every cosigner of this manifest by the 12 words or the QR. It takes no amount: there is
 * no value below which the ceremony may be skipped. The other steps of the funding order
 * (acceptance by everyone, signer diversity, the first-spend drill, the caps) are checked
 * elsewhere. `self` is as for `cosignerVerificationStatus`. Never throws: an invalid manifest
 * keeps funding closed.
 */
export function fundingVerified(manifest: VaultManifest, records: readonly CosignerVerification[], self?: Ed25519KeyHashHex): boolean {
  try {
    const status = cosignerVerificationStatus(manifest, records, self);
    return status.length > 0 && status.every(c => c.state === 'verified');
  } catch {
    return false;
  }
}

/**
 * The recovery package payload (spec 6.8, GV-14): what one participant needs, with their seed, to
 * rebuild a vault and spend from it with every Gero service unavailable. It is the plaintext of
 * the file in `recoveryFormat.ts`, and it holds no spending key.
 *
 * Canonical CBOR (RFC 8949 section 4.2.1), written by the library's one canonical writer
 * (`canonicalCbor.ts`): definite lengths, minimal heads, map keys in bytewise order of their
 * encoding (numeric order for the unsigned keys used here). Payload version 1, in CDDL:
 *
 *   payload = {
 *     0: 1,                          ; payload version
 *     1: uint,                       ; network magic: 764824073 mainnet, 1 preprod, 2 preview
 *     2: uint,                       ; exported at, Unix milliseconds
 *     3: native-vault / plutus-vault,
 *     4: self,
 *     5: [+ participant],            ; every participant, the exporter included
 *     6: [* manifest-revision],      ; manifest history, every revision, versions strictly ascending
 *     7: [* proposal-record],        ; proposal history, oldest first
 *     8: [* address-book-entry],     ; address book, oldest entry first
 *     9: [* output-reference],       ; reference-script UTxOs
 *     10: uint,                      ; proposals left out (the oldest, to fit, or not carriable)
 *     11: uint,                      ; address book entries left out, likewise
 *     12: [* endorsement],           ; the vault's external endorsements, never left out
 *     13: [* attestation],           ; the external attestations they cover, never left out
 *   }
 *   native-vault = {
 *     0: 0,
 *     1: bstr,                       ; payment script, canonical CBOR as accepted
 *     2: bstr,                       ; stake script, canonical CBOR as accepted
 *     ? 3: backup-terms,             ; the dated backup path (GV-69); with that template only
 *   }
 *   backup-terms = {
 *     0: uint,                       ; backup threshold
 *     1: uint,                       ; absolute slot the backup path opens at
 *   }
 *   plutus-vault = {
 *     0: 1,
 *     1: output-reference,           ; the seed UTxO the validator is applied to (spec 4.2.1)
 *     2: uint,                       ; template version
 *     3: bstr,                       ; the applied validator, the bytes its Plutus V3 hash covers
 *   }
 *   self = {
 *     0: uint,                       ; the exporter's position in the participants list
 *     1: uint,                       ; the exporter's own vault index (y, or g for a guardian)
 *   }
 *   participant = {
 *     0: uint,                       ; role: 0 owner, 1 backup holder, 2 guardian
 *     1: bstr .size 32,              ; payment vault key, raw Ed25519 (a guardian's key at 0/g)
 *     ? 2: bstr .size 32,            ; stake vault key: always in a native vault, never in a Plutus one
 *     ? 3: external-key,             ; the extended key an external wallet supplied, as received
 *     ? 4: tstr,                     ; label, 1 to 64 bytes: a claim, shown as one
 *   }
 *   external-key = [0, bstr .size 64]                    ; CIP-1854 account key
 *                / [1, bstr .size 64, bstr .size 64]     ; payment and stake role keys
 *   manifest-revision  = [uint, bstr]                    ; version, the manifest's canonical CBOR
 *   proposal-record    = [bstr, bstr]                    ; proposal id, the proposal's own encoding
 *   address-book-entry = [bstr, tstr]                    ; Shelley payment address bytes, label
 *   output-reference   = [bstr .size 32, uint]           ; transaction id, output index
 *   endorsement = {                  ; text keys: the fields the endorsing owner signs (GV-61)
 *     "verificationDigest": bstr .size 32,
 *     "externalCredential": bstr .size 28,
 *     "externalAttestationHash": bstr .size 32,
 *     "endorserCredential": bstr .size 28,
 *     "attestation": attestation,    ; by the endorsing owner's vault payment key
 *   }
 *   attestation = { "method": uint, "proof": bstr }      ; as a manifest stores one (`attestation.ts`)
 *
 * Endorsements and external attestations use the manifest code's own types
 * (`ExternalEndorsement`, `OwnerAttestation`) and field names, and must be in its stored form; their
 * meaning and their signature checks belong to the manifest code (GV-60, GV-61). An external
 * attestation is an external cosigner's expired-transaction proof over the verification digest.
 * They are small and never left out; a package that cannot hold them is refused like one that
 * cannot hold its manifests.
 *
 * Labels follow the read rule of `labels.ts` (well-formed, at most 64 bytes, no control character)
 * and are never empty, in the decoder and at export alike: an export copies existing labels as
 * they are. The write rule applies where a person types a label, before it reaches the wallet.
 *
 * Owners and backup holders appear in native vaults, owners and guardians in Plutus vaults.
 * Native participants carry both vault keys and may be external wallets; Plutus participants
 * carry the payment key only (the stake credential is the validator itself), and guardians are
 * never external wallets.
 *
 * The dated backup path's date is not carried: it is the slot, and a screen shows the slot's time
 * (`backupPathOpensAtMs`). The Plutus validator's hash `h` is not carried either: it is the hash
 * of the validator bytes, which a restore computes and checks against the chain.
 *
 * Manifests and proposals are carried as their own encoded bytes, each manifest at most the
 * manifest codec's `MAX_MANIFEST_BYTES`; this file never reads inside them. Every manifest revision
 * is kept: a revision that cannot be carried is corruption of the wallet's own history, and an
 * export refuses it (`MANIFEST_HISTORY_CORRUPT`). When the rest does not fit, the oldest proposals
 * and the oldest address book entries are left out, and keys 10 and 11 count them
 * (`fitRecoveryHistory`). Address book entries carry no usage time, so "oldest" means added first.
 * The counts are claims from the writer: no reader can tell from them that a history is complete.
 *
 * The decoder takes untrusted bytes and never throws. It uses the strict bounded reader of
 * `cbor.ts`, refuses unknown keys and anything out of bounds, and requires the bytes to be
 * exactly the canonical encoding of what it read.
 *
 * PROVISIONAL: the schema and the vectors are not frozen until they are checked against the other
 * client.
 */
import { Cardano } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Ed25519PublicKeyHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { bech32 } from 'bech32';
import { ATTESTATION_METHOD, MAX_ATTESTATION_BYTES, OwnerAttestation, isCanonicalAttestation } from './attestation';
import { CborWritable, encodeCanonicalCbor } from './canonicalCbor';
import { CborError, CborItem, bytesToHex, hexToBytes, readCbor } from './cbor';
import { GeroVaultError } from './errors';
import { BECH32_PREFIX } from './keys';
import { readLabel } from './labels';
import { MANIFEST_HASH_TAG, MAX_MANIFEST_BYTES, taggedHash } from './manifest';
import { MAX_RECOVERY_PAYLOAD_BYTES } from './recoveryFormat';
import { decodeRegistration } from './registration';
import { ExternalEndorsement, externalEndorsementDigest } from './verificationNumber';
import { NETWORK_MAGIC } from './vaultId';
import { MAX_VAULT_INDEX, ROLE, VaultNetwork, VaultScript } from './types';

export const RECOVERY_PAYLOAD_VERSION = 1;

/** Bounds on a payload. The whole payload also fits the file bound (`MAX_RECOVERY_PAYLOAD_BYTES`). */
export const MAX_PACKAGE_PARTICIPANTS = 64;
/** The same bound as the client's accepted history; the 16 MiB file may bind first. */
export const MAX_MANIFEST_REVISIONS = 16384;
export const MAX_PROPOSALS = 10000;
export const MAX_ADDRESS_BOOK_ENTRIES = 1024;
export const MAX_REFERENCE_SCRIPTS = 16;
export const MAX_ENDORSEMENTS = 256;
export const MAX_EXTERNAL_ATTESTATIONS = 64;
export const MAX_PROPOSAL_BYTES = 65536;
const MAX_SCRIPT_BYTES = 16384;
const MAX_VALIDATOR_BYTES = 65536;
const MAX_PROPOSAL_ID_BYTES = 64;
const MAX_TEMPLATE_VERSION = 0xffffffff;
const MAX_OUTPUT_INDEX = 0xffff;
const PAYLOAD_LIMITS = { maxDepth: 6, maxItems: 131072 };
const BECH32_LIMIT = 1023;
const XPUB_BYTES = 64;

export type PackageRole = 'owner' | 'backup' | 'guardian';
const ROLE_CODES: readonly PackageRole[] = ['owner', 'backup', 'guardian'];

export interface OutputReference {
  /** Transaction id, 32 bytes as lowercase hex. */
  readonly txId: string;
  readonly index: number;
}

/** The terms of a dated backup path (GV-69), as the scripts state them. */
export interface BackupTerms {
  readonly threshold: number;
  /** Absolute slot from which the backup quorum may spend. */
  readonly afterSlot: number;
}

export interface NativeVaultRecord {
  readonly kind: 'native';
  /** The accepted scripts, as `scripts.ts` or `decodeRegistration` gives them. */
  readonly payment: VaultScript;
  readonly stake: VaultScript;
  readonly backup?: BackupTerms;
}

export interface PlutusVaultRecord {
  readonly kind: 'plutus';
  readonly seed: OutputReference;
  readonly templateVersion: number;
  /** The applied validator, hex: the script bytes its Plutus V3 hash `h` covers. */
  readonly validator: string;
}

/** What an external wallet supplied, as `parseExternalCosignerKeys` takes it. */
export type ExternalCosignerInput =
  | { readonly account: string }
  | { readonly payment: string; readonly stake: string };

export interface PackageParticipant {
  readonly role: PackageRole;
  /** Raw Ed25519 vault keys, lowercase hex. */
  readonly payment: Ed25519PublicKeyHex;
  readonly stake?: Ed25519PublicKeyHex;
  readonly external?: ExternalCosignerInput;
  /** A display name: a claim from the package, never verified. */
  readonly label?: string;
}

export interface PackageSelf {
  /** The exporter's position in `participants`. */
  readonly position: number;
  /** The exporter's own vault index, never shared with cosigners (spec 4.0). */
  readonly index: number;
}

export interface ManifestRevision {
  readonly version: number;
  /** The manifest's canonical CBOR, lowercase hex. */
  readonly cbor: string;
}

export interface ProposalRecord {
  /** Proposal id, hex. */
  readonly id: string;
  /** The proposal as its own codec encodes it, hex. */
  readonly cbor: string;
}

export interface AddressBookEntry {
  /** A Shelley payment address on the package's network, bech32. */
  readonly address: string;
  readonly label: string;
}

/** What `exportRecoveryPackage` writes. */
export interface RecoveryPackageContents {
  readonly network: VaultNetwork;
  readonly exportedAtMs: number;
  readonly vault: NativeVaultRecord | PlutusVaultRecord;
  readonly self: PackageSelf;
  readonly participants: readonly PackageParticipant[];
  /** Every revision, oldest first. */
  readonly manifests: readonly ManifestRevision[];
  /** Oldest first: the start of the list is what is left out when the history does not fit. */
  readonly proposals: readonly ProposalRecord[];
  /** Oldest entry first (entries carry no usage time): the start is what is left out first. */
  readonly addressBook: readonly AddressBookEntry[];
  readonly referenceScripts: readonly OutputReference[];
  /** Proposals already left out of `proposals`, counted from the oldest; 0 when absent. */
  readonly proposalsDropped?: number;
  /** Address book entries already left out of `addressBook`, counted from the oldest; 0 when absent. */
  readonly addressBookDropped?: number;
  /** The vault's external endorsements, in the manifest code's stored form. */
  readonly endorsements?: readonly ExternalEndorsement[];
  /** The external cosigners' expired-transaction attestations the endorsements cover, stored form. */
  readonly externalAttestations?: readonly OwnerAttestation[];
}

/** A decoded payload. Its vault facts are claims until a restore checks them. */
export interface RecoveryPackage extends RecoveryPackageContents {
  readonly version: number;
  /** Each revision with its manifest hash: the manifest code's tagged blake2b-256 of its canonical CBOR. */
  readonly manifests: readonly (ManifestRevision & { readonly hash: string })[];
  /**
   * The counts below are claims from the package's writer, as the history itself is: a writer that
   * left entries out without counting them is possible, so a screen never says "complete history"
   * from a zero, only "N entries were left out" from a count above zero.
   */
  readonly proposalsDropped: number;
  /** The writer says some proposals were left out. */
  readonly proposalHistoryTruncated: boolean;
  readonly addressBookDropped: number;
  /** The writer says some address book entries were left out. */
  readonly addressBookTruncated: boolean;
  readonly endorsements: readonly ExternalEndorsement[];
  readonly externalAttestations: readonly OwnerAttestation[];
}

export type RecoveryPayloadRefusalCode = 'UNKNOWN_PAYLOAD_VERSION' | 'PAYLOAD_INVALID';

export type DecodeRecoveryPayloadResult =
  | { readonly ok: true; readonly package: RecoveryPackage }
  | { readonly ok: false; readonly code: RecoveryPayloadRefusalCode; readonly detail?: string };

const LOWER_HEX = (bytes: number) => new RegExp(`^[0-9a-f]{${bytes * 2}}$`);
const KEY_HEX = LOWER_HEX(32);
const TX_ID_HEX = LOWER_HEX(32);
const ANY_LOWER_HEX = /^(?:[0-9a-f]{2})+$/;

const MAGIC_TO_NETWORK = new Map<number, VaultNetwork>(
  (Object.keys(NETWORK_MAGIC) as VaultNetwork[]).map(n => [NETWORK_MAGIC[n], n]),
);
const NETWORK_ID: Readonly<Record<VaultNetwork, Cardano.NetworkId>> = {
  mainnet: Cardano.NetworkId.Mainnet,
  preprod: Cardano.NetworkId.Testnet,
  preview: Cardano.NetworkId.Testnet,
};
const PAYMENT_ADDRESS_TYPES: ReadonlySet<Cardano.AddressType> = new Set([
  Cardano.AddressType.BasePaymentKeyStakeKey,
  Cardano.AddressType.BasePaymentScriptStakeKey,
  Cardano.AddressType.BasePaymentKeyStakeScript,
  Cardano.AddressType.BasePaymentScriptStakeScript,
  Cardano.AddressType.PointerKey,
  Cardano.AddressType.PointerScript,
  Cardano.AddressType.EnterpriseKey,
  Cardano.AddressType.EnterpriseScript,
]);

/** A map with unsigned keys; `undefined` values are left out. */
function intMap(entries: Readonly<Record<number, CborWritable | undefined>>): CborWritable {
  return new Map(Object.keys(entries).map(Number).filter(k => entries[k] !== undefined).map(k => [k, entries[k] as CborWritable]));
}

const sizeOf = (value: CborWritable): number => encodeCanonicalCbor(value).length;

/** Whether two byte strings are equal; a plain loop, as this runs over whole payloads. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The manifest code's hash of a manifest revision's bytes; `undefined` for anything but lowercase hex. */
export function manifestRevisionHashOf(cborHex: unknown): string | undefined {
  if (typeof cborHex !== 'string' || !ANY_LOWER_HEX.test(cborHex)) return undefined;
  return taggedHash(MANIFEST_HASH_TAG, hexToBytes(cborHex) as Uint8Array);
}

// ---------------------------------------------------------------------------------------------
// Validation shared by the encoder and the decoder

function invalid(message: string): never {
  throw new GeroVaultError('INVALID_PACKAGE', message);
}

const isUint = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;

const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null;

function hexBytes(hex: unknown, pattern: RegExp, what: string): Uint8Array {
  if (typeof hex !== 'string' || !pattern.test(hex)) invalid(`${what} is lowercase hex of the right length`);
  return hexToBytes(hex) as Uint8Array;
}

function boundedHex(hex: unknown, max: number, what: string): Uint8Array {
  if (typeof hex !== 'string' || !ANY_LOWER_HEX.test(hex) || hex.length > max * 2) invalid(`${what} is 1 to ${max} bytes of lowercase hex`);
  return hexToBytes(hex) as Uint8Array;
}

/** The read rule of `labels.ts`, and not empty: an absent label is written as no key at all. */
function storedLabel(value: unknown, what: string): string {
  const text = readLabel(value);
  if (text === undefined || text.length === 0) invalid(`${what} is 1 to 64 bytes of well-formed text without control characters`);
  return text as string;
}

/** Decodes the two scripts exactly as a registration's are decoded: canonical, hashed over their bytes. */
function nativeScripts(payment: Uint8Array, stake: Uint8Array): { payment: VaultScript; stake: VaultScript } {
  if (payment.length > MAX_SCRIPT_BYTES || stake.length > MAX_SCRIPT_BYTES) invalid('A vault script is too large');
  const decoded = decodeRegistration({
    metadata: { json: { types: [ROLE.PAYMENT, ROLE.STAKE] } },
    nativeScripts: { cbors: [bytesToHex(payment), bytesToHex(stake)] },
  });
  if (decoded.ok !== true) invalid(`A vault script is refused: ${decoded.code}`);
  const { payment: p, stake: s } = (decoded as Extract<typeof decoded, { ok: true }>).registration;
  if (!s) invalid('The stake script is missing');
  return { payment: p, stake: s as VaultScript };
}

function outputReference(ref: OutputReference | undefined, what: string): CborWritable {
  if (!isObject(ref)) invalid(`${what} is an output reference`);
  const txId = hexBytes(ref?.txId, TX_ID_HEX, `${what} transaction id`);
  if (!isUint(ref?.index, MAX_OUTPUT_INDEX)) invalid(`${what} output index is 0 to ${MAX_OUTPUT_INDEX}`);
  return [txId, ref.index];
}

function xpubBytes(value: unknown, prefix: string, what: string): Uint8Array {
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(value as string, BECH32_LIMIT);
  } catch {
    return invalid(`${what} reads ${prefix}1...`);
  }
  const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
  if (decoded.prefix !== prefix || bytes.length !== XPUB_BYTES) invalid(`${what} reads ${prefix}1...`);
  return bytes;
}

function externalKey(external: unknown): CborWritable {
  if (!isObject(external)) invalid('An external key is an account key or two role keys');
  const roles = external as { readonly account?: unknown; readonly payment?: unknown; readonly stake?: unknown };
  if ('account' in roles) return [0, xpubBytes(roles.account, BECH32_PREFIX.ACCOUNT_XVK, 'An external account key')];
  const payment = xpubBytes(roles.payment, BECH32_PREFIX.PAYMENT_XVK, 'An external payment role key');
  const stake = xpubBytes(roles.stake, BECH32_PREFIX.STAKE_XVK, 'An external stake role key');
  return [1, payment, stake];
}

function vaultWritable(vault: RecoveryPackageContents['vault']): CborWritable {
  if (!isObject(vault)) invalid('A vault is native or plutus');
  if (vault.kind === 'native') {
    const paymentCbor = boundedHex(vault.payment?.cbor, MAX_SCRIPT_BYTES, 'The payment script');
    const stakeCbor = boundedHex(vault.stake?.cbor, MAX_SCRIPT_BYTES, 'The stake script');
    const decoded = nativeScripts(paymentCbor, stakeCbor);
    if (decoded.payment.hash !== vault.payment.hash || decoded.stake.hash !== vault.stake.hash) {
      invalid('A vault script does not hash to its recorded hash');
    }
    let backup: CborWritable | undefined;
    if (vault.backup !== undefined) {
      const { threshold, afterSlot } = isObject(vault.backup) ? vault.backup : ({} as Partial<BackupTerms>);
      if (!isUint(threshold) || threshold < 1 || !isUint(afterSlot) || afterSlot < 1) {
        invalid('The backup terms are a threshold and a slot');
      }
      backup = intMap({ 0: threshold, 1: afterSlot });
    }
    return intMap({ 0: 0, 1: paymentCbor, 2: stakeCbor, 3: backup });
  }
  if (vault.kind === 'plutus') {
    if (!isUint(vault.templateVersion, MAX_TEMPLATE_VERSION)) invalid('The template version is a 32-bit unsigned integer');
    const validator = boundedHex(vault.validator, MAX_VALIDATOR_BYTES, 'The validator');
    return intMap({ 0: 1, 1: outputReference(vault.seed, 'The seed'), 2: vault.templateVersion, 3: validator });
  }
  return invalid('A vault is native or plutus');
}

function participantsWritable(contents: RecoveryPackageContents): CborWritable {
  const list: readonly PackageParticipant[] = Array.isArray(contents.participants) ? contents.participants : invalid('Participants are a list');
  if (list.length === 0 || list.length > MAX_PACKAGE_PARTICIPANTS) invalid(`A package has 1 to ${MAX_PACKAGE_PARTICIPANTS} participants`);
  const native = contents.vault.kind === 'native';
  const keys = new Set<string>();
  const distinct = (hex: string) => {
    if (keys.has(hex)) invalid('The same vault key appears twice');
    keys.add(hex);
  };
  return list.map(p => {
    if (!isObject(p)) invalid('A participant is a record');
    const code = ROLE_CODES.indexOf(p.role);
    if (code < 0) invalid('A role is owner, backup or guardian');
    if (native && p.role === 'guardian') invalid('A native vault has no guardians');
    if (!native && p.role === 'backup') invalid('A Plutus vault has no backup holders');
    if (p.role === 'guardian' && p.external !== undefined) invalid('A guardian signs with a Gero wallet');
    const payment = hexBytes(p.payment, KEY_HEX, 'A payment vault key');
    distinct(p.payment);
    let stake: Uint8Array | undefined;
    if (native) {
      stake = hexBytes(p.stake, KEY_HEX, 'A stake vault key');
      distinct(p.stake as string);
    } else if (p.stake !== undefined) {
      invalid('A Plutus vault participant has no stake vault key');
    }
    const external = p.external === undefined ? undefined : externalKey(p.external);
    const text = p.label === undefined ? undefined : storedLabel(p.label, 'A participant label');
    return intMap({ 0: code, 1: payment, 2: stake, 3: external, 4: text });
  });
}

function selfWritable(contents: RecoveryPackageContents): CborWritable {
  const { position, index } = isObject(contents.self) ? contents.self : ({} as Partial<PackageSelf>);
  if (!isUint(position, contents.participants.length - 1)) invalid('The exporter is one of the participants');
  if (!isUint(index, MAX_VAULT_INDEX)) invalid(`A vault index is 0 to ${MAX_VAULT_INDEX}`);
  if (contents.participants[position].external !== undefined) invalid('The exporter is not an external wallet');
  return intMap({ 0: position, 1: index });
}

function list<T>(value: readonly T[] | undefined, max: number, what: string): readonly T[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${what} is a list of at most ${max}`);
  return value as readonly T[];
}

function manifestsWritable(manifests: readonly ManifestRevision[]): CborWritable {
  let previous = -1;
  return list(manifests, MAX_MANIFEST_REVISIONS, 'The manifest history').map(m => {
    if (!isObject(m) || !isUint(m.version) || m.version <= previous) invalid('Manifest versions are unsigned and strictly ascending');
    previous = m.version;
    return [m.version, boundedHex(m.cbor, MAX_MANIFEST_BYTES, 'A manifest')];
  });
}

function proposalWritable(p: ProposalRecord): CborWritable {
  if (!isObject(p)) invalid('A proposal is a record');
  return [boundedHex(p.id, MAX_PROPOSAL_ID_BYTES, 'A proposal id'), boundedHex(p.cbor, MAX_PROPOSAL_BYTES, 'A proposal')];
}

function proposalsWritable(proposals: readonly ProposalRecord[]): CborWritable {
  const ids = new Set<string>();
  return list(proposals, MAX_PROPOSALS, 'The proposal history').map(p => {
    const item = proposalWritable(p);
    if (ids.has(p.id)) invalid('The same proposal appears twice');
    ids.add(p.id);
    return item;
  });
}

function addressBytes(address: unknown, network: VaultNetwork): Uint8Array {
  let parsed: Cardano.Address | undefined;
  try {
    parsed = typeof address === 'string' ? Cardano.Address.fromBech32(address) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!parsed || !PAYMENT_ADDRESS_TYPES.has(parsed.getType()) || parsed.getNetworkId() !== NETWORK_ID[network]) {
    invalid('An address book entry is a Shelley payment address on the vault network');
  }
  return hexToBytes(parsed.toBytes()) as Uint8Array;
}

function addressBookEntryWritable(e: AddressBookEntry, network: VaultNetwork): { item: CborWritable; address: string } {
  if (!isObject(e)) invalid('An address book entry is a record');
  const address = addressBytes(e.address, network);
  return { item: [address, storedLabel(e.label, 'An address book label')], address: bytesToHex(address) };
}

function addressBookWritable(entries: readonly AddressBookEntry[], network: VaultNetwork): CborWritable {
  const seen = new Set<string>();
  return list(entries, MAX_ADDRESS_BOOK_ENTRIES, 'The address book').map(e => {
    const { item, address } = addressBookEntryWritable(e, network);
    if (seen.has(address)) invalid('The same address appears twice in the address book');
    seen.add(address);
    return item;
  });
}

function referenceScriptsWritable(refs: readonly OutputReference[]): CborWritable {
  const seen = new Set<string>();
  return list(refs, MAX_REFERENCE_SCRIPTS, 'The reference scripts').map(r => {
    const item = outputReference(r, 'A reference script');
    const key = `${r.txId}#${r.index}`;
    if (seen.has(key)) invalid('The same reference script UTxO appears twice');
    seen.add(key);
    return item;
  });
}

/** An attestation as a manifest stores one: `{ method, proof }`, in the stored form only. */
function attestationWritable(a: OwnerAttestation, what: string): CborWritable {
  if (!isObject(a) || !isUint(a.method) || !isCanonicalAttestation(a)) invalid(`${what} is an attestation in the stored form`);
  return { method: a.method, proof: hexToBytes(a.proof) as Uint8Array };
}

function endorsementWritable(e: ExternalEndorsement): CborWritable {
  if (!isObject(e)) invalid('An endorsement is a record');
  // The manifest code's own body check: a digest, two credentials and an attestation hash.
  if (attempt(() => externalEndorsementDigest(e)) === undefined) invalid('An endorsement names a verification digest, two credentials and an attestation hash');
  return {
    verificationDigest: hexToBytes(e.verificationDigest) as Uint8Array,
    externalCredential: hexToBytes(e.externalCredential) as Uint8Array,
    externalAttestationHash: hexToBytes(e.externalAttestationHash) as Uint8Array,
    endorserCredential: hexToBytes(e.endorserCredential) as Uint8Array,
    attestation: attestationWritable(e.attestation, 'An endorsement attestation'),
  };
}

function externalAttestationWritable(a: OwnerAttestation): CborWritable {
  if (!isObject(a) || a.method !== ATTESTATION_METHOD.EXPIRED_TX) invalid('An external attestation is an expired-transaction proof');
  return attestationWritable(a, 'An external attestation');
}

/** A list of distinct items, each written. */
function distinctList<T>(items: readonly T[] | undefined, max: number, what: string, write: (x: T) => CborWritable): CborWritable {
  const seen = new Set<string>();
  return list(items ?? [], max, what).map(x => {
    const item = write(x);
    const key = bytesToHex(encodeCanonicalCbor(item));
    if (seen.has(key)) invalid(`The same entry appears twice in ${what.toLowerCase()}`);
    seen.add(key);
    return item;
  });
}

/** The payload's bytes with no bound on their total size. */
function encodeContents(contents: RecoveryPackageContents): Uint8Array {
  if (!isObject(contents)) invalid('No contents');
  const magic = Object.prototype.hasOwnProperty.call(NETWORK_MAGIC, contents.network) ? NETWORK_MAGIC[contents.network] : undefined;
  if (magic === undefined) invalid('A vault network is mainnet, preprod or preview');
  if (!isUint(contents.exportedAtMs)) invalid('The export time is Unix milliseconds');
  const counts = [contents.proposalsDropped, contents.addressBookDropped].map(n => n ?? 0);
  if (!counts.every(n => isUint(n))) invalid('A count of entries left out is an unsigned integer');
  const vault = vaultWritable(contents.vault);
  const participants = participantsWritable(contents);
  return encodeCanonicalCbor(intMap({
    0: RECOVERY_PAYLOAD_VERSION,
    1: magic,
    2: contents.exportedAtMs,
    3: vault,
    4: selfWritable(contents),
    5: participants,
    6: manifestsWritable(contents.manifests),
    7: proposalsWritable(contents.proposals),
    8: addressBookWritable(contents.addressBook, contents.network),
    9: referenceScriptsWritable(contents.referenceScripts),
    10: counts[0],
    11: counts[1],
    12: distinctList(contents.endorsements, MAX_ENDORSEMENTS, 'The endorsements', endorsementWritable),
    13: distinctList(contents.externalAttestations, MAX_EXTERNAL_ATTESTATIONS, 'The external attestations', externalAttestationWritable),
  }));
}

/**
 * Encodes a payload. Throws `GeroVaultError('INVALID_PACKAGE')` naming the first rule the
 * contents break, a payload over the file bound included (`fitRecoveryHistory` makes the history
 * fit first).
 */
export function encodeRecoveryPayload(contents: RecoveryPackageContents): Uint8Array {
  const out = encodeContents(contents);
  if (out.length > MAX_RECOVERY_PAYLOAD_BYTES) invalid(`The payload is ${out.length} bytes, over the bound of ${MAX_RECOVERY_PAYLOAD_BYTES}`);
  return out;
}

/** What an export could not carry and left out, beyond what it left out to fit. */
export interface RecoverySkipped {
  /** Malformed or oversized proposals, and earlier copies of a repeated id. */
  readonly proposals: number;
  /** Entries with an address off the network or a label the read rule refuses, and earlier copies of an address. */
  readonly addressBook: number;
  /** Participant labels the read rule refuses: the participant stays, without the label. */
  readonly participantLabels: number;
}

export interface FittedRecoveryHistory {
  readonly contents: RecoveryPackageContents;
  readonly skipped: RecoverySkipped;
}

function attempt<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch (e) {
    if (e instanceof GeroVaultError) return undefined;
    throw e;
  }
}

/** The entries `encode` accepts, the last copy of each key kept in place. */
function newestValid<T>(items: readonly T[], keyOf: (x: T) => string | undefined): T[] {
  const last = new Map<string, number>();
  items.forEach((x, i) => {
    const key = keyOf(x);
    if (key !== undefined) last.set(key, i);
  });
  return items.filter((x, i) => {
    const key = keyOf(x);
    return key !== undefined && last.get(key) === i;
  });
}

/**
 * Prepares contents for an export so that no single proposal or address book entry, and no size of
 * either, ever makes it fail:
 * - the manifest history is kept whole, in version order; an exact copy of a revision is merged, but
 *   a revision that cannot be carried (malformed, oversized, or another revision with the same
 *   version) is corruption of the wallet's own accepted history and throws
 *   `GeroVaultError('MANIFEST_HISTORY_CORRUPT')`: a gap would break the chain of revisions;
 * - proposals and address book entries that cannot be carried are left out and counted in
 *   `skipped`: one that is malformed, oversized or (an address) off the vault's network, or whose
 *   label the read rule refuses, and every earlier copy of a repeated proposal id or address (the
 *   newest is kept); a participant label the read rule refuses is left off its participant;
 *   labels are copied as they are, never rewritten, so one authored with newer Unicode data than
 *   this client's is carried;
 * - then the history is fitted: at most `MAX_MANIFEST_REVISIONS` revisions within the 16 MiB file
 *   (more throws `HISTORY_TOO_LARGE`); at most `MAX_ADDRESS_BOOK_ENTRIES` address book entries and
 *   `MAX_PROPOSALS` proposals; the room left after everything else goes to the address book first
 *   (it is small and serves every spend), then to the proposals; in each the newest are kept;
 * - `addressBookDropped` and `proposalsDropped` count everything left out, earlier exports included.
 * Endorsements and external attestations are not left out here, only merged when repeated: their
 * signatures are the manifest code's to check, and `exportRecoveryPackage` keeps only those that
 * verify against the latest accepted manifest.
 * Throws `GeroVaultError('HISTORY_TOO_LARGE')`, with the sizes, when the package does not fit even
 * without any proposal or address book entry, and `INVALID_PACKAGE` for contents that break any
 * rule outside the history.
 */
export function fitRecoveryHistory(contents: RecoveryPackageContents): FittedRecoveryHistory {
  if (!isObject(contents)) invalid('No contents');
  const network = contents.network;
  if (!Object.prototype.hasOwnProperty.call(NETWORK_MAGIC, network)) invalid('A vault network is mainnet, preprod or preview');
  const counts = [contents.proposalsDropped, contents.addressBookDropped].map(n => n ?? 0);
  if (!counts.every(n => isUint(n))) invalid('A count of entries left out is an unsigned integer');
  const [earlierProposals, earlierBook] = counts;

  const rawManifests = list(contents.manifests, Number.MAX_SAFE_INTEGER, 'The manifest history');
  const byVersion = new Map<number, ManifestRevision>();
  rawManifests.forEach((m, i) => {
    if (attempt(() => manifestsWritable([m])) === undefined) {
      throw new GeroVaultError('MANIFEST_HISTORY_CORRUPT', `Manifest revision ${i} cannot be carried: it is malformed or over ${MAX_MANIFEST_BYTES} bytes`);
    }
    const seen = byVersion.get(m.version);
    if (seen && seen.cbor !== m.cbor) {
      throw new GeroVaultError('MANIFEST_HISTORY_CORRUPT', `Two different manifest revisions have version ${m.version}`);
    }
    byVersion.set(m.version, { version: m.version, cbor: m.cbor });
  });
  const manifests = [...byVersion.values()].sort((a, b) => a.version - b.version);
  if (manifests.length > MAX_MANIFEST_REVISIONS) {
    throw new GeroVaultError('HISTORY_TOO_LARGE', `The manifest history has ${manifests.length} revisions; a package holds at most ${MAX_MANIFEST_REVISIONS}`);
  }
  const rawProposals = list(contents.proposals, Number.MAX_SAFE_INTEGER, 'The proposal history');
  const proposals = newestValid(rawProposals, p => (attempt(() => proposalWritable(p)) ? p.id : undefined));
  const rawBook = list(contents.addressBook, Number.MAX_SAFE_INTEGER, 'The address book');
  // The encoder applies the read rule to every label, so an entry it accepts is carried as it is.
  const book = newestValid(rawBook, e => attempt(() => addressBookEntryWritable(e, network))?.address);
  let participantLabels = 0;
  const participants = Array.isArray(contents.participants)
    ? contents.participants.map(p => {
      if (!isObject(p) || p.label === undefined) return p;
      if (attempt(() => storedLabel(p.label, 'A participant label')) !== undefined) return p;
      participantLabels++;
      const { label: _dropped, ...rest } = p;
      return rest;
    })
    : contents.participants;
  const unique = <T>(items: readonly T[] | undefined, write: (x: T) => CborWritable): T[] => {
    const seen = new Set<string>();
    return (Array.isArray(items) ? items : []).filter(x => {
      const key = bytesToHex(encodeCanonicalCbor(write(x)));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const endorsements = unique(contents.endorsements, endorsementWritable);
  const externalAttestations = unique(contents.externalAttestations, externalAttestationWritable);
  const skipped: RecoverySkipped = Object.freeze({
    proposals: rawProposals.length - proposals.length,
    addressBook: rawBook.length - book.length,
    participantLabels,
  });

  const clean: RecoveryPackageContents = {
    ...contents,
    participants,
    manifests,
    endorsements,
    externalAttestations,
  };
  const base = encodeContents({
    ...clean,
    proposals: [],
    addressBook: [],
    proposalsDropped: earlierProposals + rawProposals.length,
    addressBookDropped: earlierBook + rawBook.length,
  });
  if (base.length > MAX_RECOVERY_PAYLOAD_BYTES) {
    const sum = (sizes: readonly number[]) => sizes.reduce((n, s) => n + s, 0);
    throw new GeroVaultError(
      'HISTORY_TOO_LARGE',
      `The package is ${base.length} bytes, over ${MAX_RECOVERY_PAYLOAD_BYTES}, without any proposal or address book entry: `
        + `its ${manifests.length} manifest revisions are ${sum(manifests.map(m => m.cbor.length / 2))} bytes, `
        + `its ${endorsements.length} endorsements and ${externalAttestations.length} external attestations `
        + `${sum([...endorsements.map(e => sizeOf(endorsementWritable(e))), ...externalAttestations.map(a => sizeOf(externalAttestationWritable(a)))])} bytes`,
    );
  }
  // Room for both lists: their heads and their counts grow by at most 8 bytes each.
  let room = MAX_RECOVERY_PAYLOAD_BYTES - base.length - 32;
  const newest = <X>(items: readonly X[], max: number, size: (x: X) => number): number => {
    let kept = 0;
    for (let i = items.length - 1; i >= 0 && kept < max; i--) {
      const n = size(items[i]);
      if (n > room) break;
      room -= n;
      kept++;
    }
    return kept;
  };
  const keptBook = newest(book, MAX_ADDRESS_BOOK_ENTRIES, e => sizeOf(addressBookEntryWritable(e, network).item));
  const keptProposals = newest(proposals, MAX_PROPOSALS, p => sizeOf(proposalWritable(p)));
  return Object.freeze({
    contents: {
      ...clean,
      proposals: proposals.slice(proposals.length - keptProposals),
      addressBook: book.slice(book.length - keptBook),
      proposalsDropped: earlierProposals + rawProposals.length - keptProposals,
      addressBookDropped: earlierBook + rawBook.length - keptBook,
    },
    skipped,
  });
}

// ---------------------------------------------------------------------------------------------
// Strict decoder for untrusted bytes

class PayloadRefusal extends Error {
  constructor(readonly code: RecoveryPayloadRefusalCode, readonly detail?: string) {
    super(code);
  }
}

function bad(detail: string): never {
  throw new PayloadRefusal('PAYLOAD_INVALID', detail);
}

function fields(item: CborItem, what: string, required: readonly number[], optional: readonly number[] = []): Map<number, CborItem> {
  if (item.value.type !== 'map') bad(`${what} is not a map`);
  const out = new Map<number, CborItem>();
  for (const [key, value] of (item.value as { value: readonly (readonly [CborItem, CborItem])[] }).value) {
    const k = key.value.type === 'int' && key.value.value >= 0n && key.value.value < 64n ? Number(key.value.value) : -1;
    if (!required.includes(k) && !optional.includes(k)) bad(`${what} has an unknown key`);
    out.set(k, value);
  }
  for (const k of required) if (!out.has(k)) bad(`${what} lacks key ${k}`);
  return out;
}

/** A map with exactly these text keys. */
function textFields(item: CborItem | undefined, what: string, keys: readonly string[]): Map<string, CborItem> {
  if (item?.value.type !== 'map') bad(`${what} is not a map`);
  const out = new Map<string, CborItem>();
  for (const [key, value] of (item?.value as { value: readonly (readonly [CborItem, CborItem])[] }).value) {
    if (key.value.type !== 'text' || !keys.includes(key.value.value)) bad(`${what} has an unknown key`);
    out.set((key.value as { value: string }).value, value);
  }
  for (const k of keys) if (!out.has(k)) bad(`${what} lacks ${k}`);
  return out;
}

function uintOf(item: CborItem | undefined, what: string, max = Number.MAX_SAFE_INTEGER): number {
  const v = item?.value;
  if (v?.type !== 'int' || v.value < 0n || v.value > BigInt(max)) bad(`${what} is not an unsigned integer in range`);
  return Number((v as { value: bigint }).value);
}

function bytesOf(item: CborItem | undefined, what: string, min: number, max: number): Uint8Array {
  const v = item?.value;
  if (v?.type !== 'bytes' || v.value.length < min || v.value.length > max) bad(`${what} is not ${min} to ${max} bytes`);
  return (v as { value: Uint8Array }).value;
}

function textOf(item: CborItem | undefined, what: string): string {
  const v = item?.value;
  if (v?.type !== 'text') bad(`${what} is not text`);
  return (v as { value: string }).value;
}

function arrayOf(item: CborItem | undefined, what: string, max: number): readonly CborItem[] {
  const v = item?.value;
  if (v?.type !== 'array' || v.value.length > max) bad(`${what} is not a list of at most ${max}`);
  return (v as { value: readonly CborItem[] }).value;
}

function tuple(item: CborItem | undefined, what: string, length: number): readonly CborItem[] {
  const items = arrayOf(item, what, length);
  if (items.length !== length) bad(`${what} has ${length} items`);
  return items;
}

const hexOf = bytesToHex;

function decodeOutputReference(item: CborItem | undefined, what: string): OutputReference {
  const [txId, index] = tuple(item, what, 2);
  return Object.freeze({ txId: hexOf(bytesOf(txId, `${what} transaction id`, 32, 32)), index: uintOf(index, `${what} index`, MAX_OUTPUT_INDEX) });
}

function decodeVault(item: CborItem): NativeVaultRecord | PlutusVaultRecord {
  if (item.value.type !== 'map') bad('vault is not a map');
  const kind = item.value.value.find(([k]) => k.value.type === 'int' && k.value.value === 0n)?.[1];
  const code = uintOf(kind, 'vault kind', 1);
  if (code === 0) {
    const f = fields(item, 'native vault', [0, 1, 2], [3]);
    const scripts = nativeScripts(bytesOf(f.get(1), 'payment script', 1, MAX_SCRIPT_BYTES), bytesOf(f.get(2), 'stake script', 1, MAX_SCRIPT_BYTES));
    const out: { -readonly [K in keyof NativeVaultRecord]: NativeVaultRecord[K] } = { kind: 'native', ...scripts };
    if (f.has(3)) {
      const b = fields(f.get(3) as CborItem, 'backup terms', [0, 1]);
      out.backup = Object.freeze({ threshold: uintOf(b.get(0), 'backup threshold'), afterSlot: uintOf(b.get(1), 'backup slot') });
    }
    return Object.freeze(out);
  }
  const f = fields(item, 'plutus vault', [0, 1, 2, 3]);
  return Object.freeze({
    kind: 'plutus',
    seed: decodeOutputReference(f.get(1), 'seed'),
    templateVersion: uintOf(f.get(2), 'template version', MAX_TEMPLATE_VERSION),
    validator: hexOf(bytesOf(f.get(3), 'validator', 1, MAX_VALIDATOR_BYTES)),
  });
}

const toBech32 = (prefix: string, bytes: Uint8Array) => bech32.encode(prefix, bech32.toWords(bytes), BECH32_LIMIT);

function decodeExternal(item: CborItem): ExternalCosignerInput {
  const items = arrayOf(item, 'external key', 3);
  const kind = uintOf(items[0], 'external key kind', 1);
  if (kind === 0) {
    const [, account] = tuple(item, 'external account key', 2);
    return Object.freeze({ account: toBech32(BECH32_PREFIX.ACCOUNT_XVK, bytesOf(account, 'account key', XPUB_BYTES, XPUB_BYTES)) });
  }
  const [, payment, stake] = tuple(item, 'external role keys', 3);
  return Object.freeze({
    payment: toBech32(BECH32_PREFIX.PAYMENT_XVK, bytesOf(payment, 'payment role key', XPUB_BYTES, XPUB_BYTES)),
    stake: toBech32(BECH32_PREFIX.STAKE_XVK, bytesOf(stake, 'stake role key', XPUB_BYTES, XPUB_BYTES)),
  });
}

function decodeParticipant(item: CborItem): PackageParticipant {
  const f = fields(item, 'participant', [0, 1], [2, 3, 4]);
  const out: { -readonly [K in keyof PackageParticipant]: PackageParticipant[K] } = {
    role: ROLE_CODES[uintOf(f.get(0), 'role', ROLE_CODES.length - 1)],
    payment: Ed25519PublicKeyHex(hexOf(bytesOf(f.get(1), 'payment vault key', 32, 32))),
  };
  if (f.has(2)) out.stake = Ed25519PublicKeyHex(hexOf(bytesOf(f.get(2), 'stake vault key', 32, 32)));
  if (f.has(3)) out.external = decodeExternal(f.get(3) as CborItem);
  if (f.has(4)) out.label = textOf(f.get(4), 'participant label');
  return Object.freeze(out);
}

function decodeAddress(item: CborItem | undefined): string {
  const bytes = bytesOf(item, 'address', 1, 64);
  try {
    return Cardano.Address.fromBytes(HexBlob(hexOf(bytes))).toBech32();
  } catch {
    return bad('address is not a Cardano address');
  }
}

function decodeAttestation(item: CborItem | undefined, what: string): OwnerAttestation {
  const f = textFields(item, what, ['method', 'proof']);
  return Object.freeze({ method: uintOf(f.get('method'), `${what} method`), proof: hexOf(bytesOf(f.get('proof'), `${what} proof`, 1, MAX_ATTESTATION_BYTES)) });
}

function decodeEndorsement(item: CborItem): ExternalEndorsement {
  const f = textFields(item, 'endorsement', ['verificationDigest', 'externalCredential', 'externalAttestationHash', 'endorserCredential', 'attestation']);
  return Object.freeze({
    verificationDigest: hexOf(bytesOf(f.get('verificationDigest'), 'verification digest', 32, 32)),
    externalCredential: Ed25519KeyHashHex(hexOf(bytesOf(f.get('externalCredential'), 'external credential', 28, 28))),
    externalAttestationHash: hexOf(bytesOf(f.get('externalAttestationHash'), 'attestation hash', 32, 32)),
    endorserCredential: Ed25519KeyHashHex(hexOf(bytesOf(f.get('endorserCredential'), 'endorser credential', 28, 28))),
    attestation: decodeAttestation(f.get('attestation'), 'endorsement attestation'),
  });
}

function decode(bytes: Uint8Array): RecoveryPackage {
  let root: CborItem;
  try {
    root = readCbor(bytes, PAYLOAD_LIMITS);
  } catch (e) {
    if (e instanceof CborError) bad(`CBOR ${e.reason}`);
    throw e;
  }
  if (root.value.type !== 'map') bad('payload is not a map');
  // The version first, so a later version is reported as such whatever else it changed.
  const versionItem = root.value.value.find(([k]) => k.value.type === 'int' && k.value.value === 0n)?.[1];
  const version = versionItem?.value.type === 'int' ? versionItem.value.value : undefined;
  if (version !== BigInt(RECOVERY_PAYLOAD_VERSION)) {
    throw new PayloadRefusal(version === undefined ? 'PAYLOAD_INVALID' : 'UNKNOWN_PAYLOAD_VERSION', String(version ?? 'missing'));
  }
  const f = fields(root, 'payload', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  const network = MAGIC_TO_NETWORK.get(uintOf(f.get(1), 'network magic', 0xffffffff)) ?? bad('unknown network');
  const self = fields(f.get(4) as CborItem, 'self', [0, 1]);
  const manifestItems = arrayOf(f.get(6), 'manifests', MAX_MANIFEST_REVISIONS).map(m => {
    const [v, b] = tuple(m, 'manifest revision', 2);
    return { version: uintOf(v, 'manifest version'), bytes: bytesOf(b, 'manifest', 1, MAX_MANIFEST_BYTES) };
  });
  const contents: RecoveryPackageContents = {
    network,
    exportedAtMs: uintOf(f.get(2), 'export time'),
    vault: decodeVault(f.get(3) as CborItem),
    self: Object.freeze({ position: uintOf(self.get(0), 'self position'), index: uintOf(self.get(1), 'self index', MAX_VAULT_INDEX) }),
    participants: Object.freeze(arrayOf(f.get(5), 'participants', MAX_PACKAGE_PARTICIPANTS).map(decodeParticipant)),
    manifests: Object.freeze(manifestItems.map(m => Object.freeze({ version: m.version, cbor: hexOf(m.bytes) }))),
    proposals: Object.freeze(arrayOf(f.get(7), 'proposals', MAX_PROPOSALS).map(p => {
      const [id, b] = tuple(p, 'proposal', 2);
      return Object.freeze({ id: hexOf(bytesOf(id, 'proposal id', 1, MAX_PROPOSAL_ID_BYTES)), cbor: hexOf(bytesOf(b, 'proposal', 1, MAX_PROPOSAL_BYTES)) });
    })),
    addressBook: Object.freeze(arrayOf(f.get(8), 'address book', MAX_ADDRESS_BOOK_ENTRIES).map(e => {
      const [address, text] = tuple(e, 'address book entry', 2);
      return Object.freeze({ address: decodeAddress(address), label: textOf(text, 'address book label') });
    })),
    referenceScripts: Object.freeze(arrayOf(f.get(9), 'reference scripts', MAX_REFERENCE_SCRIPTS).map(r => decodeOutputReference(r, 'reference script'))),
    proposalsDropped: uintOf(f.get(10), 'proposals left out'),
    addressBookDropped: uintOf(f.get(11), 'address book entries left out'),
    endorsements: Object.freeze(arrayOf(f.get(12), 'endorsements', MAX_ENDORSEMENTS).map(decodeEndorsement)),
    externalAttestations: Object.freeze(arrayOf(f.get(13), 'external attestations', MAX_EXTERNAL_ATTESTATIONS).map(a => decodeAttestation(a, 'external attestation'))),
  };
  // Every rule of the encoder applies, and the bytes must be exactly its output.
  const canonical = encodeRecoveryPayload(contents);
  if (!sameBytes(canonical, bytes)) bad('not the canonical encoding');
  const dropped = contents.proposalsDropped ?? 0;
  const bookDropped = contents.addressBookDropped ?? 0;
  return Object.freeze({
    version: RECOVERY_PAYLOAD_VERSION,
    ...contents,
    // Hashed from the bytes in hand: the same value as `manifestRevisionHashOf` of the hex.
    manifests: Object.freeze(contents.manifests.map((m, i) => Object.freeze({ ...m, hash: taggedHash(MANIFEST_HASH_TAG, manifestItems[i].bytes) }))),
    proposalsDropped: dropped,
    proposalHistoryTruncated: dropped > 0,
    addressBookDropped: bookDropped,
    addressBookTruncated: bookDropped > 0,
    endorsements: contents.endorsements ?? [],
    externalAttestations: contents.externalAttestations ?? [],
  });
}

/** Decodes an untrusted payload. Never throws: anything malformed is a typed refusal. */
export function decodeRecoveryPayload(bytes: unknown): DecodeRecoveryPayloadResult {
  try {
    if (!(bytes instanceof Uint8Array)) return { ok: false, code: 'PAYLOAD_INVALID', detail: 'not bytes' };
    return { ok: true, package: decode(new Uint8Array(bytes)) };
  } catch (e) {
    if (e instanceof PayloadRefusal) return { ok: false, code: e.code, ...(e.detail ? { detail: e.detail } : {}) };
    // A rule of the encoder (`INVALID_PACKAGE`) that the decoded contents break.
    if (e instanceof GeroVaultError) return { ok: false, code: 'PAYLOAD_INVALID', detail: e.message };
    return { ok: false, code: 'PAYLOAD_INVALID', detail: 'unexpected input' };
  }
}

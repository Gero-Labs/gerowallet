/**
 * The recovery package payload (spec 6.8, GV-14): what one participant needs, with their seed, to
 * rebuild a vault and spend from it with every Gero service unavailable. It is the plaintext of
 * the file in `recoveryFormat.ts`.
 *
 * Canonical CBOR (RFC 8949 section 4.2.1: definite lengths, minimal heads, map keys in bytewise
 * order of their encoding, which for the unsigned keys used here is numeric order). Payload
 * version 1, in CDDL:
 *
 *   payload = {
 *     0: 1,                          ; payload version
 *     1: uint,                       ; network magic: 764824073 mainnet, 1 preprod, 2 preview
 *     2: uint,                       ; exported at, Unix milliseconds
 *     3: native-vault / plutus-vault,
 *     4: self,
 *     5: [+ participant],            ; every participant, the exporter included
 *     6: [* manifest-revision],      ; manifest history, versions strictly ascending
 *     7: [* proposal-record],        ; proposal history
 *     8: [* address-book-entry],
 *     9: [* output-reference],       ; reference-script UTxOs
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
 *     2: uint,                       ; the date chosen for it, Unix milliseconds
 *   }
 *   plutus-vault = {
 *     0: 1,
 *     1: output-reference,           ; the seed UTxO the validator is applied to (spec 4.2.1)
 *     2: uint,                       ; template version
 *     ? 3: bstr .size 28,            ; h as recorded at creation
 *     ? 4: bstr,                     ; the applied validator as recorded at creation
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
 *   }
 *   external-key = [0, bstr .size 64]                    ; CIP-1854 account key
 *                / [1, bstr .size 64, bstr .size 64]     ; payment and stake role keys
 *   manifest-revision  = [uint, bstr]                    ; version, the manifest's canonical CBOR
 *   proposal-record    = [bstr, bstr]                    ; proposal id, the proposal's own encoding
 *   address-book-entry = [bstr, tstr]                    ; Shelley payment address bytes, label
 *   output-reference   = [bstr .size 32, uint]           ; transaction id, output index
 *
 * Owners and backup holders appear in native vaults, owners and guardians in Plutus vaults.
 * Manifests and proposals are carried as their own encoded bytes: their codecs live elsewhere
 * (GV-60, GV-61 and later), and this file never reads inside them. Proposals and the address book
 * may be empty.
 *
 * Every vault fact here is a claim until a restore re-derives it (`recoveryPackage.ts`): `h` and
 * the validator of a Plutus vault are never trusted on their own (spec 4.2.1, GV-64).
 *
 * The decoder takes untrusted bytes and never throws. It uses the strict bounded reader of
 * `cbor.ts`, refuses unknown keys and anything out of bounds, and requires the bytes to be
 * exactly the canonical encoding of what it read.
 *
 * PROVISIONAL: the schema and the vectors are not frozen until they are checked against the other
 * client.
 */
import { Cardano } from '@cardano-sdk/core';
import { Ed25519PublicKeyHex, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { blake2b } from '@noble/hashes/blake2.js';
import { bech32 } from 'bech32';
import { CborError, CborItem, bytesToHex, hexToBytes, readCbor } from './cbor';
import { GeroVaultError } from './errors';
import { BECH32_PREFIX } from './keys';
import { decodeRegistration } from './registration';
import { NETWORK_MAGIC } from './vaultId';
import { MAX_VAULT_INDEX, ROLE, VaultNetwork, VaultScript } from './types';

export const RECOVERY_PAYLOAD_VERSION = 1;

/** Bounds on a payload. */
export const MAX_PACKAGE_PARTICIPANTS = 64;
export const MAX_MANIFEST_REVISIONS = 1024;
export const MAX_PROPOSALS = 10000;
export const MAX_ADDRESS_BOOK_ENTRIES = 1024;
export const MAX_REFERENCE_SCRIPTS = 16;
const MAX_SCRIPT_BYTES = 16384;
const MAX_VALIDATOR_BYTES = 65536;
const MAX_RECORD_BYTES = 65536;
const MAX_PROPOSAL_ID_BYTES = 64;
const MAX_LABEL_BYTES = 64;
const MAX_TEMPLATE_VERSION = 0xffffffff;
const MAX_OUTPUT_INDEX = 0xffff;
const PAYLOAD_LIMITS = { maxDepth: 6, maxItems: 65536 };
const BECH32_LIMIT = 1023;
const XPUB_BYTES = 64;

export type PackageRole = 'owner' | 'backup' | 'guardian';
const ROLE_CODES: readonly PackageRole[] = ['owner', 'backup', 'guardian'];

export interface OutputReference {
  /** Transaction id, 32 bytes as lowercase hex. */
  readonly txId: string;
  readonly index: number;
}

/** The terms of a dated backup path (GV-69): what the scripts say, and the date the creator chose. */
export interface BackupTerms {
  readonly threshold: number;
  /** Absolute slot from which the backup quorum may spend. */
  readonly afterSlot: number;
  /** The date and time chosen at creation, Unix milliseconds, as the wallet shows it. */
  readonly atMs: number;
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
  /** `h` as recorded at creation; a restore derives it and never trusts this. */
  readonly scriptHash?: Hash28ByteBase16;
  /** The applied validator as recorded at creation, hex; never trusted on its own either. */
  readonly validator?: string;
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
}

export interface PackageSelf {
  /** The exporter's position in `participants`. */
  readonly position: number;
  /** The exporter's own vault index, never shared with cosigners (spec 4.0). */
  readonly index: number;
}

export interface ManifestRevision {
  readonly version: number;
  /** The manifest's canonical CBOR, hex. */
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
  readonly manifests: readonly ManifestRevision[];
  readonly proposals: readonly ProposalRecord[];
  readonly addressBook: readonly AddressBookEntry[];
  readonly referenceScripts: readonly OutputReference[];
}

/** A decoded payload. Its vault facts are claims until a restore checks them. */
export interface RecoveryPackage extends RecoveryPackageContents {
  readonly version: number;
  /** Each revision with its hash: blake2b-256 over its canonical CBOR (spec 5.2). */
  readonly manifests: readonly (ManifestRevision & { readonly hash: string })[];
}

export type RecoveryPayloadRefusalCode = 'UNKNOWN_PAYLOAD_VERSION' | 'PAYLOAD_INVALID';

export type DecodeRecoveryPayloadResult =
  | { readonly ok: true; readonly package: RecoveryPackage }
  | { readonly ok: false; readonly code: RecoveryPayloadRefusalCode; readonly detail?: string };

const LOWER_HEX = (bytes: number) => new RegExp(`^[0-9a-f]{${bytes * 2}}$`);
const KEY_HEX = LOWER_HEX(32);
const TX_ID_HEX = LOWER_HEX(32);
const SCRIPT_HASH_HEX = LOWER_HEX(28);
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

// ---------------------------------------------------------------------------------------------
// Canonical CBOR writer: the subset the payload uses.

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function head(major: number, n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new GeroVaultError('INVALID_PACKAGE', 'A CBOR argument is a non-negative safe integer');
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 0x100) return Uint8Array.of(m | 24, n);
  if (n < 0x10000) return Uint8Array.of(m | 25, n >> 8, n & 0xff);
  if (n < 0x100000000) return Uint8Array.of(m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const out = new Uint8Array(9);
  out[0] = m | 27;
  new DataView(out.buffer).setBigUint64(1, BigInt(n), false);
  return out;
}

const cUint = (n: number) => head(0, n);
const cBytes = (b: Uint8Array) => concat([head(2, b.length), b]);
const cText = (s: string) => {
  const b = new TextEncoder().encode(s);
  return concat([head(3, b.length), b]);
};
const cArray = (items: readonly Uint8Array[]) => concat([head(4, items.length), ...items]);
/** A map with unsigned keys, written in canonical (numeric) key order; `undefined` values are left out. */
function cMap(entries: Readonly<Record<number, Uint8Array | undefined>>): Uint8Array {
  const keys = Object.keys(entries).map(Number).filter(k => entries[k] !== undefined).sort((a, b) => a - b);
  return concat([head(5, keys.length), ...keys.flatMap(k => [cUint(k), entries[k] as Uint8Array])]);
}

// ---------------------------------------------------------------------------------------------
// Validation shared by the encoder and the decoder

function invalid(message: string): never {
  throw new GeroVaultError('INVALID_PACKAGE', message);
}

const isUint = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;

function hexBytes(hex: unknown, pattern: RegExp, what: string): Uint8Array {
  if (typeof hex !== 'string' || !pattern.test(hex)) invalid(`${what} is lowercase hex of the right length`);
  return hexToBytes(hex) as Uint8Array;
}

function boundedHex(hex: unknown, max: number, what: string): Uint8Array {
  if (typeof hex !== 'string' || !ANY_LOWER_HEX.test(hex) || hex.length > max * 2) invalid(`${what} is 1 to ${max} bytes of lowercase hex`);
  return hexToBytes(hex) as Uint8Array;
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function label(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0 || LONE_SURROGATE.test(value) || utf8Length(value) > MAX_LABEL_BYTES) {
    invalid(`${what} is 1 to ${MAX_LABEL_BYTES} bytes of well-formed text`);
  }
  return value as string;
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

function outputReference(ref: OutputReference | undefined, what: string): Uint8Array {
  const txId = hexBytes(ref?.txId, TX_ID_HEX, `${what} transaction id`);
  if (!isUint(ref?.index, MAX_OUTPUT_INDEX)) invalid(`${what} output index is 0 to ${MAX_OUTPUT_INDEX}`);
  return cArray([cBytes(txId), cUint(ref.index)]);
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

function externalKey(external: ExternalCosignerInput): Uint8Array {
  if (external && 'account' in external) {
    return cArray([cUint(0), cBytes(xpubBytes(external.account, BECH32_PREFIX.ACCOUNT_XVK, 'An external account key'))]);
  }
  const roles = external as { payment?: unknown; stake?: unknown };
  const payment = xpubBytes(roles?.payment, BECH32_PREFIX.PAYMENT_XVK, 'An external payment role key');
  const stake = xpubBytes(roles?.stake, BECH32_PREFIX.STAKE_XVK, 'An external stake role key');
  return cArray([cUint(1), cBytes(payment), cBytes(stake)]);
}

function vaultBytes(vault: RecoveryPackageContents['vault']): Uint8Array {
  if (vault?.kind === 'native') {
    const paymentCbor = boundedHex(vault.payment?.cbor, MAX_SCRIPT_BYTES, 'The payment script');
    const stakeCbor = boundedHex(vault.stake?.cbor, MAX_SCRIPT_BYTES, 'The stake script');
    const decoded = nativeScripts(paymentCbor, stakeCbor);
    if (decoded.payment.hash !== vault.payment.hash || decoded.stake.hash !== vault.stake.hash) {
      invalid('A vault script does not hash to its recorded hash');
    }
    let backup: Uint8Array | undefined;
    if (vault.backup !== undefined) {
      const { threshold, afterSlot, atMs } = vault.backup ?? ({} as Partial<BackupTerms>);
      if (!isUint(threshold) || threshold < 1 || !isUint(afterSlot) || afterSlot < 1 || !isUint(atMs)) {
        invalid('The backup terms are a threshold, a slot and a time');
      }
      backup = cMap({ 0: cUint(threshold), 1: cUint(afterSlot), 2: cUint(atMs) });
    }
    return cMap({ 0: cUint(0), 1: cBytes(paymentCbor), 2: cBytes(stakeCbor), 3: backup });
  }
  if (vault?.kind === 'plutus') {
    if (!isUint(vault.templateVersion, MAX_TEMPLATE_VERSION)) invalid('The template version is a 32-bit unsigned integer');
    const scriptHash = vault.scriptHash === undefined ? undefined : cBytes(hexBytes(vault.scriptHash, SCRIPT_HASH_HEX, 'The script hash'));
    const validator = vault.validator === undefined ? undefined : cBytes(boundedHex(vault.validator, MAX_VALIDATOR_BYTES, 'The validator'));
    return cMap({ 0: cUint(1), 1: outputReference(vault.seed, 'The seed'), 2: cUint(vault.templateVersion), 3: scriptHash, 4: validator });
  }
  return invalid('A vault is native or plutus');
}

function participantsBytes(contents: RecoveryPackageContents): Uint8Array {
  const list = Array.isArray(contents.participants) ? contents.participants : invalid('Participants are a list');
  if (list.length === 0 || list.length > MAX_PACKAGE_PARTICIPANTS) invalid(`A package has 1 to ${MAX_PACKAGE_PARTICIPANTS} participants`);
  const native = contents.vault.kind === 'native';
  const keys = new Set<string>();
  const distinct = (hex: string) => {
    if (keys.has(hex)) invalid('The same vault key appears twice');
    keys.add(hex);
  };
  return cArray(list.map(p => {
    const code = ROLE_CODES.indexOf(p?.role);
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
    return cMap({ 0: cUint(code), 1: cBytes(payment), 2: stake ? cBytes(stake) : undefined, 3: external });
  }));
}

function selfBytes(contents: RecoveryPackageContents): Uint8Array {
  const { position, index } = contents.self ?? ({} as Partial<PackageSelf>);
  if (!isUint(position, contents.participants.length - 1)) invalid('The exporter is one of the participants');
  if (!isUint(index, MAX_VAULT_INDEX)) invalid(`A vault index is 0 to ${MAX_VAULT_INDEX}`);
  if (contents.participants[position].external !== undefined) invalid('The exporter is not an external wallet');
  return cMap({ 0: cUint(position), 1: cUint(index) });
}

function list<T>(value: readonly T[] | undefined, max: number, what: string): readonly T[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${what} is a list of at most ${max}`);
  return value as readonly T[];
}

function manifestsBytes(manifests: readonly ManifestRevision[]): Uint8Array {
  let previous = -1;
  return cArray(list(manifests, MAX_MANIFEST_REVISIONS, 'The manifest history').map(m => {
    if (!isUint(m?.version) || m.version <= previous) invalid('Manifest versions are unsigned and strictly ascending');
    previous = m.version;
    return cArray([cUint(m.version), cBytes(boundedHex(m.cbor, MAX_RECORD_BYTES, 'A manifest'))]);
  }));
}

function proposalsBytes(proposals: readonly ProposalRecord[]): Uint8Array {
  const ids = new Set<string>();
  return cArray(list(proposals, MAX_PROPOSALS, 'The proposal history').map(p => {
    const id = boundedHex(p?.id, MAX_PROPOSAL_ID_BYTES, 'A proposal id');
    if (ids.has(p.id)) invalid('The same proposal appears twice');
    ids.add(p.id);
    return cArray([cBytes(id), cBytes(boundedHex(p.cbor, MAX_RECORD_BYTES, 'A proposal'))]);
  }));
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

function addressBookBytes(entries: readonly AddressBookEntry[], network: VaultNetwork): Uint8Array {
  const seen = new Set<string>();
  return cArray(list(entries, MAX_ADDRESS_BOOK_ENTRIES, 'The address book').map(e => {
    const bytes = addressBytes(e?.address, network);
    const hex = bytesToHex(bytes);
    if (seen.has(hex)) invalid('The same address appears twice in the address book');
    seen.add(hex);
    return cArray([cBytes(bytes), cText(label(e.label, 'An address book label'))]);
  }));
}

function referenceScriptsBytes(refs: readonly OutputReference[]): Uint8Array {
  const seen = new Set<string>();
  return cArray(list(refs, MAX_REFERENCE_SCRIPTS, 'The reference scripts').map(r => {
    const bytes = outputReference(r, 'A reference script');
    const key = `${r.txId}#${r.index}`;
    if (seen.has(key)) invalid('The same reference script UTxO appears twice');
    seen.add(key);
    return bytes;
  }));
}

/**
 * Encodes a payload. Throws `GeroVaultError('INVALID_PACKAGE')` naming the first rule the
 * contents break.
 */
export function encodeRecoveryPayload(contents: RecoveryPackageContents): Uint8Array {
  if (!contents || typeof contents !== 'object') invalid('No contents');
  const magic = Object.prototype.hasOwnProperty.call(NETWORK_MAGIC, contents.network) ? NETWORK_MAGIC[contents.network] : undefined;
  if (magic === undefined) invalid('A vault network is mainnet, preprod or preview');
  if (!isUint(contents.exportedAtMs)) invalid('The export time is Unix milliseconds');
  const vault = vaultBytes(contents.vault);
  const participants = participantsBytes(contents);
  return cMap({
    0: cUint(RECOVERY_PAYLOAD_VERSION),
    1: cUint(magic),
    2: cUint(contents.exportedAtMs),
    3: vault,
    4: selfBytes(contents),
    5: participants,
    6: manifestsBytes(contents.manifests),
    7: proposalsBytes(contents.proposals),
    8: addressBookBytes(contents.addressBook, contents.network),
    9: referenceScriptsBytes(contents.referenceScripts),
  });
}

/** blake2b-256 of a manifest's canonical CBOR, hex. */
export function manifestHash(cborHex: string): string {
  const bytes = hexToBytes(cborHex);
  if (!bytes) throw new GeroVaultError('INVALID_MANIFEST_REVISION', 'A manifest is hex');
  return bytesToHex(blake2b(bytes, { dkLen: 32 }));
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
      const b = fields(f.get(3) as CborItem, 'backup terms', [0, 1, 2]);
      out.backup = Object.freeze({
        threshold: uintOf(b.get(0), 'backup threshold'),
        afterSlot: uintOf(b.get(1), 'backup slot'),
        atMs: uintOf(b.get(2), 'backup time'),
      });
    }
    return Object.freeze(out);
  }
  const f = fields(item, 'plutus vault', [0, 1, 2], [3, 4]);
  const out: { -readonly [K in keyof PlutusVaultRecord]: PlutusVaultRecord[K] } = {
    kind: 'plutus',
    seed: decodeOutputReference(f.get(1), 'seed'),
    templateVersion: uintOf(f.get(2), 'template version', MAX_TEMPLATE_VERSION),
  };
  if (f.has(3)) out.scriptHash = Hash28ByteBase16(hexOf(bytesOf(f.get(3), 'script hash', 28, 28)));
  if (f.has(4)) out.validator = hexOf(bytesOf(f.get(4), 'validator', 1, MAX_VALIDATOR_BYTES));
  return Object.freeze(out);
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
  const f = fields(item, 'participant', [0, 1], [2, 3]);
  const out: { -readonly [K in keyof PackageParticipant]: PackageParticipant[K] } = {
    role: ROLE_CODES[uintOf(f.get(0), 'role', ROLE_CODES.length - 1)],
    payment: Ed25519PublicKeyHex(hexOf(bytesOf(f.get(1), 'payment vault key', 32, 32))),
  };
  if (f.has(2)) out.stake = Ed25519PublicKeyHex(hexOf(bytesOf(f.get(2), 'stake vault key', 32, 32)));
  if (f.has(3)) out.external = decodeExternal(f.get(3) as CborItem);
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
  const f = fields(root, 'payload', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const network = MAGIC_TO_NETWORK.get(uintOf(f.get(1), 'network magic', 0xffffffff)) ?? bad('unknown network');
  const self = fields(f.get(4) as CborItem, 'self', [0, 1]);
  const contents: RecoveryPackageContents = {
    network,
    exportedAtMs: uintOf(f.get(2), 'export time'),
    vault: decodeVault(f.get(3) as CborItem),
    self: Object.freeze({ position: uintOf(self.get(0), 'self position'), index: uintOf(self.get(1), 'self index', MAX_VAULT_INDEX) }),
    participants: Object.freeze(arrayOf(f.get(5), 'participants', MAX_PACKAGE_PARTICIPANTS).map(decodeParticipant)),
    manifests: Object.freeze(arrayOf(f.get(6), 'manifests', MAX_MANIFEST_REVISIONS).map(m => {
      const [v, b] = tuple(m, 'manifest revision', 2);
      return Object.freeze({ version: uintOf(v, 'manifest version'), cbor: hexOf(bytesOf(b, 'manifest', 1, MAX_RECORD_BYTES)) });
    })),
    proposals: Object.freeze(arrayOf(f.get(7), 'proposals', MAX_PROPOSALS).map(p => {
      const [id, b] = tuple(p, 'proposal', 2);
      return Object.freeze({ id: hexOf(bytesOf(id, 'proposal id', 1, MAX_PROPOSAL_ID_BYTES)), cbor: hexOf(bytesOf(b, 'proposal', 1, MAX_RECORD_BYTES)) });
    })),
    addressBook: Object.freeze(arrayOf(f.get(8), 'address book', MAX_ADDRESS_BOOK_ENTRIES).map(e => {
      const [address, text] = tuple(e, 'address book entry', 2);
      return Object.freeze({ address: decodeAddress(address), label: textOf(text, 'address book label') });
    })),
    referenceScripts: Object.freeze(arrayOf(f.get(9), 'reference scripts', MAX_REFERENCE_SCRIPTS).map(r => decodeOutputReference(r, 'reference script'))),
  };
  // Every rule of the encoder applies, and the bytes must be exactly its output.
  const canonical = encodeRecoveryPayload(contents);
  if (canonical.length !== bytes.length || !canonical.every((b, i) => b === bytes[i])) bad('not the canonical encoding');
  return Object.freeze({
    version: RECOVERY_PAYLOAD_VERSION,
    ...contents,
    manifests: Object.freeze(contents.manifests.map(m => Object.freeze({ ...m, hash: manifestHash(m.cbor) }))),
  });
}

/** Decodes an untrusted payload. Never throws: anything malformed is a typed refusal. */
export function decodeRecoveryPayload(bytes: unknown): DecodeRecoveryPayloadResult {
  try {
    if (!(bytes instanceof Uint8Array)) return { ok: false, code: 'PAYLOAD_INVALID', detail: 'not bytes' };
    return { ok: true, package: decode(bytes) };
  } catch (e) {
    if (e instanceof PayloadRefusal) return { ok: false, code: e.code, ...(e.detail ? { detail: e.detail } : {}) };
    // A rule of the encoder (`INVALID_PACKAGE`) that the decoded contents break.
    if (e instanceof GeroVaultError) return { ok: false, code: 'PAYLOAD_INVALID', detail: e.message };
    return { ok: false, code: 'PAYLOAD_INVALID', detail: 'unexpected input' };
  }
}

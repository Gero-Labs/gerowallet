/**
 * The vault manifest of `gero-vault/v1`, schema 1 (spec 5.2, 5.3; GV-60 #1728).
 *
 * Who controls a vault is settled on chain, by its two scripts. The manifest adds what the chain
 * does not hold (roles, devices, labels) and must never contradict the scripts, which it carries
 * so that a stored manifest can be checked with nothing else at hand. Its canonical CBOR is both
 * what is hashed and what is sent (spec 5.2).
 *
 *   VaultManifest schema 1 {
 *     protocol          "gero-vault/v1"
 *     schema            1
 *     network           "cardano-mainnet" | "cardano-preprod" | "cardano-preview"
 *     vaultId           bytes 32, derived from the scripts and the network (`vaultId.ts`)
 *     paymentScript     bytes, the payment script's canonical CBOR
 *     stakeScript       bytes, the stake script's canonical CBOR
 *     roles {           every slot present, empty where unused
 *       owners, backupHolders, guardians, delegates, viewers: [RoleEntry]
 *       external: [ExternalEntry]
 *     }
 *     viewersSeeProposalContents  bool
 *     policiesDisplay   map
 *     version           uint, 1 for the first manifest of a vault
 *     prevManifestHash  bytes 0 for version 1, else bytes 32: the hash of the previous revision
 *     revisedAt         uint, unix seconds, for display (version and prevManifestHash order revisions)
 *   }
 *   RoleEntry {
 *     credential        bytes 28; vaultKeys { payment: bytes 32, stake: bytes 32 }
 *     devices           [OwnerDeviceBinding]
 *     removedDevices    [DeviceTombstone], kept in every later revision
 *   }                   (a viewer: credential bytes 0, vaultKeys {}, removedDevices [])
 *   ExternalEntry   { credential, vaultKeys, label, role: "owner" | "backupHolder", importSig: attestation }
 *   DeviceTombstone { deviceId: bytes 16, ed25519Pub: bytes 32, bindingVersion: uint, removal: attestation }
 *   OwnerDeviceBinding {
 *     vaultId, role, credential, vaultKeys   the participant's, as in their entry ({} and bytes 0 for a viewer)
 *     deviceId          bytes 16, sha256(ed25519Pub)[0:16]
 *     ed25519Pub        bytes 32, the device's signing key
 *     x25519Pub         bytes 32, the device's separate, random, static key agreement key
 *     label             text
 *     bindingVersion    uint >= 1
 *     deviceSig         bytes 64, by ed25519Pub over the device digest of the body
 *     attestation       { method: uint, proof: bytes } by the participant's vault payment key over
 *                       the binding digest (`attestation.ts`); {} for a viewer
 *     admittedBy        a viewer's: { deviceId: bytes 16, signature: bytes 64 }, an owner device's
 *                       signature over the viewer admission digest; {} for anyone else
 *   }
 *
 * The binding body is every field of the binding except `deviceSig`, `attestation` and
 * `admittedBy`. Tagged hashes, each `blake2b-256( tag || canonical CBOR )`:
 * - manifest hash      "gero-vault/v1|manifest|", the manifest
 * - binding digest     "gero-vault/v1|binding|", the binding body: what the attestation signs
 * - device digest      "gero-vault/v1|binding-device|", the binding body: what `deviceSig` signs
 * - viewer admission   "gero-vault/v1|viewer-admission|", the binding digest's 32 bytes
 * - device removal     "gero-vault/v1|device-removal|", `{ vaultId, deviceId, bindingVersion }`:
 *                      what a tombstone's `removal` signs
 * - external import    "gero-vault/v1|external-import|", `{ vaultId, credential, vaultKeys, role,
 *                      label }`: what `importSig` signs
 *
 * What the verification ceremony does not compare is covered by signatures of its own. A
 * participant's binding carries that participant's attestation by their vault payment key; a
 * viewer's binding carries the admission of an owner device; a removed device leaves a tombstone
 * attested by its participant's payment key; and an external entry carries `importSig`, an
 * attestation by the payment key of the owner who imported it. `importedBy` is not stored: it is
 * the credential of the key that made `importSig`, which must be an owner's (only the owners slot
 * imports), so a relay cannot reassign an import, and device changes never strand one.
 *
 * Removing a device (spec 5.3): its participant's revision drops the binding and adds a
 * tombstone, which no later revision may drop. A binding of that device id must carry a
 * `bindingVersion` above every tombstone of it, and needs a new attestation. A viewer admitted by
 * a removed device keeps its binding, but its admission lapses: it has no standing
 * (`deviceStanding`) until an owner device admits it again.
 *
 * Threshold, template and backup terms are read from the scripts (`parseVaultScript`) and never
 * stored twice. The participants are exactly the scripts' keys: each owner, backup holder and
 * external cosigner's payment key in the payment script and stake key in the stake script, in the
 * branch of their role. No field carries a vault index: each participant keeps their own index to
 * themselves (spec 4.0). Lists are sorted and proofs are in their one stored form, so one manifest
 * has exactly one encoding; every hex string in or out of this module is lowercase. Stored labels
 * follow the read rule of `labels.ts`; builders apply its write rule.
 *
 * Phase 1 (native vaults) fixes some fields: no guardians or delegates (they arrive with Plutus
 * vaults), `viewersSeeProposalContents` false, `policiesDisplay` empty.
 *
 * This module checks structure, keys and scripts. Signatures are verified by
 * `checkManifestBeforeAck`, which is asynchronous.
 *
 * PROVISIONAL: field encodings, tags and vectors are not frozen until they are checked against the
 * other clients' vectors (GV-07 #1675).
 */
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32 } from 'bech32';
import {
  ATTESTATION_METHOD,
  MAX_ATTESTATION_BYTES,
  OwnerAttestation,
  atLeastP,
  attestationSigner,
  isCanonicalAttestation,
  isUsableEd25519Key,
  verifyEd25519,
} from './attestation';
import { CborBoolean, CborError, CborItemOf, CborValueOf, bytesToHex, hexToBytes, readCbor } from './cbor';
import { CborWritableMap, encodeCanonicalCbor } from './canonicalCbor';
import { GeroVaultError } from './errors';
import { BECH32_PREFIX, parseVaultPublicKeys } from './keys';
import { readLabel, writeLabel } from './labels';
import { decodeRegistration } from './registration';
import {
  MAX_BACKUP_KEYS,
  MAX_OWNERS,
  ParsedVaultScript,
  instantiateVaultScripts,
  parseVaultScript,
  vaultSpecWarnings,
} from './scripts';
import { ROLE, VaultNetwork, VaultPublicKeys, VaultScript, VaultScripts, VaultTemplate } from './types';
import { vaultId as scriptVaultId } from './vaultId';

export const MANIFEST_PROTOCOL = 'gero-vault/v1';
export const MANIFEST_SCHEMA = 1;
export const MANIFEST_HASH_TAG = 'gero-vault/v1|manifest|';
export const BINDING_DIGEST_TAG = 'gero-vault/v1|binding|';
export const BINDING_DEVICE_TAG = 'gero-vault/v1|binding-device|';
export const VIEWER_ADMISSION_TAG = 'gero-vault/v1|viewer-admission|';
export const DEVICE_REMOVAL_TAG = 'gero-vault/v1|device-removal|';
export const EXTERNAL_IMPORT_TAG = 'gero-vault/v1|external-import|';

/** Network ids as `gero-xdev/v1` writes them. */
export const WIRE_NETWORK: Readonly<Record<VaultNetwork, string>> = Object.freeze({
  mainnet: 'cardano-mainnet',
  preprod: 'cardano-preprod',
  preview: 'cardano-preview',
});

/** Bounds on untrusted input. */
export const MAX_MANIFEST_BYTES = 262144;
export const MAX_DEVICES_PER_ENTRY = 5;
export const MAX_VIEWERS = 20;
export const MAX_BINDINGS = 64;
/** Tombstones in one manifest, all participants together. PROVISIONAL: the spec sets no bound. */
export const MAX_REMOVED_DEVICES = 128;
const MAX_SCRIPT_BYTES = 8192;
/** Owners, backup holders and external cosigners together: every key of the two scripts. */
const MAX_SCRIPT_PARTICIPANTS = MAX_OWNERS + MAX_BACKUP_KEYS;
const MAX_VERSION = 0xffffffff;
/** Unix seconds; a value in milliseconds is out of range. */
const MAX_REVISED_AT = 99_999_999_999;
const CBOR_LIMITS = { maxDepth: 10, maxItems: 16384, booleans: true } as const;

export type ManifestRole = 'owner' | 'backupHolder' | 'guardian' | 'delegate' | 'viewer';
const ROLES: readonly ManifestRole[] = ['owner', 'backupHolder', 'guardian', 'delegate', 'viewer'];
/** The script branch of an external cosigner (phase 1). */
export type ExternalRole = 'owner' | 'backupHolder';

/** A device binding without `deviceSig`, `attestation` and `admittedBy`: what they sign. */
export interface DeviceBindingBody {
  readonly vaultId: string;
  readonly role: ManifestRole;
  /** The participant's payment key hash; absent for a viewer. */
  readonly credential?: Ed25519KeyHashHex;
  /** The participant's vault keys, as in their entry; absent for a viewer. */
  readonly vaultKeys?: VaultPublicKeys;
  readonly deviceId: string;
  readonly ed25519Pub: string;
  readonly x25519Pub: string;
  readonly label: string;
  readonly bindingVersion: number;
}

/** An owner device's admission of a viewer's binding. */
export interface ViewerAdmission {
  /** The admitting owner device. */
  readonly deviceId: string;
  /** 64 bytes, lowercase hex: by that device's key over `viewerAdmissionDigest`. */
  readonly signature: string;
}

export interface OwnerDeviceBinding extends DeviceBindingBody {
  /** 64 bytes, lowercase hex: Ed25519 by `ed25519Pub` over `bindingDeviceDigest`. */
  readonly deviceSig: string;
  /** Required for every role with a script key; absent for a viewer. */
  readonly attestation?: OwnerAttestation;
  /** Required for a viewer; absent for anyone else. */
  readonly admittedBy?: ViewerAdmission;
}

/** What is kept of a removed device: enough to refuse it, and its participant's removal attestation. */
export interface DeviceTombstone {
  readonly deviceId: string;
  readonly ed25519Pub: string;
  /** The `bindingVersion` of the binding removed. */
  readonly bindingVersion: number;
  /** By the participant's vault payment key over `deviceRemovalDigest`. */
  readonly removal: OwnerAttestation;
}

/** An owner, backup holder, guardian or delegate. */
export interface ParticipantEntry {
  readonly credential: Ed25519KeyHashHex;
  readonly vaultKeys: VaultPublicKeys;
  readonly devices: readonly OwnerDeviceBinding[];
  /** Tombstones of the participant's removed devices; empty when none was removed. */
  readonly removedDevices: readonly DeviceTombstone[];
}

/** A viewer has no script key, only devices (at least one). */
export interface ViewerEntry {
  readonly devices: readonly OwnerDeviceBinding[];
}

/** What `importSig` signs, with the vault id. */
export interface ExternalEntryBody {
  readonly credential: Ed25519KeyHashHex;
  readonly vaultKeys: VaultPublicKeys;
  readonly label: string;
  readonly role: ExternalRole;
}

/**
 * A cosigner with no Gero device. `vaultKeys` are the raw keys the importing owner derived from
 * the external wallet's role or account key; the manifest never carries an extended key. `role` is
 * the script branch the keys sit in.
 */
export interface ExternalEntry extends ExternalEntryBody {
  /** By the importing owner's vault payment key over `externalImportDigest`. */
  readonly importSig: OwnerAttestation;
  /** Derived, not stored: the credential of the key that made `importSig`, an owner's. */
  readonly importedBy?: Ed25519KeyHashHex;
}

export interface ManifestRoles {
  readonly owners: readonly ParticipantEntry[];
  readonly backupHolders: readonly ParticipantEntry[];
  /** Always empty in phase 1. */
  readonly guardians: readonly ParticipantEntry[];
  /** Always empty in phase 1. */
  readonly delegates: readonly ParticipantEntry[];
  readonly viewers: readonly ViewerEntry[];
  readonly external: readonly ExternalEntry[];
}

export interface VaultManifest {
  readonly protocol: typeof MANIFEST_PROTOCOL;
  readonly schema: typeof MANIFEST_SCHEMA;
  readonly network: VaultNetwork;
  readonly vaultId: string;
  /** The payment script's canonical CBOR, hex. */
  readonly paymentScript: string;
  /** The stake script's canonical CBOR, hex. */
  readonly stakeScript: string;
  readonly roles: ManifestRoles;
  /** Always false in phase 1. */
  readonly viewersSeeProposalContents: boolean;
  /** Always empty in phase 1. */
  readonly policiesDisplay: Readonly<Record<string, never>>;
  readonly version: number;
  /** Absent for version 1. */
  readonly prevManifestHash?: string;
  /** Unix seconds, for display. */
  readonly revisedAt: number;
}

export type ManifestRefusalCode =
  | 'MALFORMED_INPUT'
  | 'TOO_LARGE'
  | 'MALFORMED_CBOR'
  | 'NOT_CANONICAL'
  | 'SCHEMA_INVALID'
  | 'UNSUPPORTED_PROTOCOL'
  | 'UNSUPPORTED_SCHEMA'
  | 'UNKNOWN_NETWORK'
  | 'FIELD_INVALID'
  | 'LABEL_INVALID'
  | 'DEVICE_KEY_INVALID'
  | 'VERSION_INVALID'
  | 'NOT_IN_PHASE_1'
  | 'TOO_MANY_ENTRIES'
  | 'CREDENTIAL_MISMATCH'
  | 'IMPORTER_INVALID'
  | 'ADMISSION_INVALID'
  | 'DUPLICATE_PARTICIPANT'
  | 'DUPLICATE_DEVICE'
  | 'BINDING_MISMATCH'
  | 'DEVICE_ID_MISMATCH'
  | 'ATTESTATION_INVALID'
  | 'TOMBSTONE_INVALID'
  | 'REMOVED_DEVICE_BOUND'
  | 'SCRIPT_INVALID'
  | 'VAULT_ID_MISMATCH'
  | 'UNKNOWN_TEMPLATE'
  | 'TEMPLATE_MISMATCH'
  | 'KEY_NOT_IN_SCRIPT'
  | 'ROLE_MISMATCH'
  | 'SCRIPT_KEY_UNACCOUNTED'
  | 'OUTSIDE_POLICY';

export type DecodeManifestResult =
  | { readonly ok: true; readonly manifest: VaultManifest; /** The canonical CBOR, hex. */ readonly cbor: string; readonly hash: string }
  | { readonly ok: false; readonly code: ManifestRefusalCode; /** For logs and tests; never shown as is. */ readonly detail?: string };

class Fault extends Error {
  constructor(readonly code: ManifestRefusalCode, readonly detail?: string) {
    super(code);
  }
}

const fault = (code: ManifestRefusalCode, detail?: string): never => {
  throw new Fault(code, detail);
};

// ---------------------------------------------------------------------------------------------
// Field rules, shared by the encoder and the decoder

const HEX_LENGTH: Readonly<Record<number, RegExp>> = {
  16: /^[0-9a-f]{32}$/,
  28: /^[0-9a-f]{56}$/,
  32: /^[0-9a-f]{64}$/,
  64: /^[0-9a-f]{128}$/,
};
const HEX_BYTES = /^(?:[0-9a-f]{2})+$/;
const EMPTY = new Uint8Array(0);

function isHex(value: unknown, bytes: 16 | 28 | 32 | 64): value is string {
  return typeof value === 'string' && HEX_LENGTH[bytes].test(value);
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

/** A stored label: the read rule of `labels.ts`. */
function checkLabel(label: unknown, what: string): string {
  return readLabel(label) ?? fault('LABEL_INVALID', `${what} breaks the read rule`);
}

/** A label being written: the write rule of `labels.ts`, which also normalises it. */
function writtenLabel(label: unknown, what: string): string {
  try {
    return writeLabel(label);
  } catch (e) {
    if (e instanceof GeroVaultError) fault('LABEL_INVALID', `${what}: ${e.message}`);
    throw e;
  }
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** blake2b-224 of a raw Ed25519 key: its Cardano key hash. */
function keyHashOf(publicKeyHex: string): Ed25519KeyHashHex {
  return Ed25519KeyHashHex(bytesToHex(blake2b(hexToBytes(publicKeyHex), { dkLen: 28 })));
}

/** The branded vault keys, through `keys.ts`'s own parser (which refuses equal keys). */
function vaultKeysOf(payment: string, stake: string): VaultPublicKeys {
  const encode = (prefix: string, hex: string) => bech32.encode(prefix, bech32.toWords(hexToBytes(hex)), 1023);
  return parseVaultPublicKeys({ payment: encode(BECH32_PREFIX.PAYMENT_VK, payment), stake: encode(BECH32_PREFIX.STAKE_VK, stake) });
}

function checkVaultKeys(k: VaultPublicKeys, what: string): VaultPublicKeys {
  if (k?.level !== 'vault' || !isHex(k.payment, 32) || !isHex(k.stake, 32) || k.payment === k.stake) {
    return fault('FIELD_INVALID', what);
  }
  return vaultKeysOf(k.payment, k.stake);
}

// X25519 device keys (spec 5.3): small-order and non-canonical values are refused. The list is
// the curve's small-order u coordinates; the specs check it against an independent implementation.
const X25519_SMALL_ORDER = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
];

/** An X25519 device key: canonical (top bit clear, below p), not zero and not of small order. */
export function isUsableX25519Key(hex: string): boolean {
  if (!isHex(hex, 32)) return false;
  const u = hexToBytes(hex);
  return (u[31] & 0x80) === 0 && !atLeastP(u) && !X25519_SMALL_ORDER.includes(hex);
}

function deviceIdHex(ed25519Pub: string): string {
  return bytesToHex(sha256(hexToBytes(ed25519Pub)).subarray(0, 16));
}

/** `sha256(ed25519Pub)[0:16]` as hex, the device id of `gero-xdev/v1` (spec 5.1). */
export function deviceIdOf(ed25519Pub: string): string {
  if (!isHex(ed25519Pub, 32)) throw new GeroVaultError('INVALID_DEVICE_BINDING', 'A device key is 32 bytes of lowercase hex');
  return deviceIdHex(ed25519Pub);
}

function checkBindingBody(b: DeviceBindingBody): DeviceBindingBody {
  if (!b || typeof b !== 'object') return fault('SCHEMA_INVALID', 'binding');
  if (!isHex(b.vaultId, 32)) fault('FIELD_INVALID', 'binding vaultId');
  if (!ROLES.includes(b.role)) fault('FIELD_INVALID', 'binding role');
  const viewer = b.role === 'viewer';
  let vaultKeys: VaultPublicKeys | undefined;
  if (viewer) {
    if (b.credential || b.vaultKeys) fault('FIELD_INVALID', 'a viewer binding has no script key');
  } else {
    vaultKeys = checkVaultKeys(b.vaultKeys, 'binding vaultKeys');
    if (b.credential !== keyHashOf(vaultKeys.payment)) fault('CREDENTIAL_MISMATCH', 'binding credential');
  }
  if (!isHex(b.ed25519Pub, 32) || !isHex(b.x25519Pub, 32)) fault('FIELD_INVALID', 'device keys');
  if (b.ed25519Pub === b.x25519Pub) fault('FIELD_INVALID', 'the X25519 key is the Ed25519 key');
  if (!isUsableEd25519Key(b.ed25519Pub) || !isUsableX25519Key(b.x25519Pub)) fault('DEVICE_KEY_INVALID');
  if (b.deviceId !== deviceIdHex(b.ed25519Pub)) fault('DEVICE_ID_MISMATCH');
  checkLabel(b.label, 'A device label');
  if (!isInt(b.bindingVersion, 1, MAX_VERSION)) fault('FIELD_INVALID', 'bindingVersion');
  return Object.freeze({
    vaultId: b.vaultId,
    role: b.role,
    ...(viewer ? {} : { credential: b.credential, vaultKeys }),
    deviceId: b.deviceId,
    ed25519Pub: b.ed25519Pub,
    x25519Pub: b.x25519Pub,
    label: b.label,
    bindingVersion: b.bindingVersion,
  });
}

/** An attestation in its stored form (`attestation.ts`), refused with `code`. */
function checkProof(a: OwnerAttestation | undefined, code: ManifestRefusalCode, what: string): OwnerAttestation {
  if (!a || (a.method !== ATTESTATION_METHOD.CIP8 && a.method !== ATTESTATION_METHOD.EXPIRED_TX)) {
    return fault(code, `${what} method`);
  }
  if (typeof a.proof !== 'string' || !HEX_BYTES.test(a.proof) || a.proof.length > MAX_ATTESTATION_BYTES * 2) {
    fault(code, `${what} proof`);
  }
  if (!isCanonicalAttestation(a)) fault(code, `${what} is not in the stored form`);
  return Object.freeze({ method: a.method, proof: a.proof });
}

function checkAttestation(role: ManifestRole, a: OwnerAttestation | undefined): OwnerAttestation | undefined {
  if (role === 'viewer') {
    if (a !== undefined && a !== null) fault('ATTESTATION_INVALID', 'a viewer binding carries no attestation');
    return undefined;
  }
  return checkProof(a, 'ATTESTATION_INVALID', 'attestation');
}

function checkAdmission(role: ManifestRole, a: ViewerAdmission | undefined, admitters: ReadonlySet<string>): ViewerAdmission | undefined {
  if (role !== 'viewer') {
    if (a !== undefined && a !== null) fault('ADMISSION_INVALID', 'only a viewer binding is admitted');
    return undefined;
  }
  if (!a || !isHex(a.deviceId, 16) || !isHex(a.signature, 64)) return fault('ADMISSION_INVALID', 'a viewer binding carries admittedBy');
  if (!admitters.has(a.deviceId)) fault('ADMISSION_INVALID', 'admittedBy names an owner device of the manifest');
  return Object.freeze({ deviceId: a.deviceId, signature: a.signature });
}

interface BindingContext {
  readonly vaultId: string;
  readonly role: ManifestRole;
  readonly credential?: string;
  readonly vaultKeys?: VaultPublicKeys;
}

function checkDevices(
  list: readonly OwnerDeviceBinding[],
  ctx: BindingContext,
  min: number,
  admitters: ReadonlySet<string>,
): readonly OwnerDeviceBinding[] {
  if (!Array.isArray(list)) return fault('SCHEMA_INVALID', 'devices');
  if (list.length > MAX_DEVICES_PER_ENTRY) fault('TOO_MANY_ENTRIES', 'devices of one participant');
  if (list.length < min) fault('FIELD_INVALID', 'a viewer has at least one device');
  const out = list.map(b => {
    const body = checkBindingBody(b);
    const sameKeys = body.vaultKeys?.payment === ctx.vaultKeys?.payment && body.vaultKeys?.stake === ctx.vaultKeys?.stake;
    if (body.vaultId !== ctx.vaultId || body.role !== ctx.role || body.credential !== ctx.credential || !sameKeys) {
      fault('BINDING_MISMATCH');
    }
    if (!isHex(b.deviceSig, 64)) fault('FIELD_INVALID', 'deviceSig');
    const attestation = checkAttestation(body.role, b.attestation);
    const admittedBy = checkAdmission(body.role, b.admittedBy, admitters);
    return Object.freeze({ ...body, deviceSig: b.deviceSig, ...(attestation ? { attestation } : {}), ...(admittedBy ? { admittedBy } : {}) });
  });
  return Object.freeze(out.sort((a, b) => byText(a.deviceId, b.deviceId)));
}

const byDeviceThenVersion = (a: DeviceTombstone, b: DeviceTombstone) => byText(a.deviceId, b.deviceId) || a.bindingVersion - b.bindingVersion;

function checkTombstones(list: readonly DeviceTombstone[] | undefined): readonly DeviceTombstone[] {
  const items = list ?? [];
  if (!Array.isArray(items)) return fault('SCHEMA_INVALID', 'removedDevices');
  if (items.length > MAX_REMOVED_DEVICES) fault('TOO_MANY_ENTRIES', 'removed devices');
  const out = items.map(t => {
    if (!t || typeof t !== 'object') return fault('SCHEMA_INVALID', 'tombstone');
    if (!isHex(t.ed25519Pub, 32) || !isUsableEd25519Key(t.ed25519Pub)) fault('DEVICE_KEY_INVALID', 'tombstone');
    if (t.deviceId !== deviceIdHex(t.ed25519Pub)) fault('DEVICE_ID_MISMATCH', 'tombstone');
    if (!isInt(t.bindingVersion, 1, MAX_VERSION)) fault('FIELD_INVALID', 'tombstone bindingVersion');
    const removal = checkProof(t.removal, 'TOMBSTONE_INVALID', 'removal');
    return Object.freeze({ deviceId: t.deviceId, ed25519Pub: t.ed25519Pub, bindingVersion: t.bindingVersion, removal });
  });
  return Object.freeze(out.sort(byDeviceThenVersion));
}

function checkParticipant(e: ParticipantEntry, role: ManifestRole, vaultId: string): ParticipantEntry {
  if (!e || typeof e !== 'object') return fault('SCHEMA_INVALID', 'participant');
  const vaultKeys = checkVaultKeys(e.vaultKeys, 'vaultKeys');
  const credential = keyHashOf(vaultKeys.payment);
  if (e.credential !== credential) fault('CREDENTIAL_MISMATCH');
  return Object.freeze({
    credential,
    vaultKeys,
    devices: checkDevices(e.devices, { vaultId, role, credential, vaultKeys }, 0, new Set()),
    removedDevices: checkTombstones(e.removedDevices),
  });
}

function checkViewer(e: ViewerEntry, vaultId: string, admitters: ReadonlySet<string>): ViewerEntry {
  if (!e || typeof e !== 'object') return fault('SCHEMA_INVALID', 'viewer');
  const keyed = e as { credential?: unknown; vaultKeys?: unknown; removedDevices?: readonly unknown[] };
  if (keyed.credential || keyed.vaultKeys) fault('FIELD_INVALID', 'a viewer has no script key');
  if (keyed.removedDevices?.length) fault('FIELD_INVALID', 'a viewer device is removed by the owners, with no tombstone');
  return Object.freeze({ devices: checkDevices(e.devices, { vaultId, role: 'viewer' }, 1, admitters) });
}

function checkExternalBody(e: ExternalEntryBody): ExternalEntryBody {
  if (!e || typeof e !== 'object') return fault('SCHEMA_INVALID', 'external');
  const vaultKeys = checkVaultKeys(e.vaultKeys, 'external vaultKeys');
  const credential = keyHashOf(vaultKeys.payment);
  if (e.credential !== credential) fault('CREDENTIAL_MISMATCH', 'external');
  if (e.role !== 'owner' && e.role !== 'backupHolder') fault('FIELD_INVALID', 'external role');
  return Object.freeze({ credential, vaultKeys, label: checkLabel(e.label, 'An external label'), role: e.role });
}

function checkExternal(e: ExternalEntry, owners: ReadonlySet<string>): ExternalEntry {
  const body = checkExternalBody(e);
  const importSig = checkProof(e.importSig, 'IMPORTER_INVALID', 'importSig');
  // Only an owner imports: the key that made importSig must be an owner's.
  const importedBy = attestationSigner(importSig);
  if (!importedBy || !owners.has(importedBy)) fault('IMPORTER_INVALID', 'importSig is by an owner\'s vault payment key');
  return Object.freeze({ ...body, importSig, importedBy: Ed25519KeyHashHex(importedBy) });
}

const SLOTS = ['owners', 'backupHolders', 'guardians', 'delegates', 'viewers', 'external'] as const;

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** Decodes the two scripts strictly (canonical CBOR, bounded), through the registration decoder. */
function decodeScripts(paymentScript: string, stakeScript: string): { payment: VaultScript; stake: VaultScript } {
  const decoded = decodeRegistration({ metadata: { json: { types: [ROLE.PAYMENT, ROLE.STAKE] } }, nativeScripts: { cbors: [paymentScript, stakeScript] } });
  if (decoded.ok === false) return fault('SCRIPT_INVALID', decoded.code);
  return { payment: decoded.registration.payment, stake: decoded.registration.stake };
}

const backupsOf = (p: ParsedVaultScript): readonly Ed25519KeyHashHex[] => (p.kind === 'backup' ? p.backups : []);

function templateOf(p: ParsedVaultScript, s: ParsedVaultScript): VaultTemplate | undefined {
  if (p.kind !== s.kind || p.threshold !== s.threshold || p.owners.length !== s.owners.length) return undefined;
  if (p.kind === 'standard') return Object.freeze({ kind: 'standard', threshold: p.threshold });
  if (s.kind !== 'backup' || p.backupThreshold !== s.backupThreshold || p.backupAfterSlot !== s.backupAfterSlot
    || p.backups.length !== s.backups.length) {
    return undefined;
  }
  return Object.freeze({ kind: 'backup', threshold: p.threshold, backupThreshold: p.backupThreshold, backupAfterSlot: p.backupAfterSlot });
}

const POLICY_CODES: ReadonlySet<string> = new Set(['THRESHOLD_TOO_LOW', 'TOO_FEW_OWNERS', 'TOO_MANY_OWNERS']);

interface Placed {
  readonly role: ExternalRole;
  readonly payment: Ed25519KeyHashHex;
  readonly stake: Ed25519KeyHashHex;
}

/** Checks the scripts are exactly the participants' keys, each in the branch of their role. */
function checkScripts(m: VaultManifest, placed: readonly Placed[]): void {
  if (!HEX_BYTES.test(m.paymentScript ?? '') || !HEX_BYTES.test(m.stakeScript ?? '')
    || m.paymentScript.length > MAX_SCRIPT_BYTES * 2 || m.stakeScript.length > MAX_SCRIPT_BYTES * 2) {
    fault('SCRIPT_INVALID', 'scripts are CBOR hex');
  }
  const scripts = decodeScripts(m.paymentScript, m.stakeScript);
  if (scripts.payment.cbor !== m.paymentScript || scripts.stake.cbor !== m.stakeScript) fault('SCRIPT_INVALID', 'not canonical');
  if (scriptVaultId(scripts, m.network) !== m.vaultId) fault('VAULT_ID_MISMATCH');
  const p = parseVaultScript(scripts.payment.script);
  const s = parseVaultScript(scripts.stake.script);
  if (!p || !s) fault('UNKNOWN_TEMPLATE');
  const template = templateOf(p, s) ?? fault('TEMPLATE_MISMATCH');
  const branch = {
    owner: { payment: new Set<string>(p.owners), stake: new Set<string>(s.owners) },
    backupHolder: { payment: new Set<string>(backupsOf(p)), stake: new Set<string>(backupsOf(s)) },
  };
  for (const x of placed) {
    const other = x.role === 'owner' ? 'backupHolder' : 'owner';
    for (const part of ['payment', 'stake'] as const) {
      if (branch[x.role][part].has(x[part])) continue;
      fault(branch[other][part].has(x[part]) ? 'ROLE_MISMATCH' : 'KEY_NOT_IN_SCRIPT', x.payment);
    }
  }
  if (placed.length !== p.owners.length + backupsOf(p).length) fault('SCRIPT_KEY_UNACCOUNTED');
  // Rebuilt in the scripts' own key order: the bounds of `scripts.ts` apply and the bytes must agree.
  const byPayment = new Map(placed.map(x => [x.payment as string, { payment: x.payment, stake: x.stake }]));
  const spec = { template, owners: p.owners.map(h => byPayment.get(h)), backups: backupsOf(p).map(h => byPayment.get(h)) };
  let rebuilt: VaultScripts;
  try {
    rebuilt = instantiateVaultScripts(spec, {
      payment: { owners: p.owners, backups: backupsOf(p) },
      stake: { owners: s.owners, backups: backupsOf(s) },
    }, { acknowledged: vaultSpecWarnings(spec) });
  } catch (e) {
    if (e instanceof GeroVaultError) fault(POLICY_CODES.has(e.code) ? 'OUTSIDE_POLICY' : 'SCRIPT_INVALID', e.code);
    throw e;
  }
  if (rebuilt.payment.hash !== scripts.payment.hash || rebuilt.stake.hash !== scripts.stake.hash) fault('SCRIPT_INVALID', 'rebuild');
}

/** Validates a manifest and returns it normalized: sorted lists, frozen. Throws `Fault`. */
function normalize(m: VaultManifest): VaultManifest {
  if (!m || typeof m !== 'object') return fault('SCHEMA_INVALID', 'not a manifest');
  if (m.protocol !== MANIFEST_PROTOCOL) fault('UNSUPPORTED_PROTOCOL');
  if (m.schema !== MANIFEST_SCHEMA) fault('UNSUPPORTED_SCHEMA');
  if (!Object.prototype.hasOwnProperty.call(WIRE_NETWORK, m.network)) fault('UNKNOWN_NETWORK');
  if (!isHex(m.vaultId, 32)) fault('FIELD_INVALID', 'vaultId');
  if (!isInt(m.version, 1, MAX_VERSION)) fault('VERSION_INVALID', 'version');
  if (m.version === 1 ? Boolean(m.prevManifestHash) : !isHex(m.prevManifestHash, 32)) {
    fault('VERSION_INVALID', 'only version 1 has no previous manifest');
  }
  if (!isInt(m.revisedAt, 0, MAX_REVISED_AT)) fault('FIELD_INVALID', 'revisedAt is unix seconds');
  if (typeof m.viewersSeeProposalContents !== 'boolean') fault('SCHEMA_INVALID', 'viewersSeeProposalContents');
  if (m.viewersSeeProposalContents) fault('NOT_IN_PHASE_1', 'viewers see no proposal contents in phase 1');
  if (!isPlainObject(m.policiesDisplay)) fault('SCHEMA_INVALID', 'policiesDisplay');
  if (Object.keys(m.policiesDisplay).length > 0) fault('NOT_IN_PHASE_1', 'no policies in phase 1');

  const r = m.roles;
  if (!r || typeof r !== 'object' || !SLOTS.every(s => Array.isArray(r[s]))) fault('SCHEMA_INVALID', 'roles');
  if (r.guardians.length > 0 || r.delegates.length > 0) fault('NOT_IN_PHASE_1', 'guardians and delegates arrive with Plutus vaults');
  if (r.owners.length > MAX_OWNERS || r.backupHolders.length > MAX_BACKUP_KEYS || r.viewers.length > MAX_VIEWERS
    || r.owners.length + r.backupHolders.length + r.external.length > MAX_SCRIPT_PARTICIPANTS) {
    fault('TOO_MANY_ENTRIES', 'role slots');
  }
  const byCredential = <T extends { credential: string }>(a: T, b: T) => byText(a.credential, b.credential);
  const owners = r.owners.map(e => checkParticipant(e, 'owner', m.vaultId)).sort(byCredential);
  const backupHolders = r.backupHolders.map(e => checkParticipant(e, 'backupHolder', m.vaultId)).sort(byCredential);
  // A viewer is admitted by an owner device: one bound now, or one removed since (the admission lapsed).
  const liveOwnerDevices = new Set(owners.flatMap(e => e.devices.map(d => d.deviceId)));
  const admitters = new Set([...liveOwnerDevices, ...owners.flatMap(e => e.removedDevices.map(t => t.deviceId))]);
  const viewers = r.viewers.map(e => checkViewer(e, m.vaultId, admitters))
    .sort((a, b) => byText(a.devices[0].deviceId, b.devices[0].deviceId));
  if (m.version === 1 && viewers.some(v => v.devices.some(d => !liveOwnerDevices.has(d.admittedBy.deviceId)))) {
    fault('ADMISSION_INVALID', 'a first manifest has no lapsed admission');
  }
  const external = r.external.map(e => checkExternal(e, new Set(owners.map(o => o.credential)))).sort(byCredential);

  if (!unique([...owners, ...backupHolders, ...external].map(e => e.credential))) fault('DUPLICATE_PARTICIPANT', 'credential');
  if (!unique([...owners, ...backupHolders, ...external].flatMap(e => [e.vaultKeys.payment, e.vaultKeys.stake]))) {
    fault('DUPLICATE_PARTICIPANT', 'vault key');
  }
  const bindings = [...owners, ...backupHolders, ...viewers].flatMap(e => e.devices);
  if (bindings.length > MAX_BINDINGS) fault('TOO_MANY_ENTRIES', 'devices');
  if (!unique(bindings.map(b => b.deviceId)) || !unique(bindings.flatMap(b => [b.ed25519Pub, b.x25519Pub]))) {
    fault('DUPLICATE_DEVICE');
  }
  const tombstones = [...owners, ...backupHolders].flatMap(e => e.removedDevices);
  if (tombstones.length > MAX_REMOVED_DEVICES) fault('TOO_MANY_ENTRIES', 'removed devices');
  if (!unique(tombstones.map(t => `${t.deviceId}:${t.bindingVersion}`))) fault('DUPLICATE_DEVICE', 'tombstone');
  // A removed binding version never returns: a device bound again carries a higher one.
  const removedUpTo = new Map<string, number>();
  for (const t of tombstones) removedUpTo.set(t.deviceId, Math.max(removedUpTo.get(t.deviceId) ?? 0, t.bindingVersion));
  if (bindings.some(b => (removedUpTo.get(b.deviceId) ?? 0) >= b.bindingVersion)) fault('REMOVED_DEVICE_BOUND');

  const placed: Placed[] = [
    ...owners.map(e => ({ role: 'owner' as const, payment: e.credential, stake: keyHashOf(e.vaultKeys.stake) })),
    ...backupHolders.map(e => ({ role: 'backupHolder' as const, payment: e.credential, stake: keyHashOf(e.vaultKeys.stake) })),
    ...external.map(e => ({ role: e.role, payment: e.credential, stake: keyHashOf(e.vaultKeys.stake) })),
  ];
  checkScripts(m, placed);

  return Object.freeze({
    protocol: MANIFEST_PROTOCOL,
    schema: MANIFEST_SCHEMA,
    network: m.network,
    vaultId: m.vaultId,
    paymentScript: m.paymentScript,
    stakeScript: m.stakeScript,
    roles: Object.freeze({
      owners: Object.freeze(owners),
      backupHolders: Object.freeze(backupHolders),
      guardians: Object.freeze([]),
      delegates: Object.freeze([]),
      viewers: Object.freeze(viewers),
      external: Object.freeze(external),
    }),
    viewersSeeProposalContents: false,
    policiesDisplay: Object.freeze({}),
    version: m.version,
    ...(m.version === 1 ? {} : { prevManifestHash: m.prevManifestHash }),
    revisedAt: m.revisedAt,
  });
}

function asGeroVaultError(e: unknown, code: 'INVALID_MANIFEST' | 'INVALID_DEVICE_BINDING'): unknown {
  if (e instanceof Fault) return new GeroVaultError(code, e.detail ? `${e.code}: ${e.detail}` : e.code);
  if (e instanceof GeroVaultError) return new GeroVaultError(code, `${e.code}: ${e.message}`);
  return e;
}

function normalizeOrThrow(m: VaultManifest): VaultManifest {
  try {
    return normalize(m);
  } catch (e) {
    throw asGeroVaultError(e, 'INVALID_MANIFEST');
  }
}

// ---------------------------------------------------------------------------------------------
// Encoding and hashes

const bytes = (hex: string | undefined): Uint8Array => (hex ? hexToBytes(hex) : EMPTY);

function keysWritable(k: VaultPublicKeys | undefined): CborWritableMap {
  return k ? { payment: bytes(k.payment), stake: bytes(k.stake) } : {};
}

const proofWritable = (a: OwnerAttestation | undefined): CborWritableMap => (a ? { method: a.method, proof: bytes(a.proof) } : {});

function bindingBodyWritable(d: DeviceBindingBody): CborWritableMap {
  return {
    vaultId: bytes(d.vaultId),
    role: d.role,
    credential: bytes(d.credential),
    vaultKeys: keysWritable(d.vaultKeys),
    deviceId: bytes(d.deviceId),
    ed25519Pub: bytes(d.ed25519Pub),
    x25519Pub: bytes(d.x25519Pub),
    label: d.label,
    bindingVersion: d.bindingVersion,
  };
}

function bindingWritable(d: OwnerDeviceBinding): CborWritableMap {
  return {
    ...bindingBodyWritable(d),
    deviceSig: bytes(d.deviceSig),
    attestation: proofWritable(d.attestation),
    admittedBy: d.admittedBy ? { deviceId: bytes(d.admittedBy.deviceId), signature: bytes(d.admittedBy.signature) } : {},
  };
}

function tombstoneWritable(t: DeviceTombstone): CborWritableMap {
  return { deviceId: bytes(t.deviceId), ed25519Pub: bytes(t.ed25519Pub), bindingVersion: t.bindingVersion, removal: proofWritable(t.removal) };
}

function externalBodyWritable(e: ExternalEntryBody): CborWritableMap {
  return { credential: bytes(e.credential), vaultKeys: keysWritable(e.vaultKeys), label: e.label, role: e.role };
}

function manifestWritable(m: VaultManifest): CborWritableMap {
  const participant = (e: ParticipantEntry): CborWritableMap => ({
    credential: bytes(e.credential),
    vaultKeys: keysWritable(e.vaultKeys),
    devices: e.devices.map(bindingWritable),
    removedDevices: e.removedDevices.map(tombstoneWritable),
  });
  return {
    protocol: m.protocol,
    schema: m.schema,
    network: WIRE_NETWORK[m.network],
    vaultId: bytes(m.vaultId),
    paymentScript: bytes(m.paymentScript),
    stakeScript: bytes(m.stakeScript),
    roles: {
      owners: m.roles.owners.map(participant),
      backupHolders: m.roles.backupHolders.map(participant),
      guardians: m.roles.guardians.map(participant),
      delegates: m.roles.delegates.map(participant),
      viewers: m.roles.viewers.map(e => ({ credential: EMPTY, vaultKeys: {}, devices: e.devices.map(bindingWritable), removedDevices: [] })),
      external: m.roles.external.map(e => ({ ...externalBodyWritable(e), importSig: proofWritable(e.importSig) })),
    },
    viewersSeeProposalContents: m.viewersSeeProposalContents,
    policiesDisplay: {},
    version: m.version,
    prevManifestHash: bytes(m.prevManifestHash),
    revisedAt: m.revisedAt,
  };
}

/** blake2b-256( UTF-8 tag || bytes ), hex. */
export function taggedHash(tag: string, data: Uint8Array): string {
  const t = new TextEncoder().encode(tag);
  const preimage = new Uint8Array(t.length + data.length);
  preimage.set(t, 0);
  preimage.set(data, t.length);
  return bytesToHex(blake2b(preimage, { dkLen: 32 }));
}

/** Validates a manifest and returns it normalized. Throws `GeroVaultError('INVALID_MANIFEST')`. */
export function normalizeManifest(manifest: VaultManifest): VaultManifest {
  return normalizeOrThrow(manifest);
}

/** The canonical CBOR of a manifest, hex. Throws `GeroVaultError('INVALID_MANIFEST')`. */
export function encodeManifest(manifest: VaultManifest): string {
  return bytesToHex(encodeCanonicalCbor(manifestWritable(normalizeOrThrow(manifest))));
}

/**
 * The manifest hash: `blake2b-256( "gero-vault/v1|manifest|" || canonical CBOR )`, hex. It is the
 * `<manifestHash>` of the signing subjects (spec 5.5) and the `prevManifestHash` of the next
 * revision.
 */
export function manifestHash(manifest: VaultManifest): string {
  return taggedHash(MANIFEST_HASH_TAG, hexToBytes(encodeManifest(manifest)));
}

/** The manifest's scripts, decoded. Throws `GeroVaultError('INVALID_MANIFEST')`. */
export function manifestScripts(manifest: VaultManifest): { readonly payment: VaultScript; readonly stake: VaultScript } {
  const m = normalizeOrThrow(manifest);
  return Object.freeze(decodeScripts(m.paymentScript, m.stakeScript));
}

/** The template, threshold and backup terms, read from the scripts. */
export function manifestTemplate(manifest: VaultManifest): VaultTemplate {
  const { payment, stake } = manifestScripts(manifest);
  return templateOf(parseVaultScript(payment.script), parseVaultScript(stake.script));
}

/**
 * Whether each script lists its owner keys and its backup keys sorted by bytes, as `scripts.ts`
 * writes a new vault. Another wallet may order keys differently; the same keys in another order
 * are another address and another vault id.
 */
export function scriptsHaveCanonicalKeyOrder(scripts: Pick<VaultScripts, 'payment' | 'stake'>): boolean {
  const sorted = (list: readonly string[]) => list.every((h, i) => i === 0 || list[i - 1] < h);
  return [scripts?.payment, scripts?.stake].every(s => {
    const parsed = s?.script ? parseVaultScript(s.script) : undefined;
    return Boolean(parsed) && sorted(parsed.owners) && sorted(backupsOf(parsed));
  });
}

// ---------------------------------------------------------------------------------------------
// Device bindings, removals, viewer admission and external import

export interface DeviceBindingInput {
  readonly vaultId: string;
  readonly role: ManifestRole;
  /** The participant's vault keys; omitted for a viewer. The credential is their payment key hash. */
  readonly vaultKeys?: VaultPublicKeys;
  readonly ed25519Pub: string;
  readonly x25519Pub: string;
  /** Written with the write rule of `labels.ts`. */
  readonly label: string;
  /** Defaults to 1. A changed binding of a device must carry a higher one (`manifestCheck.ts`). */
  readonly bindingVersion?: number;
}

/** Builds a binding body (credential and device id computed). Throws `GeroVaultError('INVALID_DEVICE_BINDING')`. */
export function deviceBinding(input: DeviceBindingInput): DeviceBindingBody {
  try {
    const keys = input?.vaultKeys;
    return checkBindingBody({
      vaultId: input?.vaultId,
      role: input?.role,
      ...(keys ? { vaultKeys: keys, credential: isHex(keys.payment, 32) ? keyHashOf(keys.payment) : undefined } : {}),
      deviceId: isHex(input?.ed25519Pub, 32) ? deviceIdHex(input.ed25519Pub) : '',
      ed25519Pub: input?.ed25519Pub,
      x25519Pub: input?.x25519Pub,
      label: writtenLabel(input?.label, 'A device label'),
      bindingVersion: input?.bindingVersion ?? 1,
    });
  } catch (e) {
    throw asGeroVaultError(e, 'INVALID_DEVICE_BINDING');
  }
}

function bodyBytes(binding: DeviceBindingBody): Uint8Array {
  let body: DeviceBindingBody;
  try {
    body = checkBindingBody(binding);
  } catch (e) {
    throw asGeroVaultError(e, 'INVALID_DEVICE_BINDING');
  }
  return encodeCanonicalCbor(bindingBodyWritable(body));
}

/** The canonical CBOR of a binding body, hex. Any `deviceSig`, attestation or `admittedBy` is ignored. */
export function deviceBindingCbor(binding: DeviceBindingBody): string {
  return bytesToHex(bodyBytes(binding));
}

/**
 * The binding digest an owner attestation signs (spec 5.3):
 * `blake2b-256( "gero-vault/v1|binding|" || canonical CBOR of the binding body )`, hex.
 */
export function bindingDigest(binding: DeviceBindingBody): string {
  return taggedHash(BINDING_DIGEST_TAG, bodyBytes(binding));
}

/** What `deviceSig` signs: `blake2b-256( "gero-vault/v1|binding-device|" || binding body CBOR )`, hex. */
export function bindingDeviceDigest(binding: DeviceBindingBody): string {
  return taggedHash(BINDING_DEVICE_TAG, bodyBytes(binding));
}

/** What an owner device signs to admit a viewer: `blake2b-256( "gero-vault/v1|viewer-admission|" || binding digest )`, hex. */
export function viewerAdmissionDigest(binding: DeviceBindingBody): string {
  return taggedHash(VIEWER_ADMISSION_TAG, hexToBytes(bindingDigest(binding)));
}

/** Whether `deviceSig` is the device key's signature over the device digest. Never throws. */
export async function verifyDeviceSignature(binding: OwnerDeviceBinding): Promise<boolean> {
  try {
    if (!isHex(binding?.deviceSig, 64)) return false;
    return await verifyEd25519(hexToBytes(binding.ed25519Pub), hexToBytes(binding.deviceSig), hexToBytes(bindingDeviceDigest(binding)));
  } catch {
    return false;
  }
}

/**
 * What a participant's vault payment key signs to remove one of their devices (spec 5.3):
 * `blake2b-256( "gero-vault/v1|device-removal|" || CBOR of { vaultId, deviceId, bindingVersion } )`,
 * the binding version of the binding removed. No revision is named, so the removal stays valid
 * when another revision is accepted first. Throws `GeroVaultError('INVALID_DEVICE_BINDING')`.
 */
export function deviceRemovalDigest(vaultId: string, removed: { readonly deviceId: string; readonly bindingVersion: number }): string {
  if (!isHex(vaultId, 32) || !isHex(removed?.deviceId, 16) || !isInt(removed?.bindingVersion, 1, MAX_VERSION)) {
    throw new GeroVaultError('INVALID_DEVICE_BINDING', 'A removal names a vault id, a device id and a binding version');
  }
  return taggedHash(DEVICE_REMOVAL_TAG, encodeCanonicalCbor({
    vaultId: bytes(vaultId),
    deviceId: bytes(removed.deviceId),
    bindingVersion: removed.bindingVersion,
  }));
}

/** The tombstone a removal leaves: the binding's device id, key and version, and the removal attestation. */
export function deviceTombstone(binding: DeviceBindingBody, removal: OwnerAttestation): DeviceTombstone {
  try {
    const body = checkBindingBody(binding);
    const [tombstone] = checkTombstones([{ deviceId: body.deviceId, ed25519Pub: body.ed25519Pub, bindingVersion: body.bindingVersion, removal }]);
    return tombstone;
  } catch (e) {
    throw asGeroVaultError(e, 'INVALID_DEVICE_BINDING');
  }
}

/** An external entry before its import signature; the credential is computed. */
export interface ExternalEntryInput {
  readonly vaultKeys: VaultPublicKeys;
  /** Written with the write rule of `labels.ts`. */
  readonly label: string;
  readonly role: ExternalRole;
}

/** Builds an external entry body. Throws `GeroVaultError('INVALID_MANIFEST')`. */
export function externalEntry(input: ExternalEntryInput): ExternalEntryBody {
  try {
    const keys = input?.vaultKeys;
    return checkExternalBody({
      credential: isHex(keys?.payment, 32) ? keyHashOf(keys.payment) : undefined,
      vaultKeys: keys,
      label: writtenLabel(input?.label, 'An external label'),
      role: input?.role,
    });
  } catch (e) {
    throw asGeroVaultError(e, 'INVALID_MANIFEST');
  }
}

/**
 * What the importing owner's vault payment key attests (`importSig`):
 * `blake2b-256( "gero-vault/v1|external-import|" || CBOR of { vaultId, credential, vaultKeys, role, label } )`.
 */
export function externalImportDigest(vaultId: string, entry: ExternalEntryBody): string {
  let body: ExternalEntryBody;
  try {
    if (!isHex(vaultId, 32)) fault('FIELD_INVALID', 'vaultId');
    body = checkExternalBody(entry);
  } catch (e) {
    throw asGeroVaultError(e, 'INVALID_MANIFEST');
  }
  return taggedHash(EXTERNAL_IMPORT_TAG, encodeCanonicalCbor({ vaultId: bytes(vaultId), ...externalBodyWritable(body) }));
}

// ---------------------------------------------------------------------------------------------
// Standing of a device

function allBindings(m: VaultManifest): OwnerDeviceBinding[] {
  return [...m.roles.owners, ...m.roles.backupHolders, ...m.roles.viewers].flatMap(e => e.devices);
}

function lapsedIn(m: VaultManifest): Set<string> {
  const live = new Set(m.roles.owners.flatMap(e => e.devices.map(d => d.deviceId)));
  return new Set(m.roles.viewers.flatMap(v => v.devices).filter(d => !live.has(d.admittedBy.deviceId)).map(d => d.deviceId));
}

/** The viewer devices whose admission lapsed: the owner device that admitted them was removed. Throws for an invalid manifest. */
export function lapsedAdmissions(manifest: VaultManifest): readonly string[] {
  return Object.freeze([...lapsedIn(normalizeOrThrow(manifest))].sort());
}

export type DeviceStanding =
  | { readonly status: 'bound'; readonly binding: OwnerDeviceBinding }
  | { readonly status: 'lapsed'; readonly binding: OwnerDeviceBinding }
  | { readonly status: 'removed' }
  | { readonly status: 'unknown' };

/**
 * What a device key is to a manifest this device accepted (spec 5.3). A client takes frames only
 * from a `bound` device. A `removed` device (a tombstone, not bound again), a viewer whose
 * admission `lapsed` and an `unknown` key are refused. Throws for an invalid manifest.
 */
export function deviceStanding(manifest: VaultManifest, ed25519Pub: string): DeviceStanding {
  const m = normalizeOrThrow(manifest);
  if (!isHex(ed25519Pub, 32)) return Object.freeze({ status: 'unknown' });
  const binding = allBindings(m).find(b => b.ed25519Pub === ed25519Pub);
  if (binding) return Object.freeze({ status: lapsedIn(m).has(binding.deviceId) ? 'lapsed' : 'bound', binding });
  const id = deviceIdHex(ed25519Pub);
  const removed = [...m.roles.owners, ...m.roles.backupHolders].some(e => e.removedDevices.some(t => t.deviceId === id));
  return Object.freeze({ status: removed ? 'removed' : 'unknown' });
}

/**
 * The devices that receive content-key wraps: every bound device of an owner or a backup holder.
 * A removed device is never among them; phase 1 viewers get chain data only and no content keys.
 * Throws for an invalid manifest.
 */
export function keyWrapRecipients(manifest: VaultManifest): readonly OwnerDeviceBinding[] {
  const m = normalizeOrThrow(manifest);
  return Object.freeze([...m.roles.owners, ...m.roles.backupHolders].flatMap(e => e.devices));
}

// ---------------------------------------------------------------------------------------------
// Building a manifest and its revisions

/** An owner or backup holder of a new manifest: the vault keys they sent, and their devices. */
export interface ManifestParticipantInput {
  readonly vaultKeys: VaultPublicKeys;
  readonly devices?: readonly OwnerDeviceBinding[];
}

export interface NewManifestInput {
  /** The vault's scripts, carried in the manifest; they give the vault id and the template. */
  readonly vault: Pick<VaultScripts, 'payment' | 'stake'>;
  readonly network: VaultNetwork;
  readonly owners: readonly ManifestParticipantInput[];
  readonly backupHolders?: readonly ManifestParticipantInput[];
  readonly viewers?: readonly ViewerEntry[];
  /** Signed external entries (`externalEntry`, then `importSig` over `externalImportDigest`). */
  readonly external?: readonly ExternalEntry[];
  /** Unix seconds. */
  readonly revisedAt: number;
  /**
   * A vault whose scripts list keys in another order than `scripts.ts` writes (one rebuilt from
   * another wallet's registration) is refused unless this is set: the same keys in another order
   * are another address and another vault id.
   */
  readonly allowNonCanonicalKeyOrder?: boolean;
}

/** The first manifest (version 1) of a vault. Throws `GeroVaultError`. */
export function newManifest(input: NewManifestInput): VaultManifest {
  if (!input?.vault?.payment?.script || !input.vault.stake?.script) {
    throw new GeroVaultError('UNKNOWN_TEMPLATE', 'A manifest is made from a vault\'s scripts');
  }
  const id = scriptVaultId(input.vault, input.network);
  if (!input.allowNonCanonicalKeyOrder && !scriptsHaveCanonicalKeyOrder(input.vault)) {
    throw new GeroVaultError('INVALID_MANIFEST', 'NON_CANONICAL_KEY_ORDER: the scripts list keys in another order than this wallet writes');
  }
  const credentialOf = (k: VaultPublicKeys) => (isHex(k?.payment, 32) ? keyHashOf(k.payment) : undefined);
  const entry = (p: ManifestParticipantInput) => ({ credential: credentialOf(p?.vaultKeys), vaultKeys: p?.vaultKeys, devices: p?.devices ?? [], removedDevices: [] });
  return normalizeOrThrow({
    protocol: MANIFEST_PROTOCOL,
    schema: MANIFEST_SCHEMA,
    network: input.network,
    vaultId: id,
    paymentScript: input.vault.payment.cbor,
    stakeScript: input.vault.stake.cbor,
    roles: {
      owners: (input.owners ?? []).map(entry),
      backupHolders: (input.backupHolders ?? []).map(entry),
      guardians: [],
      delegates: [],
      viewers: input.viewers ?? [],
      external: input.external ?? [],
    },
    viewersSeeProposalContents: false,
    policiesDisplay: {},
    version: 1,
    revisedAt: input.revisedAt,
  });
}

export type ManifestRevisionRefusal =
  | 'INVALID_MANIFEST'
  | 'OTHER_VAULT'
  | 'VERSION_NOT_NEXT'
  | 'PREV_HASH_MISMATCH'
  | 'PARTICIPANTS_CHANGED'
  | 'IMPORTER_CHANGED'
  | 'TIME_BACKWARDS'
  | 'TOMBSTONE_DROPPED'
  | 'REMOVAL_UNATTESTED'
  | 'TOMBSTONE_INVALID'
  | 'ADMITTED_BY_REMOVED_DEVICE'
  | 'AUTHORISATION_CHANGED';

export type ManifestRevisionCheck = { readonly ok: true } | { readonly ok: false; readonly code: ManifestRevisionRefusal };

function scriptParticipants(m: VaultManifest): string {
  const keys = (list: readonly ParticipantEntry[]) => list.map(e => `${e.credential}:${e.vaultKeys.payment}:${e.vaultKeys.stake}`);
  const external = m.roles.external.map(e => `${e.credential}:${e.vaultKeys.payment}:${e.vaultKeys.stake}:${e.role}`);
  return JSON.stringify([keys(m.roles.owners), keys(m.roles.backupHolders), external]);
}

const tombstoneKey = (t: DeviceTombstone) => JSON.stringify([t.deviceId, t.ed25519Pub, t.bindingVersion, t.removal.method, t.removal.proof]);
const authorisationOf = (d: OwnerDeviceBinding) =>
  JSON.stringify([d.deviceSig, d.attestation?.method, d.attestation?.proof, d.admittedBy?.deviceId, d.admittedBy?.signature]);
const externalBodyKey = (e: ExternalEntryBody) => JSON.stringify([e.credential, e.vaultKeys.payment, e.vaultKeys.stake, e.role, e.label]);

/** Removals and tombstones between two revisions with the same participants. */
function removalRefusal(a: VaultManifest, b: VaultManifest): ManifestRevisionRefusal | undefined {
  for (const slot of ['owners', 'backupHolders'] as const) {
    for (const before of a.roles[slot]) {
      const after = b.roles[slot].find(e => e.credential === before.credential);
      const kept = new Set(after.removedDevices.map(tombstoneKey));
      if (before.removedDevices.some(t => !kept.has(tombstoneKey(t)))) return 'TOMBSTONE_DROPPED';
      const old = new Set(before.removedDevices.map(tombstoneKey));
      const added = after.removedDevices.filter(t => !old.has(tombstoneKey(t)));
      const removed = before.devices.filter(d => !after.devices.some(x => x.deviceId === d.deviceId));
      if (removed.some(d => !added.some(t => t.deviceId === d.deviceId && t.bindingVersion === d.bindingVersion))) return 'REMOVAL_UNATTESTED';
      if (added.some(t => !removed.some(d => d.deviceId === t.deviceId && d.bindingVersion === t.bindingVersion))) return 'TOMBSTONE_INVALID';
    }
  }
  return undefined;
}

/** Authorisations of unchanged bodies, carried forward from `a` to `b`. */
function authorisationRefusal(a: VaultManifest, b: VaultManifest): ManifestRevisionRefusal | undefined {
  const live = new Set(b.roles.owners.flatMap(e => e.devices.map(d => d.deviceId)));
  const before = new Map(allBindings(a).map(d => [d.deviceId, d]));
  for (const d of allBindings(b)) {
    const p = before.get(d.deviceId);
    const unchangedBody = p !== undefined && bindingDigest(p) === bindingDigest(d);
    // A removed device admits nothing new: a lapsed admission is only ever carried forward.
    if (d.role === 'viewer' && !live.has(d.admittedBy.deviceId) && !(unchangedBody && authorisationOf(p) === authorisationOf(d))) {
      return 'ADMITTED_BY_REMOVED_DEVICE';
    }
    if (!unchangedBody || authorisationOf(p) === authorisationOf(d)) continue;
    // The one exception: a viewer whose admission lapsed, admitted again by a bound owner device.
    const readmitted = d.role === 'viewer' && d.deviceSig === p.deviceSig && !live.has(p.admittedBy.deviceId);
    if (!readmitted) return 'AUTHORISATION_CHANGED';
  }
  const owners = new Set<string>(b.roles.owners.map(e => e.credential));
  for (const e of b.roles.external) {
    const p = a.roles.external.find(x => x.credential === e.credential);
    if (!p || externalBodyKey(p) !== externalBodyKey(e)) continue;
    if (p.importSig.method === e.importSig.method && p.importSig.proof === e.importSig.proof) continue;
    // A remaining owner imports again when the importer has left the owners slot.
    if (!owners.has(p.importedBy)) continue;
    return 'AUTHORISATION_CHANGED';
  }
  return undefined;
}

/**
 * Whether `next` is the next revision of `prev` (spec 5.3). Never throws. It must have:
 * - the same vault and scripts, `version` one higher, `prevManifestHash` the hash of `prev`, and
 *   `revisedAt` not earlier;
 * - the same script participants with the same vault keys (a phase 1 vault's keys never change;
 *   new owners make a new vault), and the same importer for each external cosigner unless that
 *   importer has left the owners slot;
 * - every tombstone of `prev`, and for each binding it removes from a participant, a new tombstone
 *   of that participant with the same device id and binding version (and no other new one);
 * - every authorisation (`deviceSig`, attestation, `admittedBy`, `importSig`) of a body it does
 *   not change carried forward byte for byte, so a relay holding two valid authorisations of one
 *   body cannot choose between them. A viewer whose admission lapsed may be admitted again by a
 *   bound owner device; a lapsed admission is otherwise only carried forward.
 * Which of the changes are authorised is `checkManifestBeforeAck`.
 */
export function checkManifestRevision(prev: VaultManifest, next: VaultManifest): ManifestRevisionCheck {
  let a: VaultManifest;
  let b: VaultManifest;
  let prevHash: string;
  try {
    a = normalize(prev);
    b = normalize(next);
    prevHash = manifestHash(a);
  } catch {
    return { ok: false, code: 'INVALID_MANIFEST' };
  }
  if (a.network !== b.network || a.vaultId !== b.vaultId || a.paymentScript !== b.paymentScript || a.stakeScript !== b.stakeScript) {
    return { ok: false, code: 'OTHER_VAULT' };
  }
  if (b.version !== a.version + 1) return { ok: false, code: 'VERSION_NOT_NEXT' };
  if (b.prevManifestHash !== prevHash) return { ok: false, code: 'PREV_HASH_MISMATCH' };
  if (scriptParticipants(a) !== scriptParticipants(b)) return { ok: false, code: 'PARTICIPANTS_CHANGED' };
  const owners = new Set<string>(b.roles.owners.map(e => e.credential));
  if (b.roles.external.some(e => {
    const importer = a.roles.external.find(x => x.credential === e.credential)?.importedBy;
    return importer !== e.importedBy && owners.has(importer);
  })) {
    return { ok: false, code: 'IMPORTER_CHANGED' };
  }
  if (b.revisedAt < a.revisedAt) return { ok: false, code: 'TIME_BACKWARDS' };
  const refusal = removalRefusal(a, b) ?? authorisationRefusal(a, b);
  return refusal ? { ok: false, code: refusal } : { ok: true };
}

/** The next revision of `prev`, with the role slots given replaced. Throws `GeroVaultError`. */
export function nextManifestRevision(
  prev: VaultManifest,
  change: { readonly roles: Partial<ManifestRoles>; /** Unix seconds. */ readonly revisedAt: number },
): VaultManifest {
  const base = normalizeOrThrow(prev);
  const next = normalizeOrThrow({
    ...base,
    roles: { ...base.roles, ...change?.roles },
    version: base.version + 1,
    prevManifestHash: manifestHash(base),
    revisedAt: change?.revisedAt,
  });
  const link = checkManifestRevision(base, next);
  if (link.ok === false) throw new GeroVaultError('INVALID_MANIFEST', link.code);
  return next;
}

/**
 * The next revision of `prev` with one device removed by its own participant: the binding dropped
 * and its tombstone kept, with `removal`, that participant's attestation over
 * `deviceRemovalDigest`. Viewers it admitted keep their bindings, their admission lapsed. Throws
 * `GeroVaultError`.
 */
export function nextRevisionRemovingDevice(
  prev: VaultManifest,
  change: { readonly deviceId: string; readonly removal: OwnerAttestation; /** Unix seconds. */ readonly revisedAt: number },
): VaultManifest {
  const base = normalizeOrThrow(prev);
  const holds = (e: ParticipantEntry) => e.devices.some(d => d.deviceId === change?.deviceId);
  const slot = (['owners', 'backupHolders'] as const).find(s => base.roles[s].some(holds));
  if (!slot) throw new GeroVaultError('INVALID_DEVICE_BINDING', 'The device is not bound to an owner or a backup holder of the manifest');
  const entries = base.roles[slot].map(e => {
    const binding = e.devices.find(d => d.deviceId === change.deviceId);
    if (!binding) return e;
    return { ...e, devices: e.devices.filter(d => d !== binding), removedDevices: [...e.removedDevices, deviceTombstone(binding, change.removal)] };
  });
  return nextManifestRevision(base, { roles: { [slot]: entries }, revisedAt: change.revisedAt });
}

/**
 * Two revisions of one vault with the same `version` and different contents are a fork (spec
 * 5.3): the client refuses both and alerts every owner. Never throws; an invalid manifest is not
 * a fork of anything, it is refused on its own.
 */
export function isManifestFork(a: VaultManifest, b: VaultManifest): boolean {
  try {
    const x = normalize(a);
    const y = normalize(b);
    return x.network === y.network && x.vaultId === y.vaultId && x.version === y.version && manifestHash(x) !== manifestHash(y);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Decoding untrusted manifests

type Value = CborValueOf<CborBoolean>;
type Item = CborItemOf<CborBoolean>;

const TOP_KEYS = [
  'protocol', 'schema', 'network', 'vaultId', 'paymentScript', 'stakeScript', 'roles',
  'viewersSeeProposalContents', 'policiesDisplay', 'version', 'prevManifestHash', 'revisedAt',
] as const;
const ENTRY_KEYS = ['credential', 'vaultKeys', 'devices', 'removedDevices'] as const;
const EXTERNAL_KEYS = ['credential', 'vaultKeys', 'label', 'role', 'importSig'] as const;
const TOMBSTONE_KEYS = ['deviceId', 'ed25519Pub', 'bindingVersion', 'removal'] as const;
const BINDING_KEYS = [
  'vaultId', 'role', 'credential', 'vaultKeys', 'deviceId', 'ed25519Pub', 'x25519Pub', 'label', 'bindingVersion',
  'deviceSig', 'attestation', 'admittedBy',
] as const;

type Fields = Readonly<Record<string, Value>>;

/** The fields of a map that has exactly `keys`, all text. */
function fields(v: Value, keys: readonly string[], what: string): Fields {
  if (v.type !== 'map') return fault('SCHEMA_INVALID', `${what} is not a map`);
  const out: Record<string, Value> = {};
  for (const [k, value] of v.value) {
    if (k.value.type !== 'text' || !keys.includes(k.value.value)) fault('SCHEMA_INVALID', `${what} has an unknown field`);
    out[(k.value as { value: string }).value] = value.value;
  }
  if (Object.keys(out).length !== keys.length) fault('SCHEMA_INVALID', `${what} misses a field`);
  return out;
}

function text(v: Value, what: string): string {
  return v.type === 'text' ? v.value : fault('SCHEMA_INVALID', `${what} is not text`);
}

function uint(v: Value, what: string): number {
  return v.type === 'int' && v.value >= 0n && v.value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(v.value)
    : fault('SCHEMA_INVALID', `${what} is not an unsigned integer`);
}

function byteString(v: Value, lengths: readonly number[] | undefined, what: string): string {
  if (v.type !== 'bytes') return fault('SCHEMA_INVALID', `${what} is not bytes`);
  if (lengths && !lengths.includes(v.value.length)) fault('FIELD_INVALID', `${what} has the wrong length`);
  return bytesToHex(v.value);
}

function list(v: Value, max: number, what: string): readonly Item[] {
  if (v.type !== 'array') return fault('SCHEMA_INVALID', `${what} is not an array`);
  if (v.value.length > max) fault('TOO_MANY_ENTRIES', what);
  return v.value;
}

function keysFrom(v: Value, what: string): VaultPublicKeys {
  const k = fields(v, ['payment', 'stake'], what);
  try {
    return vaultKeysOf(byteString(k['payment'], [32], 'payment key'), byteString(k['stake'], [32], 'stake key'));
  } catch (e) {
    if (e instanceof GeroVaultError) fault('FIELD_INVALID', what);
    throw e;
  }
}

function emptyMap(v: Value, what: string): boolean {
  if (v.type !== 'map') return fault('SCHEMA_INVALID', `${what} is not a map`);
  return v.value.length === 0;
}

function attestationFrom(v: Value, what: string, code: ManifestRefusalCode): OwnerAttestation {
  const a = fields(v, ['method', 'proof'], what);
  const proof = a['proof'];
  if (proof.type === 'bytes' && proof.value.length > MAX_ATTESTATION_BYTES) fault(code, `${what} proof too large`);
  return { method: uint(a['method'], `${what} method`), proof: byteString(proof, undefined, `${what} proof`) };
}

function bindingFrom(v: Value): OwnerDeviceBinding {
  const f = fields(v, BINDING_KEYS, 'binding');
  const attestation = emptyMap(f['attestation'], 'attestation') ? undefined : attestationFrom(f['attestation'], 'attestation', 'ATTESTATION_INVALID');
  let admittedBy: ViewerAdmission | undefined;
  if (!emptyMap(f['admittedBy'], 'admittedBy')) {
    const a = fields(f['admittedBy'], ['deviceId', 'signature'], 'admittedBy');
    admittedBy = { deviceId: byteString(a['deviceId'], [16], 'admittedBy deviceId'), signature: byteString(a['signature'], [64], 'admittedBy signature') };
  }
  const credential = byteString(f['credential'], [0, 28], 'binding credential');
  const keyed = !emptyMap(f['vaultKeys'], 'binding vaultKeys');
  return {
    vaultId: byteString(f['vaultId'], [32], 'binding vaultId'),
    role: text(f['role'], 'role') as ManifestRole,
    ...(credential ? { credential: Ed25519KeyHashHex(credential) } : {}),
    ...(keyed ? { vaultKeys: keysFrom(f['vaultKeys'], 'binding vaultKeys') } : {}),
    deviceId: byteString(f['deviceId'], [16], 'deviceId'),
    ed25519Pub: byteString(f['ed25519Pub'], [32], 'ed25519Pub'),
    x25519Pub: byteString(f['x25519Pub'], [32], 'x25519Pub'),
    label: text(f['label'], 'device label'),
    bindingVersion: uint(f['bindingVersion'], 'bindingVersion'),
    deviceSig: byteString(f['deviceSig'], [64], 'deviceSig'),
    ...(attestation ? { attestation } : {}),
    ...(admittedBy ? { admittedBy } : {}),
  };
}

function devicesFrom(v: Value): OwnerDeviceBinding[] {
  return list(v, MAX_DEVICES_PER_ENTRY, 'devices').map(i => bindingFrom(i.value));
}

function tombstoneFrom(v: Value): DeviceTombstone {
  const f = fields(v, TOMBSTONE_KEYS, 'tombstone');
  return {
    deviceId: byteString(f['deviceId'], [16], 'tombstone deviceId'),
    ed25519Pub: byteString(f['ed25519Pub'], [32], 'tombstone ed25519Pub'),
    bindingVersion: uint(f['bindingVersion'], 'tombstone bindingVersion'),
    removal: attestationFrom(f['removal'], 'removal', 'TOMBSTONE_INVALID'),
  };
}

function participantFrom(v: Value): ParticipantEntry {
  const f = fields(v, ENTRY_KEYS, 'participant');
  return {
    credential: Ed25519KeyHashHex(byteString(f['credential'], [28], 'credential')),
    vaultKeys: keysFrom(f['vaultKeys'], 'vaultKeys'),
    devices: devicesFrom(f['devices']),
    removedDevices: list(f['removedDevices'], MAX_REMOVED_DEVICES, 'removedDevices').map(i => tombstoneFrom(i.value)),
  };
}

function viewerFrom(v: Value): ViewerEntry {
  const f = fields(v, ENTRY_KEYS, 'viewer');
  byteString(f['credential'], [0], 'a viewer credential');
  if (!emptyMap(f['vaultKeys'], 'viewer vaultKeys')) fault('FIELD_INVALID', 'a viewer has no vault keys');
  if (list(f['removedDevices'], MAX_REMOVED_DEVICES, 'removedDevices').length > 0) fault('FIELD_INVALID', 'a viewer has no tombstones');
  return { devices: devicesFrom(f['devices']) };
}

function externalFrom(v: Value): ExternalEntry {
  const f = fields(v, EXTERNAL_KEYS, 'external');
  return {
    credential: Ed25519KeyHashHex(byteString(f['credential'], [28], 'external credential')),
    vaultKeys: keysFrom(f['vaultKeys'], 'external vaultKeys'),
    label: text(f['label'], 'external label'),
    role: text(f['role'], 'external role') as ExternalRole,
    importSig: attestationFrom(f['importSig'], 'importSig', 'IMPORTER_INVALID'),
  };
}

function networkFromWire(wire: string): VaultNetwork {
  const found = (Object.keys(WIRE_NETWORK) as VaultNetwork[]).find(n => WIRE_NETWORK[n] === wire);
  return found ?? fault('UNKNOWN_NETWORK');
}

function manifestFrom(root: Value): VaultManifest {
  const f = fields(root, TOP_KEYS, 'manifest');
  if (text(f['protocol'], 'protocol') !== MANIFEST_PROTOCOL) fault('UNSUPPORTED_PROTOCOL');
  if (uint(f['schema'], 'schema') !== MANIFEST_SCHEMA) fault('UNSUPPORTED_SCHEMA');
  const network = networkFromWire(text(f['network'], 'network'));
  const r = fields(f['roles'], SLOTS, 'roles');
  if (list(r['guardians'], MAX_SCRIPT_PARTICIPANTS, 'guardians').length > 0
    || list(r['delegates'], MAX_SCRIPT_PARTICIPANTS, 'delegates').length > 0) {
    fault('NOT_IN_PHASE_1', 'guardians and delegates arrive with Plutus vaults');
  }
  const flag = f['viewersSeeProposalContents'];
  if (flag.type !== 'bool') fault('SCHEMA_INVALID', 'viewersSeeProposalContents is a boolean');
  if (!emptyMap(f['policiesDisplay'], 'policiesDisplay')) fault('NOT_IN_PHASE_1', 'no policies in phase 1');
  const prev = byteString(f['prevManifestHash'], [0, 32], 'prevManifestHash');
  return {
    protocol: MANIFEST_PROTOCOL,
    schema: MANIFEST_SCHEMA,
    network,
    vaultId: byteString(f['vaultId'], [32], 'vaultId'),
    paymentScript: byteString(f['paymentScript'], undefined, 'paymentScript'),
    stakeScript: byteString(f['stakeScript'], undefined, 'stakeScript'),
    roles: {
      owners: list(r['owners'], MAX_OWNERS, 'owners').map(i => participantFrom(i.value)),
      backupHolders: list(r['backupHolders'], MAX_BACKUP_KEYS, 'backupHolders').map(i => participantFrom(i.value)),
      guardians: [],
      delegates: [],
      viewers: list(r['viewers'], MAX_VIEWERS, 'viewers').map(i => viewerFrom(i.value)),
      external: list(r['external'], MAX_SCRIPT_PARTICIPANTS, 'external').map(i => externalFrom(i.value)),
    },
    viewersSeeProposalContents: (flag as { value: boolean }).value,
    policiesDisplay: {},
    version: uint(f['version'], 'version'),
    ...(prev ? { prevManifestHash: prev } : {}),
    revisedAt: uint(f['revisedAt'], 'revisedAt'),
  };
}

const LOWER_HEX = /^(?:[0-9a-f]{2})*$/;

/**
 * Decodes an untrusted manifest: its canonical CBOR, as lowercase hex or bytes. The bytes must be
 * exactly the canonical encoding of a valid manifest (one manifest, one encoding, proofs in their
 * stored form), so the hash returned is the hash of what was received. Signatures are not
 * verified here (`checkManifestBeforeAck`). Never throws: anything else is a typed refusal.
 */
export function decodeManifest(input: string | Uint8Array): DecodeManifestResult {
  try {
    let raw: Uint8Array;
    if (typeof input === 'string') {
      if (input.length > MAX_MANIFEST_BYTES * 2) fault('TOO_LARGE');
      if (!LOWER_HEX.test(input)) fault('MALFORMED_INPUT', 'not lowercase hex');
      raw = hexToBytes(input);
    } else if (input instanceof Uint8Array) {
      if (input.length > MAX_MANIFEST_BYTES) fault('TOO_LARGE');
      raw = Uint8Array.from(input);
    } else {
      return fault('MALFORMED_INPUT', 'not hex or bytes');
    }
    let root: Item;
    try {
      root = readCbor(raw, CBOR_LIMITS);
    } catch (e) {
      if (e instanceof CborError) fault(e.reason === 'TOO_MANY_ITEMS' ? 'TOO_LARGE' : 'MALFORMED_CBOR', e.reason);
      throw e;
    }
    const manifest = normalize(manifestFrom(root.value));
    const cbor = bytesToHex(encodeCanonicalCbor(manifestWritable(manifest)));
    if (cbor !== bytesToHex(raw)) fault('NOT_CANONICAL');
    return { ok: true, manifest, cbor, hash: taggedHash(MANIFEST_HASH_TAG, raw) };
  } catch (e) {
    if (e instanceof Fault) return { ok: false, code: e.code, ...(e.detail ? { detail: e.detail } : {}) };
    return { ok: false, code: 'MALFORMED_INPUT', detail: 'unexpected input' };
  }
}

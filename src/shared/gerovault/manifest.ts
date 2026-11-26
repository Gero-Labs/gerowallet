/**
 * The vault manifest of `gero-vault/v1` (spec 5.2, 5.3; GV-60 #1728).
 *
 * The chain is the source of truth for who controls a vault (its scripts, registered under
 * CIP-0146). The manifest is the device and notification layer that must agree with it: every
 * role slot, the vault keys each participant contributed, and the devices bound to them. It is
 * hashed over its canonical CBOR encoding, which is also its wire format (spec 5.2).
 *
 *   VaultManifest {
 *     protocol         "gero-vault/v1"
 *     network          "cardano-mainnet" | "cardano-preprod" | "cardano-preview"
 *     vaultId          bytes 32, the script-derived identifier of `vaultId.ts`
 *     scriptHash       bytes 28, payment script
 *     stakeScriptHash  bytes 28, stake script
 *     threshold        uint, the owner threshold of the scripts
 *     roles {          every slot present, empty where unused
 *       owners, backupHolders, guardians, delegates, viewers: [RoleEntry]
 *       external: [{ credential: bytes 28, label: text }]   cosigners with no Gero device
 *     }
 *     viewersSeeProposalContents  uint 0 or 1
 *     policiesDisplay  map
 *     version          uint, 1 for the first manifest of a vault
 *     prevManifestHash bytes 0 for version 1, else bytes 32: the hash of the previous revision
 *     createdAt        uint, unix seconds when this revision was made
 *   }
 *   RoleEntry {
 *     credential       bytes 28, the payment key hash the participant contributed; bytes 0 for a viewer
 *     vaultKeys        { payment: bytes 32, stake: bytes 32 }, raw Ed25519; {} for a viewer
 *     devices          [OwnerDeviceBinding]
 *   }
 *   OwnerDeviceBinding {
 *     vaultId, role ("owner" | "backupHolder" | "guardian" | "delegate" | "viewer"), credential,
 *     deviceId         bytes 16, sha256(ed25519Pub)[0:16]
 *     ed25519Pub       bytes 32, the device's signing key
 *     x25519Pub        bytes 32, the device's separate, random, static key agreement key
 *     label            text
 *     bindingVersion   uint >= 1
 *     attestation      { method: "cip8" | "expiredTx", proof: bytes }; {} for a viewer
 *   }
 *
 * No field carries a vault index: indexes are local to each participant (spec 4.0). Lists are
 * sorted (participants and external entries by credential, devices by device id, viewers by their
 * first device id), so one manifest has exactly one encoding.
 *
 * Phase 1 (native vaults) fixes some fields: `guardians` and `delegates` are empty (guardian
 * recovery and delegates arrive with Plutus vaults), `viewersSeeProposalContents` is 0 and
 * `policiesDisplay` is empty (spec 5.3, 6.5).
 *
 * What this module does not do: verify attestations, count attestations for a revision, or decide
 * which revision wins. Those are GV-22 (#1690). The pre-acknowledge check is `manifestCheck.ts`.
 *
 * PROVISIONAL: field encodings, the hash tag and the test vectors are not frozen until they are
 * checked against the other clients' vectors (GV-07 #1675).
 */
import { Ed25519KeyHashHex, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32 } from 'bech32';
import { CborError, CborItem, CborValue, bytesToHex, hexToBytes, readCbor } from './cbor';
import { CborWritableMap, encodeCanonicalCbor } from './canonicalCbor';
import { GeroVaultError } from './errors';
import { BECH32_PREFIX, parseVaultPublicKeys } from './keys';
import { MAX_BACKUP_KEYS, MAX_OWNERS, MIN_THRESHOLD, parseVaultScript } from './scripts';
import { VaultNetwork, VaultPublicKeys, VaultScripts } from './types';
import { vaultId as scriptVaultId } from './vaultId';

export const MANIFEST_PROTOCOL = 'gero-vault/v1';
/** Domain tag of the manifest hash, as UTF-8 before the canonical CBOR. */
export const MANIFEST_HASH_TAG = 'gero-vault/v1|manifest|';

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
export const MAX_ATTESTATION_BYTES = 2048;
export const MAX_LABEL_BYTES = 64;
/** Owners, backup holders and external cosigners together: every key of the two scripts. */
const MAX_SCRIPT_PARTICIPANTS = MAX_OWNERS + MAX_BACKUP_KEYS;
const MAX_VERSION = 0xffffffff;
/** Unix seconds; a value in milliseconds is out of range. */
const MAX_CREATED_AT = 99_999_999_999;
const CBOR_LIMITS = { maxDepth: 10, maxItems: 16384 };

export type ManifestRole = 'owner' | 'backupHolder' | 'guardian' | 'delegate' | 'viewer';
const ROLES: readonly ManifestRole[] = ['owner', 'backupHolder', 'guardian', 'delegate', 'viewer'];

/**
 * How a participant attests a device binding (spec 5.3): a CIP-8 `signData` with the payment key
 * they contributed (`cip8`), or a transaction that can never be submitted, signed at that key,
 * carrying the binding digest (`expiredTx`). `proof` holds the method's bytes as hex. This module
 * carries the proof and never verifies it (GV-22).
 */
export type AttestationMethod = 'cip8' | 'expiredTx';

export interface OwnerAttestation {
  readonly method: AttestationMethod;
  readonly proof: string;
}

/** A device binding without its attestation: what the attestation signs (`bindingDigest`). */
export interface DeviceBindingBody {
  readonly vaultId: string;
  readonly role: ManifestRole;
  /** The participant's payment key hash; absent for a viewer. */
  readonly credential?: Ed25519KeyHashHex;
  readonly deviceId: string;
  readonly ed25519Pub: string;
  readonly x25519Pub: string;
  readonly label: string;
  readonly bindingVersion: number;
}

export interface OwnerDeviceBinding extends DeviceBindingBody {
  /** Required for every role with a script key; absent for a viewer. */
  readonly attestation?: OwnerAttestation;
}

/** An owner, backup holder, guardian or delegate. */
export interface ParticipantEntry {
  readonly credential: Ed25519KeyHashHex;
  readonly vaultKeys: VaultPublicKeys;
  readonly devices: readonly OwnerDeviceBinding[];
}

/** A viewer has no script key, only devices (at least one). */
export interface ViewerEntry {
  readonly devices: readonly OwnerDeviceBinding[];
}

/** A cosigner with no Gero device: a credential and a label, nothing else (spec 5.3). */
export interface ExternalEntry {
  readonly credential: Ed25519KeyHashHex;
  readonly label: string;
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
  readonly network: VaultNetwork;
  readonly vaultId: string;
  readonly scriptHash: Hash28ByteBase16;
  readonly stakeScriptHash: Hash28ByteBase16;
  readonly threshold: number;
  readonly roles: ManifestRoles;
  /** Always false in phase 1. */
  readonly viewersSeeProposalContents: boolean;
  /** Always empty in phase 1. */
  readonly policiesDisplay: Readonly<Record<string, never>>;
  readonly version: number;
  /** Absent for version 1. */
  readonly prevManifestHash?: string;
  /** Unix seconds. */
  readonly createdAt: number;
}

export type ManifestRefusalCode =
  | 'MALFORMED_INPUT'
  | 'TOO_LARGE'
  | 'MALFORMED_CBOR'
  | 'NOT_CANONICAL'
  | 'SCHEMA_INVALID'
  | 'UNSUPPORTED_PROTOCOL'
  | 'UNKNOWN_NETWORK'
  | 'FIELD_INVALID'
  | 'LABEL_INVALID'
  | 'THRESHOLD_INVALID'
  | 'VERSION_INVALID'
  | 'NOT_IN_PHASE_1'
  | 'TOO_MANY_ENTRIES'
  | 'CREDENTIAL_MISMATCH'
  | 'DUPLICATE_PARTICIPANT'
  | 'DUPLICATE_DEVICE'
  | 'BINDING_MISMATCH'
  | 'DEVICE_ID_MISMATCH'
  | 'ATTESTATION_INVALID';

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

const HEX_LENGTH: Readonly<Record<number, RegExp>> = { 16: /^[0-9a-f]{32}$/, 28: /^[0-9a-f]{56}$/, 32: /^[0-9a-f]{64}$/ };
const HEX_BYTES = /^(?:[0-9a-f]{2})+$/;
/** Separators, control characters, bidirectional controls and lone surrogates. */
const FORBIDDEN_IN_LABEL = /[|\p{Cc}؜‎‏‪-‮⁦-⁩\ud800-\udfff]/u;
const EMPTY = new Uint8Array(0);

function isHex(value: unknown, bytes: 16 | 28 | 32): value is string {
  return typeof value === 'string' && HEX_LENGTH[bytes].test(value);
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function checkLabel(label: unknown, what: string): string {
  if (typeof label !== 'string' || label.length === 0) return fault('LABEL_INVALID', `${what} is a non-empty string`);
  if (FORBIDDEN_IN_LABEL.test(label)) fault('LABEL_INVALID', `${what} has a forbidden character`);
  if (new TextEncoder().encode(label).length > MAX_LABEL_BYTES) fault('LABEL_INVALID', `${what} is at most ${MAX_LABEL_BYTES} bytes`);
  return label;
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
  if (viewer ? Boolean(b.credential) : !isHex(b.credential, 28)) fault('FIELD_INVALID', 'binding credential');
  if (!isHex(b.ed25519Pub, 32) || !isHex(b.x25519Pub, 32)) fault('FIELD_INVALID', 'device keys');
  if (b.ed25519Pub === b.x25519Pub) fault('FIELD_INVALID', 'the X25519 key is the Ed25519 key');
  if (b.deviceId !== deviceIdHex(b.ed25519Pub)) fault('DEVICE_ID_MISMATCH');
  checkLabel(b.label, 'A device label');
  if (!isInt(b.bindingVersion, 1, MAX_VERSION)) fault('FIELD_INVALID', 'bindingVersion');
  return Object.freeze({
    vaultId: b.vaultId,
    role: b.role,
    ...(viewer ? {} : { credential: b.credential }),
    deviceId: b.deviceId,
    ed25519Pub: b.ed25519Pub,
    x25519Pub: b.x25519Pub,
    label: b.label,
    bindingVersion: b.bindingVersion,
  });
}

function checkAttestation(role: ManifestRole, a: OwnerAttestation | undefined): OwnerAttestation | undefined {
  if (role === 'viewer') {
    if (a !== undefined && a !== null) fault('ATTESTATION_INVALID', 'a viewer binding carries no attestation');
    return undefined;
  }
  if (!a || (a.method !== 'cip8' && a.method !== 'expiredTx')) return fault('ATTESTATION_INVALID', 'attestation method');
  if (typeof a.proof !== 'string' || !HEX_BYTES.test(a.proof) || a.proof.length > MAX_ATTESTATION_BYTES * 2) {
    fault('ATTESTATION_INVALID', 'attestation proof');
  }
  return Object.freeze({ method: a.method, proof: a.proof });
}

interface BindingContext {
  readonly vaultId: string;
  readonly role: ManifestRole;
  readonly credential?: string;
}

function checkDevices(list: readonly OwnerDeviceBinding[], ctx: BindingContext, min: number): readonly OwnerDeviceBinding[] {
  if (!Array.isArray(list)) return fault('SCHEMA_INVALID', 'devices');
  if (list.length > MAX_DEVICES_PER_ENTRY) fault('TOO_MANY_ENTRIES', 'devices of one participant');
  if (list.length < min) fault('FIELD_INVALID', 'a viewer has at least one device');
  const out = list.map(b => {
    const body = checkBindingBody(b);
    if (body.vaultId !== ctx.vaultId || body.role !== ctx.role || body.credential !== ctx.credential) fault('BINDING_MISMATCH');
    const attestation = checkAttestation(body.role, b.attestation);
    return Object.freeze(attestation ? { ...body, attestation } : { ...body });
  });
  return Object.freeze(out.sort((a, b) => byText(a.deviceId, b.deviceId)));
}

function checkParticipant(e: ParticipantEntry, role: ManifestRole, vaultId: string): ParticipantEntry {
  if (!e || typeof e !== 'object') return fault('SCHEMA_INVALID', 'participant');
  const k = e.vaultKeys;
  if (k?.level !== 'vault' || !isHex(k.payment, 32) || !isHex(k.stake, 32) || k.payment === k.stake) {
    fault('FIELD_INVALID', 'vaultKeys');
  }
  const credential = keyHashOf(k.payment);
  if (e.credential !== credential) fault('CREDENTIAL_MISMATCH');
  return Object.freeze({
    credential,
    vaultKeys: vaultKeysOf(k.payment, k.stake),
    devices: checkDevices(e.devices, { vaultId, role, credential }, 0),
  });
}

function checkViewer(e: ViewerEntry, vaultId: string): ViewerEntry {
  if (!e || typeof e !== 'object') return fault('SCHEMA_INVALID', 'viewer');
  const keyed = e as { credential?: unknown; vaultKeys?: unknown };
  if (keyed.credential || keyed.vaultKeys) fault('FIELD_INVALID', 'a viewer has no script key');
  return Object.freeze({ devices: checkDevices(e.devices, { vaultId, role: 'viewer' }, 1) });
}

function checkExternal(e: ExternalEntry): ExternalEntry {
  if (!e || typeof e !== 'object' || !isHex(e.credential, 28)) return fault('FIELD_INVALID', 'external credential');
  return Object.freeze({ credential: e.credential, label: checkLabel(e.label, 'An external label') });
}

const SLOTS = ['owners', 'backupHolders', 'guardians', 'delegates', 'viewers', 'external'] as const;

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** Validates a manifest and returns it normalized: sorted lists, frozen. Throws `Fault`. */
function normalize(m: VaultManifest): VaultManifest {
  if (!m || typeof m !== 'object') return fault('SCHEMA_INVALID', 'not a manifest');
  if (m.protocol !== MANIFEST_PROTOCOL) fault('UNSUPPORTED_PROTOCOL');
  if (!Object.prototype.hasOwnProperty.call(WIRE_NETWORK, m.network)) fault('UNKNOWN_NETWORK');
  if (!isHex(m.vaultId, 32)) fault('FIELD_INVALID', 'vaultId');
  if (!isHex(m.scriptHash, 28) || !isHex(m.stakeScriptHash, 28)) fault('FIELD_INVALID', 'script hash');
  if (m.scriptHash === m.stakeScriptHash) fault('FIELD_INVALID', 'the payment and stake scripts are one script');
  if (!isInt(m.version, 1, MAX_VERSION)) fault('VERSION_INVALID', 'version');
  if (m.version === 1 ? Boolean(m.prevManifestHash) : !isHex(m.prevManifestHash, 32)) {
    fault('VERSION_INVALID', 'only version 1 has no previous manifest');
  }
  if (!isInt(m.createdAt, 0, MAX_CREATED_AT)) fault('FIELD_INVALID', 'createdAt is unix seconds');
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
  const owners = r.owners.map(e => checkParticipant(e, 'owner', m.vaultId)).sort((a, b) => byText(a.credential, b.credential));
  const backupHolders = r.backupHolders.map(e => checkParticipant(e, 'backupHolder', m.vaultId))
    .sort((a, b) => byText(a.credential, b.credential));
  const viewers = r.viewers.map(e => checkViewer(e, m.vaultId)).sort((a, b) => byText(a.devices[0].deviceId, b.devices[0].deviceId));
  const external = r.external.map(checkExternal).sort((a, b) => byText(a.credential, b.credential));

  // The owner threshold counts owners in the scripts: the owners slot plus any external owner.
  if (!isInt(m.threshold, MIN_THRESHOLD, Math.min(MAX_OWNERS, owners.length + external.length))) fault('THRESHOLD_INVALID');
  if (!unique([...owners, ...backupHolders, ...external].map(e => e.credential))) fault('DUPLICATE_PARTICIPANT', 'credential');
  if (!unique([...owners, ...backupHolders].flatMap(e => [e.vaultKeys.payment, e.vaultKeys.stake]))) {
    fault('DUPLICATE_PARTICIPANT', 'vault key');
  }
  const bindings = [...owners, ...backupHolders, ...viewers].flatMap(e => e.devices);
  if (bindings.length > MAX_BINDINGS) fault('TOO_MANY_ENTRIES', 'devices');
  if (!unique(bindings.map(b => b.deviceId)) || !unique(bindings.flatMap(b => [b.ed25519Pub, b.x25519Pub]))) {
    fault('DUPLICATE_DEVICE');
  }

  return Object.freeze({
    protocol: MANIFEST_PROTOCOL,
    network: m.network,
    vaultId: m.vaultId,
    scriptHash: m.scriptHash,
    stakeScriptHash: m.stakeScriptHash,
    threshold: m.threshold,
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
    createdAt: m.createdAt,
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
// Encoding

const bytes = (hex: string | undefined): Uint8Array => (hex ? hexToBytes(hex) : EMPTY);

function bindingBodyWritable(d: DeviceBindingBody): CborWritableMap {
  return {
    vaultId: bytes(d.vaultId),
    role: d.role,
    credential: bytes(d.credential),
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
    attestation: d.attestation ? { method: d.attestation.method, proof: bytes(d.attestation.proof) } : {},
  };
}

function manifestWritable(m: VaultManifest): CborWritableMap {
  const participant = (e: ParticipantEntry): CborWritableMap => ({
    credential: bytes(e.credential),
    vaultKeys: { payment: bytes(e.vaultKeys.payment), stake: bytes(e.vaultKeys.stake) },
    devices: e.devices.map(bindingWritable),
  });
  return {
    protocol: m.protocol,
    network: WIRE_NETWORK[m.network],
    vaultId: bytes(m.vaultId),
    scriptHash: bytes(m.scriptHash),
    stakeScriptHash: bytes(m.stakeScriptHash),
    threshold: m.threshold,
    roles: {
      owners: m.roles.owners.map(participant),
      backupHolders: m.roles.backupHolders.map(participant),
      guardians: m.roles.guardians.map(participant),
      delegates: m.roles.delegates.map(participant),
      viewers: m.roles.viewers.map(e => ({ credential: EMPTY, vaultKeys: {}, devices: e.devices.map(bindingWritable) })),
      external: m.roles.external.map(e => ({ credential: bytes(e.credential), label: e.label })),
    },
    viewersSeeProposalContents: m.viewersSeeProposalContents ? 1 : 0,
    policiesDisplay: {},
    version: m.version,
    prevManifestHash: bytes(m.prevManifestHash),
    createdAt: m.createdAt,
  };
}

function hashCbor(cbor: Uint8Array): string {
  const tag = new TextEncoder().encode(MANIFEST_HASH_TAG);
  const preimage = new Uint8Array(tag.length + cbor.length);
  preimage.set(tag, 0);
  preimage.set(cbor, tag.length);
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
 * The manifest hash, 32 bytes as lowercase hex:
 * `blake2b-256( "gero-vault/v1|manifest|" || canonical CBOR )`. It is the `<manifestHash>` of the
 * signing subjects (spec 5.5), the `prevManifestHash` of the next revision and the value the
 * in-person QR carries (`safetyCode.ts`).
 */
export function manifestHash(manifest: VaultManifest): string {
  return hashCbor(hexToBytes(encodeManifest(manifest)));
}

// ---------------------------------------------------------------------------------------------
// Device bindings

export interface DeviceBindingInput {
  readonly vaultId: string;
  readonly role: ManifestRole;
  /** The payment key hash the participant contributed; omitted for a viewer. */
  readonly credential?: Ed25519KeyHashHex;
  readonly ed25519Pub: string;
  readonly x25519Pub: string;
  readonly label: string;
  /** Defaults to 1. */
  readonly bindingVersion?: number;
}

/** Builds a binding body (device id computed). Throws `GeroVaultError('INVALID_DEVICE_BINDING')`. */
export function deviceBinding(input: DeviceBindingInput): DeviceBindingBody {
  try {
    return checkBindingBody({
      vaultId: input?.vaultId,
      role: input?.role,
      credential: input?.credential,
      deviceId: isHex(input?.ed25519Pub, 32) ? deviceIdHex(input.ed25519Pub) : '',
      ed25519Pub: input?.ed25519Pub,
      x25519Pub: input?.x25519Pub,
      label: input?.label,
      bindingVersion: input?.bindingVersion ?? 1,
    });
  } catch (e) {
    throw asGeroVaultError(e, 'INVALID_DEVICE_BINDING');
  }
}

/** The canonical CBOR of a binding without its attestation, hex. Any attestation is ignored. */
export function deviceBindingCbor(binding: DeviceBindingBody): string {
  let body: DeviceBindingBody;
  try {
    body = checkBindingBody(binding);
  } catch (e) {
    throw asGeroVaultError(e, 'INVALID_DEVICE_BINDING');
  }
  return bytesToHex(encodeCanonicalCbor(bindingBodyWritable(body)));
}

/**
 * The digest an owner attestation signs (spec 5.3): `blake2b-256( canonical CBOR of the binding
 * without attestation )`, 32 bytes as hex. Spec 5.3 gives this construction without a domain
 * tag; the binding is a map with text keys, so its bytes are never a transaction body. Carrying it
 * in a CIP-8 payload or in the auxiliary data of an expired transaction is GV-22 (#1690).
 */
export function bindingDigest(binding: DeviceBindingBody): string {
  return bytesToHex(blake2b(hexToBytes(deviceBindingCbor(binding)), { dkLen: 32 }));
}

// ---------------------------------------------------------------------------------------------
// Building a manifest and its revisions

/** An owner or backup holder of a new manifest: the vault keys they sent, and their devices. */
export interface ManifestParticipantInput {
  readonly vaultKeys: VaultPublicKeys;
  readonly devices?: readonly OwnerDeviceBinding[];
}

export interface NewManifestInput {
  /** The vault's scripts: they give the vault id, the script hashes and the threshold. */
  readonly vault: Pick<VaultScripts, 'payment' | 'stake'>;
  readonly network: VaultNetwork;
  readonly owners: readonly ManifestParticipantInput[];
  readonly backupHolders?: readonly ManifestParticipantInput[];
  readonly viewers?: readonly ViewerEntry[];
  readonly external?: readonly ExternalEntry[];
  /** Unix seconds. */
  readonly createdAt: number;
}

/**
 * The first manifest (version 1) of a vault. It checks the manifest's own rules only; that the
 * participants are the scripts' keys is `checkManifestBeforeAck`, which the creator can run too.
 * Throws `GeroVaultError`.
 */
export function newManifest(input: NewManifestInput): VaultManifest {
  const parsed = input?.vault?.payment?.script ? parseVaultScript(input.vault.payment.script) : undefined;
  if (!parsed) throw new GeroVaultError('UNKNOWN_TEMPLATE', 'A manifest is made from a vault template\'s scripts');
  const id = scriptVaultId(input.vault, input.network);
  const entry = (p: ManifestParticipantInput) => ({
    credential: isHex(p?.vaultKeys?.payment, 32) ? keyHashOf(p.vaultKeys.payment) : undefined,
    vaultKeys: p?.vaultKeys,
    devices: p?.devices ?? [],
  });
  return normalizeOrThrow({
    protocol: MANIFEST_PROTOCOL,
    network: input.network,
    vaultId: id,
    scriptHash: input.vault.payment.hash,
    stakeScriptHash: input.vault.stake?.hash,
    threshold: parsed.threshold,
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
    createdAt: input.createdAt,
  });
}

export type ManifestRevisionRefusal = 'INVALID_MANIFEST' | 'OTHER_VAULT' | 'VERSION_NOT_NEXT' | 'PREV_HASH_MISMATCH' | 'PARTICIPANTS_CHANGED';

export type ManifestRevisionCheck = { readonly ok: true } | { readonly ok: false; readonly code: ManifestRevisionRefusal };

function scriptParticipants(m: VaultManifest): string {
  const keys = (list: readonly ParticipantEntry[]) => list.map(e => `${e.credential}:${e.vaultKeys.payment}:${e.vaultKeys.stake}`);
  return JSON.stringify([keys(m.roles.owners), keys(m.roles.backupHolders), m.roles.external.map(e => e.credential)]);
}

/**
 * Whether `next` is the next revision of `prev` (spec 5.3): the same vault, `version` one higher,
 * `prevManifestHash` the hash of `prev`, and the same script participants with the same vault
 * keys (a phase 1 vault's keys never change; new owners make a new vault). Devices, viewers and
 * labels may change. Whether the revision carries the attestations it needs is GV-22. Never throws.
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
  if (a.network !== b.network || a.vaultId !== b.vaultId || a.scriptHash !== b.scriptHash
    || a.stakeScriptHash !== b.stakeScriptHash || a.threshold !== b.threshold) {
    return { ok: false, code: 'OTHER_VAULT' };
  }
  if (b.version !== a.version + 1) return { ok: false, code: 'VERSION_NOT_NEXT' };
  if (b.prevManifestHash !== prevHash) return { ok: false, code: 'PREV_HASH_MISMATCH' };
  if (scriptParticipants(a) !== scriptParticipants(b)) return { ok: false, code: 'PARTICIPANTS_CHANGED' };
  return { ok: true };
}

/** The next revision of `prev`, with the role slots given replaced. Throws `GeroVaultError`. */
export function nextManifestRevision(
  prev: VaultManifest,
  change: { readonly roles: Partial<ManifestRoles>; /** Unix seconds. */ readonly createdAt: number },
): VaultManifest {
  const base = normalizeOrThrow(prev);
  const next = normalizeOrThrow({
    ...base,
    roles: { ...base.roles, ...change?.roles },
    version: base.version + 1,
    prevManifestHash: manifestHash(base),
    createdAt: change?.createdAt,
  });
  const link = checkManifestRevision(base, next);
  if (link.ok === false) throw new GeroVaultError('INVALID_MANIFEST', link.code);
  return next;
}

/**
 * Two revisions of one vault with the same `version` and different contents are a fork (spec
 * 5.3 names the case of different `prevManifestHash`; two different children of one parent are
 * the other case). The client refuses both and alerts. Never throws; an invalid manifest is not a
 * fork of anything, it is refused on its own.
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

const TOP_KEYS = [
  'protocol', 'network', 'vaultId', 'scriptHash', 'stakeScriptHash', 'threshold', 'roles',
  'viewersSeeProposalContents', 'policiesDisplay', 'version', 'prevManifestHash', 'createdAt',
] as const;
const ENTRY_KEYS = ['credential', 'vaultKeys', 'devices'] as const;
const BINDING_KEYS = ['vaultId', 'role', 'credential', 'deviceId', 'ed25519Pub', 'x25519Pub', 'label', 'bindingVersion', 'attestation'] as const;

type Fields = Readonly<Record<string, CborValue>>;

/** The fields of a map that has exactly `keys`, all text. */
function fields(v: CborValue, keys: readonly string[], what: string): Fields {
  if (v.type !== 'map') return fault('SCHEMA_INVALID', `${what} is not a map`);
  const out: Record<string, CborValue> = {};
  for (const [k, value] of v.value) {
    if (k.value.type !== 'text' || !keys.includes(k.value.value)) fault('SCHEMA_INVALID', `${what} has an unknown field`);
    out[(k.value as { value: string }).value] = value.value;
  }
  if (Object.keys(out).length !== keys.length) fault('SCHEMA_INVALID', `${what} misses a field`);
  return out;
}

function text(v: CborValue, what: string): string {
  return v.type === 'text' ? v.value : fault('SCHEMA_INVALID', `${what} is not text`);
}

function uint(v: CborValue, what: string): number {
  return v.type === 'int' && v.value >= 0n && v.value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(v.value)
    : fault('SCHEMA_INVALID', `${what} is not an unsigned integer`);
}

function byteString(v: CborValue, lengths: readonly number[], what: string): string {
  if (v.type !== 'bytes') return fault('SCHEMA_INVALID', `${what} is not bytes`);
  if (!lengths.includes(v.value.length)) fault('FIELD_INVALID', `${what} has the wrong length`);
  return bytesToHex(v.value);
}

function list(v: CborValue, max: number, what: string): readonly CborItem[] {
  if (v.type !== 'array') return fault('SCHEMA_INVALID', `${what} is not an array`);
  if (v.value.length > max) fault('TOO_MANY_ENTRIES', what);
  return v.value;
}

function bindingFrom(v: CborValue): OwnerDeviceBinding {
  const f = fields(v, BINDING_KEYS, 'binding');
  const att = f['attestation'];
  if (att.type !== 'map') fault('SCHEMA_INVALID', 'attestation is not a map');
  let attestation: OwnerAttestation | undefined;
  if (att.type === 'map' && att.value.length > 0) {
    const a = fields(att, ['method', 'proof'], 'attestation');
    const proof = a['proof'];
    if (proof.type !== 'bytes') fault('SCHEMA_INVALID', 'attestation proof is not bytes');
    if (proof.type === 'bytes' && proof.value.length > MAX_ATTESTATION_BYTES) fault('ATTESTATION_INVALID', 'attestation proof too large');
    attestation = { method: text(a['method'], 'attestation method') as AttestationMethod, proof: bytesToHex((proof as { value: Uint8Array }).value) };
  }
  const credential = byteString(f['credential'], [0, 28], 'binding credential');
  return {
    vaultId: byteString(f['vaultId'], [32], 'binding vaultId'),
    role: text(f['role'], 'role') as ManifestRole,
    ...(credential ? { credential: Ed25519KeyHashHex(credential) } : {}),
    deviceId: byteString(f['deviceId'], [16], 'deviceId'),
    ed25519Pub: byteString(f['ed25519Pub'], [32], 'ed25519Pub'),
    x25519Pub: byteString(f['x25519Pub'], [32], 'x25519Pub'),
    label: text(f['label'], 'device label'),
    bindingVersion: uint(f['bindingVersion'], 'bindingVersion'),
    ...(attestation ? { attestation } : {}),
  };
}

function devicesFrom(v: CborValue): OwnerDeviceBinding[] {
  return list(v, MAX_DEVICES_PER_ENTRY, 'devices').map(i => bindingFrom(i.value));
}

function participantFrom(v: CborValue): ParticipantEntry {
  const f = fields(v, ENTRY_KEYS, 'participant');
  const credential = byteString(f['credential'], [28], 'credential');
  const k = fields(f['vaultKeys'], ['payment', 'stake'], 'vaultKeys');
  let vaultKeys: VaultPublicKeys;
  try {
    vaultKeys = vaultKeysOf(byteString(k['payment'], [32], 'payment key'), byteString(k['stake'], [32], 'stake key'));
  } catch (e) {
    if (e instanceof GeroVaultError) fault('FIELD_INVALID', 'vaultKeys');
    throw e;
  }
  return { credential: Ed25519KeyHashHex(credential), vaultKeys, devices: devicesFrom(f['devices']) };
}

function viewerFrom(v: CborValue): ViewerEntry {
  const f = fields(v, ENTRY_KEYS, 'viewer');
  byteString(f['credential'], [0], 'a viewer credential');
  const keys = f['vaultKeys'];
  if (keys.type !== 'map' || keys.value.length > 0) fault('FIELD_INVALID', 'a viewer has no vault keys');
  return { devices: devicesFrom(f['devices']) };
}

function externalFrom(v: CborValue): ExternalEntry {
  const f = fields(v, ['credential', 'label'], 'external');
  return { credential: Ed25519KeyHashHex(byteString(f['credential'], [28], 'external credential')), label: text(f['label'], 'external label') };
}

function networkFromWire(wire: string): VaultNetwork {
  const found = (Object.keys(WIRE_NETWORK) as VaultNetwork[]).find(n => WIRE_NETWORK[n] === wire);
  return found ?? fault('UNKNOWN_NETWORK');
}

function manifestFrom(root: CborValue): VaultManifest {
  const f = fields(root, TOP_KEYS, 'manifest');
  if (text(f['protocol'], 'protocol') !== MANIFEST_PROTOCOL) fault('UNSUPPORTED_PROTOCOL');
  const network = networkFromWire(text(f['network'], 'network'));
  const r = fields(f['roles'], SLOTS, 'roles');
  if (list(r['guardians'], MAX_SCRIPT_PARTICIPANTS, 'guardians').length > 0
    || list(r['delegates'], MAX_SCRIPT_PARTICIPANTS, 'delegates').length > 0) {
    fault('NOT_IN_PHASE_1', 'guardians and delegates arrive with Plutus vaults');
  }
  const flag = uint(f['viewersSeeProposalContents'], 'viewersSeeProposalContents');
  if (flag > 1) fault('SCHEMA_INVALID', 'viewersSeeProposalContents is 0 or 1');
  const policies = f['policiesDisplay'];
  if (policies.type !== 'map') fault('SCHEMA_INVALID', 'policiesDisplay is not a map');
  if (policies.type === 'map' && policies.value.length > 0) fault('NOT_IN_PHASE_1', 'no policies in phase 1');
  const prev = byteString(f['prevManifestHash'], [0, 32], 'prevManifestHash');
  return {
    protocol: MANIFEST_PROTOCOL,
    network,
    vaultId: byteString(f['vaultId'], [32], 'vaultId'),
    scriptHash: Hash28ByteBase16(byteString(f['scriptHash'], [28], 'scriptHash')),
    stakeScriptHash: Hash28ByteBase16(byteString(f['stakeScriptHash'], [28], 'stakeScriptHash')),
    threshold: uint(f['threshold'], 'threshold'),
    roles: {
      owners: list(r['owners'], MAX_OWNERS, 'owners').map(i => participantFrom(i.value)),
      backupHolders: list(r['backupHolders'], MAX_BACKUP_KEYS, 'backupHolders').map(i => participantFrom(i.value)),
      guardians: [],
      delegates: [],
      viewers: list(r['viewers'], MAX_VIEWERS, 'viewers').map(i => viewerFrom(i.value)),
      external: list(r['external'], MAX_SCRIPT_PARTICIPANTS, 'external').map(i => externalFrom(i.value)),
    },
    viewersSeeProposalContents: flag === 1,
    policiesDisplay: {},
    version: uint(f['version'], 'version'),
    ...(prev ? { prevManifestHash: prev } : {}),
    createdAt: uint(f['createdAt'], 'createdAt'),
  };
}

/**
 * Decodes an untrusted manifest: its canonical CBOR, as hex or bytes. The bytes must be exactly
 * the canonical encoding of a valid manifest (one manifest, one encoding), so the hash returned
 * is the hash of what was received. Never throws: anything else is a typed refusal.
 */
export function decodeManifest(input: string | Uint8Array): DecodeManifestResult {
  try {
    let raw: Uint8Array;
    if (typeof input === 'string') {
      if (input.length > MAX_MANIFEST_BYTES * 2) fault('TOO_LARGE');
      raw = hexToBytes(input) ?? fault('MALFORMED_INPUT', 'not hex');
    } else if (input instanceof Uint8Array) {
      raw = input;
    } else {
      return fault('MALFORMED_INPUT', 'not hex or bytes');
    }
    if (raw.length > MAX_MANIFEST_BYTES) fault('TOO_LARGE');
    let root: CborItem;
    try {
      root = readCbor(raw, CBOR_LIMITS);
    } catch (e) {
      if (e instanceof CborError) fault(e.reason === 'TOO_MANY_ITEMS' ? 'TOO_LARGE' : 'MALFORMED_CBOR', e.reason);
      throw e;
    }
    const manifest = normalize(manifestFrom(root.value));
    const cbor = bytesToHex(encodeCanonicalCbor(manifestWritable(manifest)));
    if (cbor !== bytesToHex(raw)) fault('NOT_CANONICAL');
    return { ok: true, manifest, cbor, hash: hashCbor(raw) };
  } catch (e) {
    if (e instanceof Fault) return { ok: false, code: e.code, ...(e.detail ? { detail: e.detail } : {}) };
    return { ok: false, code: 'MALFORMED_INPUT', detail: 'unexpected input' };
  }
}

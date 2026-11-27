/**
 * GeroVault on Midnight: the contract vaults one wallet holds, in that wallet's `midnightVaults`
 * table (`schema.ts`, version 13). Callers pass the wallet id of the phrase's secrets record, so
 * every account of one phrase sees one vault list and one index sequence.
 *
 * A table of its own beside the Cardano `vaults` table: its rows have no scripts, and the Cardano
 * store, its checks and the dApp signing guard (knownVaults.ts) never read them.
 *
 * Every write checks the whole record, so a screen never has to trust a row:
 * - the vault id is the one the network and the contract address give;
 * - the build is a pinned build allowed on the vault's network, and a test build is preprod only;
 * - the operations read from the contract carry exactly the build's verifier key fingerprints, with
 *   at most the build's deferred circuits missing, and the committee's threshold is at least 1;
 * - the lifecycle agrees with them: `ready` needs every operation and a committee past the
 *   deployer's interim key, and a vault cannot be accepted before that;
 * - the participants' keys are well formed, never twice in one vault, in slots the build has;
 * - this seed has exactly one entry per role it holds, each naming a participant of that role, and
 *   is never both an owner and a guardian;
 * - the agreed configuration names the build's manifest hash and keeps the build's recovery floors;
 * - every verification record names an owner and the agreed configuration's digest.
 *
 * The results of the operation and committee checks are computed here on every write, never taken
 * from the caller. What cannot be checked here: that this seed derives the keys at its indexes (that
 * needs the phrase), and anything only the chain knows (the import checks run before the store).
 * Point validity beyond the encoding (on the curve, in the prime-order subgroup) and the lift of an
 * upgrade key come from `keyProblem`, which the caller passes.
 *
 * Every failure is a `MidnightVaultStoreError`, and a database that cannot be read throws, never
 * answers "no vaults".
 */
import { blake2b } from '@noble/hashes/blake2.js';
import type Dexie from 'dexie';
import type { Table } from 'dexie';
import { getDb } from '@/db/wallet-db';
import { bytesToHex, hexToBytes } from '@/shared/gerovault/cbor';
import { readLabel } from '@/shared/gerovault/labels';

// -------------------------------------------------------------------------------------------------
// Types

/** The Midnight networks a vault can name. The pinned builds decide which of them are open. */
export type MidnightVaultNetwork = 'preprod' | 'preview' | 'mainnet';

/** The two pinned builds: test delays (preprod only) and the production floors. */
export type MidnightBuildProfile = 'test' | 'production';

/**
 * `candidate`: quarantined. Shown for review, never funded from this wallet, never signed for.
 * `accepted`: the user accepted the vault on this device.
 */
export type MidnightVaultStatus = 'candidate' | 'accepted';

export type MidnightVaultOrigin = 'created' | 'imported' | 'restored';

/**
 * `deploying`: built on this device, not complete on chain yet. `incomplete`: on chain, with a
 * deferred operation missing or the deployer's interim committee. `ready`: complete. `temporary`:
 * recovered, the move to a new vault pending. `moved`: the funds moved to `successor`, still watched.
 */
export type MidnightVaultLifecycle = 'deploying' | 'incomplete' | 'ready' | 'temporary' | 'moved';

export type MidnightVaultRole = 'owner' | 'guardian' | 'delegate';

/** One pinned build, from the vendored build manifest. */
export interface PinnedMidnightBuild {
  /** `gvmn-<profile>-<16 hex>`. */
  readonly id: string;
  readonly profile: MidnightBuildProfile;
  /** The networks the pin allows. A test build is refused off preprod whatever this says. */
  readonly networks: readonly MidnightVaultNetwork[];
  /** Hash of the pinned build manifest, 32 bytes of lowercase hex: the verification set's `buildHash`. */
  readonly manifestHash: string;
  readonly constants: {
    readonly ownerSlots: number;
    readonly guardianSlots: number;
    readonly delegateSlots: number;
    readonly whitelistEntries: number;
    readonly minRecoveryDelaySeconds: number;
    readonly expiryWindowSeconds: number;
    readonly cooldownSeconds: number;
  };
  /** Every circuit: its verifier key fingerprint (`verifierKeyHashOf`, lowercase hex) and whether a split deployment defers it. */
  readonly circuits: Readonly<Record<string, { readonly fingerprint: string; readonly deferred: boolean }>>;
}

export interface MidnightVaultBuildRef {
  readonly id: string;
  readonly profile: MidnightBuildProfile;
}

/**
 * Keys as stored: a Jubjub point is 64 bytes of lowercase hex (x then y, each a 32-byte
 * little-endian field element, the runtime's representation); an upgrade key is a BIP-340 x-only
 * key, 32 bytes of lowercase hex.
 */
export interface StoredMidnightOwner {
  /** The contract's owner slot. */
  readonly slot: number;
  readonly approvalKey: string;
  readonly upgradeKey: string;
  /** A claim from whoever named the participant, never proof. Show it only through `displayLabel`. */
  readonly label?: string;
}

export interface StoredMidnightGuardian {
  /** The guardian slot of the recovery configuration. */
  readonly slot: number;
  readonly key: string;
  /** 32 bytes of lowercase hex. Required on an owner's record: owners hold every guardian's salt. */
  readonly salt?: string;
  readonly label?: string;
}

export interface StoredMidnightDelegate {
  /** The policy's delegate slot. */
  readonly slot: number;
  readonly key: string;
  readonly label?: string;
}

/** Owner cards in slot order; guardian cards (with salts when this device is an owner); delegate cards. */
export interface MidnightVaultParticipants {
  readonly owners: readonly StoredMidnightOwner[];
  readonly guardians: readonly StoredMidnightGuardian[];
  readonly delegates: readonly StoredMidnightDelegate[];
}

/** One role this seed holds in the vault. */
export interface MidnightVaultSelf {
  readonly role: MidnightVaultRole;
  /** The hardened index `i` of `m/1854'/2400'/n'/r'/i'`, from 1. */
  readonly index: number;
  /** The participant slot of that role that holds this seed's key. */
  readonly slot: number;
}

export interface MidnightWhitelistEntry {
  /** A user address, 32 bytes of lowercase hex. */
  readonly recipient: string;
  readonly scope: 'quorumOnly' | 'any';
}

/** The verified configuration (the verification set without the record's own network and build). */
export interface MidnightVaultAgreedConfig {
  /** Digest of the verification set, 32 bytes of lowercase hex: what the verification number shows. */
  readonly digest: string;
  /** Must be the pinned build's `manifestHash`. */
  readonly buildHash: string;
  /** In slot order. */
  readonly owners: readonly { readonly approvalKey: string; readonly upgradeKey: string }[];
  readonly threshold: number;
  /** Seconds. */
  readonly changeDelay: number;
  readonly whitelist: { readonly enabled: boolean; readonly entries: readonly MidnightWhitelistEntry[] };
  /** Guardian commitments in slot order, 32 bytes of lowercase hex each. */
  readonly guardians: readonly string[];
  readonly guardianThreshold: number;
  /** Seconds. */
  readonly recoveryDelay: number;
  readonly cooldown: number;
  readonly expiryWindow: number;
}

/** How this device verified a co-owner. Kept on this device, never sent anywhere. */
export interface MidnightVaultVerification {
  readonly method: 'number' | 'qr';
  /** The co-owner's approval key. */
  readonly owner: string;
  /** The agreed configuration's digest the numbers came from. */
  readonly digest: string;
  /** Unix seconds. */
  readonly at: number;
}

export interface MidnightVaultDeployment {
  /** Transaction hashes, 32 bytes of lowercase hex, once built. */
  readonly deployTx: string | null;
  readonly completionTx: string | null;
  /** The circuits the deploy left for the completion update: the build's deferred set, or none. */
  readonly deferred: readonly string[];
}

/** The maintenance committee: BIP-340 x-only keys and a threshold. */
export interface MidnightVaultCommittee {
  readonly keys: readonly string[];
  readonly threshold: number;
}

/** A state read as the caller gives it. */
export interface MidnightVaultLastCheckInput {
  /** Where the state came from, lowercase (`deployment` for the transaction this device built). */
  readonly source: string;
  readonly blockHeight: number | null;
  /** 32 bytes of lowercase hex. */
  readonly blockHash: string | null;
  /** Milliseconds since the epoch. */
  readonly at: number;
  /** Every operation the contract has, by circuit name, with its verifier key fingerprint. */
  readonly operations: Readonly<Record<string, string>>;
  readonly committee: MidnightVaultCommittee;
  /** The contract's owner threshold. */
  readonly ownerThreshold: number;
}

/**
 * Computed by the store on every write.
 * - `operations`: `complete`, or `deferredMissing` when some of the build's deferred circuits are not there yet.
 * - `committee`: `owners` (the owners' upgrade keys at the owner threshold), `interim` (one owner's
 *   upgrade key alone at threshold 1, before the completion update), or `outOfStep` (anything else:
 *   after a recovery, expected; otherwise the drift flag, deposits blocked).
 */
export interface MidnightVaultCheckResults {
  readonly operations: 'complete' | 'deferredMissing';
  readonly committee: 'owners' | 'interim' | 'outOfStep';
}

/** The last state read, kept for display. */
export interface MidnightVaultLastCheck extends MidnightVaultLastCheckInput {
  readonly results: MidnightVaultCheckResults;
}

export interface MidnightVaultApproval {
  /** The signer's Jubjub key. */
  readonly signer: string;
  /** The approval file as received, JSON text. */
  readonly file: string;
}

/** An open request, kept across reloads: Midnight approvals live for days. */
export interface MidnightVaultRequestInput {
  /** The statement digest, 32 bytes of lowercase hex. */
  readonly id: string;
  /** The statement kind, as the request file names it. */
  readonly kind: string;
  /** Made on this device, or imported from a file. */
  readonly origin: 'made' | 'imported';
  /** The request file as saved, JSON text. */
  readonly file: string;
  /** When the statement expires, unix seconds. */
  readonly expiresAt: number;
  /** One per signer. */
  readonly approvals: readonly MidnightVaultApproval[];
}

export interface StoredMidnightVaultRequest extends MidnightVaultRequestInput {
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One vault of one wallet: a row of the `midnightVaults` table. */
export interface MidnightVaultRecord {
  readonly recordVersion: 1;
  /** `midnightVaultId(network, contractAddress)`, the table key. */
  readonly vaultId: string;
  readonly network: MidnightVaultNetwork;
  /** 32 bytes of lowercase hex. An identifier, not a payment address. */
  readonly contractAddress: string;
  readonly build: MidnightVaultBuildRef;
  readonly status: MidnightVaultStatus;
  readonly origin: MidnightVaultOrigin;
  readonly lifecycle: MidnightVaultLifecycle;
  /** A local name, read rule of `labels.ts`. Show it only through `displayLabel`. */
  readonly name?: string;
  readonly self: readonly MidnightVaultSelf[];
  /** The highest index this seed has allocated on this network, carried into the recovery package. */
  readonly highestIndex: number;
  readonly participants: MidnightVaultParticipants;
  readonly agreedConfig: MidnightVaultAgreedConfig | null;
  readonly verifications: readonly MidnightVaultVerification[];
  readonly deployment: MidnightVaultDeployment | null;
  readonly lastCheck: MidnightVaultLastCheck | null;
  readonly requests: readonly StoredMidnightVaultRequest[];
  /** The successor vault's id after a recovery's move. */
  readonly successor: string | null;
  /** Milliseconds since the epoch. `updatedAt` grows on every write. */
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly acceptedAt: number | null;
}

export interface MidnightVaultCandidateInput {
  /** Must equal `midnightVaultId(network, contractAddress)`; the store recomputes it. */
  readonly vaultId: string;
  readonly network: MidnightVaultNetwork;
  readonly contractAddress: string;
  readonly build: MidnightVaultBuildRef;
  readonly origin: MidnightVaultOrigin;
  readonly lifecycle: MidnightVaultLifecycle;
  readonly name?: string;
  readonly participants: MidnightVaultParticipants;
  readonly self: readonly MidnightVaultSelf[];
  readonly highestIndex: number;
  readonly agreedConfig?: MidnightVaultAgreedConfig | null;
  readonly verifications?: readonly MidnightVaultVerification[];
  readonly deployment?: MidnightVaultDeployment | null;
  readonly lastCheck?: MidnightVaultLastCheckInput | null;
  readonly successor?: string | null;
}

export interface MidnightVaultAcceptInput {
  /** The `updatedAt` of the record the user reviewed. A record changed since is not accepted. */
  readonly reviewedUpdatedAt: number;
}

/** What `update` may change. The identity, build, status, origin and creation time never change. */
export interface MidnightVaultRecordPatch {
  /** A new name; null removes it. */
  readonly name?: string | null;
  /** Participant labels by role and slot; a null label removes one. */
  readonly labels?: readonly { readonly role: MidnightVaultRole; readonly slot: number; readonly label: string | null }[];
  readonly lifecycle?: MidnightVaultLifecycle;
  /** Replaces every participant, after a change on chain. Pass `self` with it when this seed's slots move. */
  readonly participants?: MidnightVaultParticipants;
  readonly self?: readonly MidnightVaultSelf[];
  /** Only ever raised. */
  readonly highestIndex?: number;
  readonly agreedConfig?: MidnightVaultAgreedConfig | null;
  /** Replaces the stored verification records. */
  readonly verifications?: readonly MidnightVaultVerification[];
  readonly deployment?: MidnightVaultDeployment | null;
  readonly lastCheck?: MidnightVaultLastCheckInput | null;
  readonly successor?: string | null;
}

export interface MidnightVaultListFilter {
  readonly status?: MidnightVaultStatus;
  readonly network?: MidnightVaultNetwork;
  /** Only vaults where this seed holds the role (guardian mode lists `guardian`). */
  readonly role?: MidnightVaultRole;
}

/**
 * Codes of `MidnightVaultStoreError`.
 * - `STORE_UNAVAILABLE`: the wallet database could not be opened or read, or holds a row this version
 *   cannot read. Never treat it as "no vaults".
 * - `INVALID_INPUT`: a field is malformed.
 * - `INVALID_KEY`: a key is malformed, refused by `keyProblem`, or appears twice in one vault.
 * - `VAULT_ID_MISMATCH`: the vault id is not the one the network and contract address give.
 * - `UNKNOWN_BUILD`: the build id is not a pinned build of that profile.
 * - `TEST_BUILD_NETWORK`: a test build on a network other than preprod.
 * - `BUILD_NETWORK`: the pinned build does not allow this network.
 * - `BUILD_MISMATCH`: an operation's fingerprint, the deferred set, the manifest hash or a recovery
 *   constant is not the build's, or the contract lacks an operation the build always deploys.
 * - `COMMITTEE_MISMATCH`: the committee is malformed or its threshold is below 1.
 * - `SELF_MISMATCH`: this seed does not have exactly one entry per role it holds, an entry names no
 *   participant, or this seed is both an owner and a guardian.
 * - `LIFECYCLE_MISMATCH`: the lifecycle contradicts the state read, the origin, the successor, or the
 *   previous lifecycle.
 * - `VAULT_EXISTS`: this wallet already holds the vault.
 * - `NOT_FOUND`: this wallet does not hold the vault.
 * - `NOT_A_CANDIDATE`: `accept` on a vault already accepted.
 * - `NOT_ACCEPTED`: a request on a candidate, which is never signed for.
 * - `VAULT_INCOMPLETE`: `accept` before the vault is complete on chain.
 * - `STALE_REVIEW`: `accept` of a record that changed after the user reviewed it.
 */
export type MidnightVaultStoreErrorCode =
  | 'STORE_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'INVALID_KEY'
  | 'VAULT_ID_MISMATCH'
  | 'UNKNOWN_BUILD'
  | 'TEST_BUILD_NETWORK'
  | 'BUILD_NETWORK'
  | 'BUILD_MISMATCH'
  | 'COMMITTEE_MISMATCH'
  | 'SELF_MISMATCH'
  | 'LIFECYCLE_MISMATCH'
  | 'VAULT_EXISTS'
  | 'NOT_FOUND'
  | 'NOT_A_CANDIDATE'
  | 'NOT_ACCEPTED'
  | 'VAULT_INCOMPLETE'
  | 'STALE_REVIEW';

/**
 * Persistence of the Midnight vaults one wallet holds. Every call throws a `MidnightVaultStoreError`;
 * reads never answer empty when the database cannot be read.
 */
export interface MidnightVaultStore {
  /** The wallet's Midnight vaults, oldest first. */
  list(walletId: number, filter?: MidnightVaultListFilter): Promise<readonly MidnightVaultRecord[]>;
  get(walletId: number, vaultId: string): Promise<MidnightVaultRecord | undefined>;
  /** Checks the input and stores it as a candidate. Nothing partial is stored. */
  addCandidate(walletId: number, input: MidnightVaultCandidateInput): Promise<MidnightVaultRecord>;
  /** Moves a reviewed, complete candidate to accepted. Funding gates stay the caller's. */
  accept(walletId: number, vaultId: string, input: MidnightVaultAcceptInput): Promise<MidnightVaultRecord>;
  update(walletId: number, vaultId: string, patch: MidnightVaultRecordPatch): Promise<MidnightVaultRecord>;
  /** Adds a request to an accepted vault, or adds approvals to the stored request with its id. Never drops an approval. */
  putRequest(walletId: number, vaultId: string, request: MidnightVaultRequestInput): Promise<MidnightVaultRecord>;
  /** Removes a request; a request that is not there leaves the record as it is. */
  removeRequest(walletId: number, vaultId: string, requestId: string): Promise<MidnightVaultRecord>;
}

/** A key handed to `keyProblem`. */
export interface MidnightVaultKey {
  readonly kind: 'jubjub' | 'upgrade';
  readonly hex: string;
}

export interface MidnightVaultStoreOptions {
  /** The pinned builds a vault may name. With none, every write is refused. */
  readonly builds: readonly PinnedMidnightBuild[];
  /**
   * The full key check: null when the key is usable, otherwise the reason. It runs after the
   * store's own encoding checks, on every participant and agreed key (not on committee keys, which
   * are display only).
   */
  readonly keyProblem?: (key: MidnightVaultKey) => string | null;
  /** The wallet database; `getDb` unless a test passes another. */
  readonly openDatabase?: (walletId: number) => Promise<Dexie | null>;
}

export class MidnightVaultStoreError extends Error {
  readonly code: MidnightVaultStoreErrorCode;

  constructor(code: MidnightVaultStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MidnightVaultStoreError';
    this.code = code;
  }
}

// -------------------------------------------------------------------------------------------------
// The vault id

export const MIDNIGHT_VAULT_ID_TAG = 'gero-vault/v1|midnight-vault-id|';

const NETWORKS: readonly MidnightVaultNetwork[] = ['preprod', 'preview', 'mainnet'];
const HEX32 = /^[0-9a-f]{64}$/;

/** BLAKE2b-256 of the tag, the network id (UTF-8) and the 32-byte contract address, lowercase hex. */
export function midnightVaultId(network: MidnightVaultNetwork, contractAddress: string): string {
  if (!NETWORKS.includes(network)) invalid('A Midnight network is preprod, preview or mainnet');
  if (typeof contractAddress !== 'string' || !HEX32.test(contractAddress)) invalid('A contract address is 32 bytes of lowercase hex');
  const utf8 = new TextEncoder();
  const tag = utf8.encode(MIDNIGHT_VAULT_ID_TAG);
  const net = utf8.encode(network);
  const address = hexToBytes(contractAddress) as Uint8Array;
  const preimage = new Uint8Array(tag.length + net.length + address.length);
  preimage.set(tag, 0);
  preimage.set(net, tag.length);
  preimage.set(address, tag.length + net.length);
  return bytesToHex(blake2b(preimage, { dkLen: 32 }));
}

// -------------------------------------------------------------------------------------------------
// Checks

const TABLE = 'midnightVaults';
const JUBJUB_HEX = /^[0-9a-f]{128}$/;
const PROFILES: readonly string[] = ['test', 'production'];
const ORIGINS: readonly string[] = ['created', 'imported', 'restored'];
const LIFECYCLES: readonly string[] = ['deploying', 'incomplete', 'ready', 'temporary', 'moved'];
const ROLES: readonly MidnightVaultRole[] = ['owner', 'guardian', 'delegate'];
const VERIFICATION_METHODS: readonly string[] = ['number', 'qr'];
const REQUEST_ORIGINS: readonly string[] = ['made', 'imported'];
const SCOPES: readonly string[] = ['quorumOnly', 'any'];
/** Lifecycles a candidate can be accepted in: never before completion. */
const ACCEPTABLE: readonly MidnightVaultLifecycle[] = ['ready', 'temporary', 'moved'];
const PATCH_KEYS: readonly string[] = [
  'name', 'labels', 'lifecycle', 'participants', 'self', 'highestIndex',
  'agreedConfig', 'verifications', 'deployment', 'lastCheck', 'successor',
];
/** Only test builds have test delays, and only preprod takes them. */
const TEST_BUILD_ONLY_NETWORK: MidnightVaultNetwork = 'preprod';
const MAX_INDEX = 2 ** 31 - 1;
const MAX_COMMITTEE = 32;
const MAX_VERIFICATIONS = 64;
const MAX_REQUESTS = 32;
const MAX_REQUEST_FILE = 32 * 1024;
const MAX_APPROVAL_FILE = 8 * 1024;
const SOURCE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const KIND = /^[a-zA-Z][a-zA-Z0-9:-]{0,47}$/;
/** Jubjub's base field, the BLS12-381 scalar field: every coordinate is below it. */
const JUBJUB_BASE_FIELD = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
/** The secp256k1 base field: an x-only key is below it. */
const SECP256K1_FIELD = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
/** (0, 1), the identity, as x then y little-endian. The contract's empty slot; never a key. */
const JUBJUB_IDENTITY = '00'.repeat(32) + '01' + '00'.repeat(31);

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** A value shaped like `T` as far as its keys go, every field still to be checked. */
type Untrusted<T> = { readonly [K in keyof T]?: unknown };
type KeyCheck = (key: MidnightVaultKey) => string | null;

function fail(code: MidnightVaultStoreErrorCode, message: string): never {
  throw new MidnightVaultStoreError(code, message);
}

function invalid(message: string): never {
  return fail('INVALID_INPUT', message);
}

function isObject<T = object>(value: unknown): value is Untrusted<T> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function isUint(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isHex32(value: unknown): value is string {
  return typeof value === 'string' && HEX32.test(value);
}

function isIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_INDEX;
}

function littleEndian(hex: string): bigint {
  let reversed = '';
  for (let i = hex.length - 2; i >= 0; i -= 2) reversed += hex.slice(i, i + 2);
  return BigInt(`0x${reversed}`);
}

function readJubjubKey(value: unknown, what: string, keyProblem: KeyCheck | undefined): string {
  if (typeof value !== 'string' || !JUBJUB_HEX.test(value)) fail('INVALID_KEY', `The ${what} is not a Jubjub point (64 bytes of lowercase hex)`);
  if (littleEndian(value.slice(0, 64)) >= JUBJUB_BASE_FIELD || littleEndian(value.slice(64)) >= JUBJUB_BASE_FIELD) {
    fail('INVALID_KEY', `The ${what} has a coordinate outside the field`);
  }
  if (value === JUBJUB_IDENTITY) fail('INVALID_KEY', `The ${what} is the identity point`);
  if (keyProblem?.({ kind: 'jubjub', hex: value })) fail('INVALID_KEY', `The ${what} is not a usable key`);
  return value;
}

function readUpgradeKey(value: unknown, what: string, keyProblem: KeyCheck | undefined): string {
  if (!isHex32(value)) fail('INVALID_KEY', `The ${what} is not an x-only key (32 bytes of lowercase hex)`);
  const x = BigInt(`0x${value}`);
  if (x === 0n || x >= SECP256K1_FIELD) fail('INVALID_KEY', `The ${what} is outside the field`);
  if (keyProblem?.({ kind: 'upgrade', hex: value })) fail('INVALID_KEY', `The ${what} is not a usable key`);
  return value;
}

function optionalLabel(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined;
  const label = readLabel(value);
  if (label === undefined) invalid(`The ${what} is not a valid label`);
  return label;
}

function withLabel<T extends object>(entry: T, label: unknown, what: string): T & { label?: string } {
  const read = optionalLabel(label, what);
  return read === undefined ? entry : { ...entry, label: read };
}

function readSlot(value: unknown, slots: number, used: Set<number>, what: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= slots) {
    invalid(`A ${what} slot is from 0 to ${slots - 1}`);
  }
  if (used.has(value as number)) invalid(`Two ${what}s share a slot`);
  used.add(value as number);
  return value as number;
}

function readList<T>(value: unknown, max: number, what: string): readonly Untrusted<T>[] {
  if (!Array.isArray(value) || value.length > max) invalid(`A vault has at most ${max} ${what}s`);
  if (!value.every(entry => isObject(entry))) invalid(`A ${what} is an object`);
  return value as readonly Untrusted<T>[];
}

function bySlot<T extends { readonly slot: number }>(entries: T[]): T[] {
  return entries.sort((a, b) => a.slot - b.slot);
}

function assertDistinct(keys: readonly string[], message: string): void {
  if (new Set(keys).size !== keys.length) fail('INVALID_KEY', message);
}

function readParticipants(value: unknown, build: PinnedMidnightBuild, keyProblem: KeyCheck | undefined): MidnightVaultParticipants {
  if (!isObject<MidnightVaultParticipants>(value)) invalid('Participants are owners, guardians and delegates');
  const { ownerSlots, guardianSlots, delegateSlots } = build.constants;
  const ownerList = readList<StoredMidnightOwner>(value.owners, ownerSlots, 'owner');
  if (ownerList.length === 0) invalid('A vault has at least one owner');
  const slots = { owner: new Set<number>(), guardian: new Set<number>(), delegate: new Set<number>() };
  const owners = bySlot(ownerList.map(o => withLabel({
    slot: readSlot(o.slot, ownerSlots, slots.owner, 'owner'),
    approvalKey: readJubjubKey(o.approvalKey, 'owner approval key', keyProblem),
    upgradeKey: readUpgradeKey(o.upgradeKey, 'owner upgrade key', keyProblem),
  }, o.label, 'participant label')));
  const guardians = bySlot(readList<StoredMidnightGuardian>(value.guardians, guardianSlots, 'guardian').map(g => {
    if (g.salt !== undefined && !isHex32(g.salt)) invalid('A guardian salt is 32 bytes of lowercase hex');
    return withLabel({
      slot: readSlot(g.slot, guardianSlots, slots.guardian, 'guardian'),
      key: readJubjubKey(g.key, 'guardian key', keyProblem),
      ...(g.salt !== undefined ? { salt: g.salt as string } : {}),
    }, g.label, 'participant label');
  }));
  const delegates = bySlot(readList<StoredMidnightDelegate>(value.delegates, delegateSlots, 'delegate').map(d => withLabel({
    slot: readSlot(d.slot, delegateSlots, slots.delegate, 'delegate'),
    key: readJubjubKey(d.key, 'delegate key', keyProblem),
  }, d.label, 'participant label')));
  assertDistinct(
    [...owners.map(o => o.approvalKey), ...guardians.map(g => g.key), ...delegates.map(d => d.key)],
    'A Jubjub key appears twice in one vault',
  );
  assertDistinct(owners.map(o => o.upgradeKey), 'Two owners share an upgrade key');
  return { owners, guardians, delegates };
}

function participantsOf(participants: MidnightVaultParticipants, role: MidnightVaultRole): readonly { readonly slot: number }[] {
  return role === 'owner' ? participants.owners : role === 'guardian' ? participants.guardians : participants.delegates;
}

function readSelf(value: unknown, participants: MidnightVaultParticipants): MidnightVaultSelf[] {
  if (!Array.isArray(value) || value.length === 0) fail('SELF_MISMATCH', 'This seed holds a role in the vault');
  const self: MidnightVaultSelf[] = [];
  for (const entry of value as readonly unknown[]) {
    if (!isObject<MidnightVaultSelf>(entry) || !ROLES.includes(entry.role as MidnightVaultRole)) fail('SELF_MISMATCH', 'A self entry is an owner, a guardian or a delegate');
    const role = entry.role as MidnightVaultRole;
    if (self.some(s => s.role === role)) fail('SELF_MISMATCH', 'This seed has one entry per role it holds');
    if (!isIndex(entry.index)) invalid('An index is from 1 to 2^31 - 1');
    if (!participantsOf(participants, role).some(p => p.slot === entry.slot)) fail('SELF_MISMATCH', 'A self entry names a participant of its role');
    self.push({ role, index: entry.index, slot: entry.slot as number });
  }
  const roles = self.map(s => s.role);
  if (roles.includes('owner') && roles.includes('guardian')) fail('SELF_MISMATCH', 'A guardian is never an owner of the same vault');
  if (roles.includes('owner') && participants.guardians.some(g => g.salt === undefined)) {
    invalid('An owner holds every guardian\'s salt');
  }
  return self.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
}

function readAgreedConfig(value: unknown, build: PinnedMidnightBuild, keyProblem: KeyCheck | undefined): MidnightVaultAgreedConfig | null {
  if (value === null) return null;
  if (!isObject<MidnightVaultAgreedConfig>(value)) invalid('The agreed configuration is an object');
  const c = build.constants;
  if (!isHex32(value.digest)) invalid('The agreed configuration\'s digest is 32 bytes of lowercase hex');
  if (!isHex32(value.buildHash)) invalid('The agreed build hash is 32 bytes of lowercase hex');
  if (value.buildHash !== build.manifestHash) fail('BUILD_MISMATCH', 'The agreed build hash is not the pinned build manifest\'s');
  if (!Array.isArray(value.owners) || value.owners.length === 0) invalid('The agreed configuration has at least one owner');
  if (value.owners.length > c.ownerSlots) fail('BUILD_MISMATCH', `The build has ${c.ownerSlots} owner slots`);
  const owners = (value.owners as readonly unknown[]).map(o => {
    if (!isObject<MidnightVaultAgreedConfig['owners'][number]>(o)) invalid('An agreed owner is an object');
    return {
      approvalKey: readJubjubKey(o.approvalKey, 'agreed approval key', keyProblem),
      upgradeKey: readUpgradeKey(o.upgradeKey, 'agreed upgrade key', keyProblem),
    };
  });
  assertDistinct(owners.map(o => o.approvalKey), 'Two agreed owners share an approval key');
  assertDistinct(owners.map(o => o.upgradeKey), 'Two agreed owners share an upgrade key');
  if (!Number.isSafeInteger(value.threshold) || (value.threshold as number) < 1 || (value.threshold as number) > owners.length) {
    invalid('The agreed threshold is from 1 to the number of owners');
  }
  if (!isUint(value.changeDelay)) invalid('The change delay is whole seconds');
  const whitelist = value.whitelist;
  if (!isObject<MidnightVaultAgreedConfig['whitelist']>(whitelist) || typeof whitelist.enabled !== 'boolean' || !Array.isArray(whitelist.entries)) {
    invalid('The whitelist is a switch and a list of entries');
  }
  if (whitelist.entries.length > c.whitelistEntries) fail('BUILD_MISMATCH', `The build has ${c.whitelistEntries} whitelist entries`);
  const entries = (whitelist.entries as readonly unknown[]).map(e => {
    if (!isObject<MidnightWhitelistEntry>(e) || !isHex32(e.recipient) || !SCOPES.includes(e.scope as string)) invalid('A whitelist entry is a recipient and a scope');
    return { recipient: e.recipient, scope: e.scope as MidnightWhitelistEntry['scope'] };
  });
  if (!Array.isArray(value.guardians) || !value.guardians.every(isHex32)) invalid('Guardian commitments are 32 bytes of lowercase hex each');
  const guardians = [...(value.guardians as readonly string[])];
  if (guardians.length > c.guardianSlots) fail('BUILD_MISMATCH', `The build has ${c.guardianSlots} guardian slots`);
  if (guardians.some(g => /^0+$/.test(g)) || new Set(guardians).size !== guardians.length) invalid('Guardian commitments are distinct and not empty');
  const n = guardians.length;
  const t = value.guardianThreshold;
  if (!Number.isSafeInteger(t) || !((n === 0 && t === 0) || ((t as number) >= 1 && (t as number) <= n && 2 * (t as number) > n))) {
    invalid('The guardian threshold is 0 with no guardians, else a strict majority');
  }
  for (const field of ['recoveryDelay', 'cooldown', 'expiryWindow'] as const) {
    if (!isUint(value[field])) invalid(`The ${field} is whole seconds`);
  }
  if ((value.recoveryDelay as number) < c.minRecoveryDelaySeconds) fail('BUILD_MISMATCH', 'The recovery delay is below the build\'s floor');
  if (value.expiryWindow !== c.expiryWindowSeconds) fail('BUILD_MISMATCH', 'The expiry window is not the build\'s');
  if (value.cooldown !== c.cooldownSeconds) fail('BUILD_MISMATCH', 'The cool-down is not the build\'s');
  return {
    digest: value.digest,
    buildHash: value.buildHash,
    owners,
    threshold: value.threshold as number,
    changeDelay: value.changeDelay,
    whitelist: { enabled: whitelist.enabled, entries },
    guardians,
    guardianThreshold: t as number,
    recoveryDelay: value.recoveryDelay as number,
    cooldown: value.cooldown as number,
    expiryWindow: value.expiryWindow as number,
  };
}

function readVerifications(
  value: unknown,
  participants: MidnightVaultParticipants,
  agreed: MidnightVaultAgreedConfig | null,
): MidnightVaultVerification[] {
  if (!Array.isArray(value) || value.length > MAX_VERIFICATIONS) invalid(`Verification records are a list of at most ${MAX_VERIFICATIONS}`);
  if (value.length > 0 && !agreed) invalid('Verification records need the agreed configuration they verified');
  return (value as readonly unknown[]).map(record => {
    if (!isObject<MidnightVaultVerification>(record) || !VERIFICATION_METHODS.includes(record.method as string)) invalid('A verification record has an unknown method');
    if (!participants.owners.some(o => o.approvalKey === record.owner)) invalid('A verification record names someone who is not an owner');
    if (record.digest !== agreed?.digest) invalid('A verification record is not of the agreed configuration');
    if (!isUint(record.at)) invalid('A verification record\'s time is unix seconds');
    return { method: record.method as MidnightVaultVerification['method'], owner: record.owner as string, digest: record.digest, at: record.at };
  });
}

function deferredSet(build: PinnedMidnightBuild): string[] {
  return Object.keys(build.circuits).filter(name => build.circuits[name].deferred).sort();
}

function readDeployment(value: unknown, build: PinnedMidnightBuild): MidnightVaultDeployment | null {
  if (value === null) return null;
  if (!isObject<MidnightVaultDeployment>(value)) invalid('A deployment is an object');
  for (const field of ['deployTx', 'completionTx'] as const) {
    if (value[field] !== null && !isHex32(value[field])) invalid('A transaction hash is 32 bytes of lowercase hex');
  }
  if (value.completionTx !== null && value.deployTx === null) invalid('A completion update follows a deploy');
  if (!Array.isArray(value.deferred) || !value.deferred.every(name => typeof name === 'string')) invalid('The deferred circuits are a list of names');
  const deferred = [...(value.deferred as readonly string[])].sort();
  if (deferred.length > 0 && deferred.join(',') !== deferredSet(build).join(',')) {
    fail('BUILD_MISMATCH', 'A split deployment defers exactly the build\'s deferred set');
  }
  return { deployTx: value.deployTx as string | null, completionTx: value.completionTx as string | null, deferred };
}

function readCommittee(value: unknown): MidnightVaultCommittee {
  if (!isObject<MidnightVaultCommittee>(value) || !Array.isArray(value.keys)) fail('COMMITTEE_MISMATCH', 'A committee is keys and a threshold');
  if (value.keys.length === 0 || value.keys.length > MAX_COMMITTEE) fail('COMMITTEE_MISMATCH', `A committee has 1 to ${MAX_COMMITTEE} keys`);
  if (!value.keys.every(isHex32) || new Set(value.keys).size !== value.keys.length) {
    fail('COMMITTEE_MISMATCH', 'Committee keys are distinct x-only keys');
  }
  // A threshold of 0 accepts unsigned maintenance updates: no vault the wallet keeps has one.
  if (!Number.isSafeInteger(value.threshold) || (value.threshold as number) < 1) fail('COMMITTEE_MISMATCH', 'A committee threshold is at least 1');
  return { keys: [...(value.keys as readonly string[])], threshold: value.threshold as number };
}

function committeeResult(committee: MidnightVaultCommittee, owners: readonly StoredMidnightOwner[], ownerThreshold: number): MidnightVaultCheckResults['committee'] {
  const upgradeKeys = owners.map(o => o.upgradeKey);
  const sameKeys = committee.keys.length === upgradeKeys.length && committee.keys.every(key => upgradeKeys.includes(key));
  if (sameKeys && committee.threshold === ownerThreshold) return 'owners';
  if (committee.keys.length === 1 && committee.threshold === 1 && upgradeKeys.includes(committee.keys[0])) return 'interim';
  return 'outOfStep';
}

function readLastCheck(value: unknown, build: PinnedMidnightBuild, participants: MidnightVaultParticipants): MidnightVaultLastCheck | null {
  if (value === null) return null;
  if (!isObject<MidnightVaultLastCheckInput>(value)) invalid('A state read is an object');
  if (typeof value.source !== 'string' || !SOURCE.test(value.source)) invalid('A state read names its source');
  if (value.blockHeight !== null && !isUint(value.blockHeight)) invalid('A block height is a whole number');
  if (value.blockHash !== null && !isHex32(value.blockHash)) invalid('A block hash is 32 bytes of lowercase hex');
  if (!isUint(value.at)) invalid('A state read\'s time is milliseconds since the epoch');
  if (!isObject<Record<string, string>>(value.operations)) invalid('The operations are a map from circuit to fingerprint');
  const operations: Record<string, string> = {};
  for (const [circuit, fingerprint] of Object.entries(value.operations)) {
    const pin = own(build.circuits, circuit);
    if (!pin) fail('BUILD_MISMATCH', 'The contract has an operation the build does not');
    if (fingerprint !== pin.fingerprint) fail('BUILD_MISMATCH', 'An operation\'s verifier key is not the build\'s');
    operations[circuit] = pin.fingerprint;
  }
  const missing = Object.keys(build.circuits).filter(circuit => !own(operations, circuit));
  if (missing.some(circuit => !build.circuits[circuit].deferred)) fail('BUILD_MISMATCH', 'The contract lacks an operation the build always deploys');
  const committee = readCommittee(value.committee);
  const ownerThreshold = value.ownerThreshold;
  if (!Number.isSafeInteger(ownerThreshold) || (ownerThreshold as number) < 1 || (ownerThreshold as number) > participants.owners.length) {
    invalid('The owner threshold is from 1 to the number of owners');
  }
  return {
    source: value.source,
    blockHeight: value.blockHeight as number | null,
    blockHash: value.blockHash as string | null,
    at: value.at,
    operations,
    committee,
    ownerThreshold: ownerThreshold as number,
    results: {
      operations: missing.length === 0 ? 'complete' : 'deferredMissing',
      committee: committeeResult(committee, participants.owners, ownerThreshold as number),
    },
  };
}

function readApprovals(value: unknown, build: PinnedMidnightBuild): MidnightVaultApproval[] {
  const max = build.constants.ownerSlots + build.constants.guardianSlots;
  if (!Array.isArray(value) || value.length > max) invalid(`A request has at most ${max} approvals`);
  const approvals = (value as readonly unknown[]).map(a => {
    if (!isObject<MidnightVaultApproval>(a)) invalid('An approval is a signer and a file');
    const signer = readJubjubKey(a.signer, 'approval signer', undefined);
    if (typeof a.file !== 'string' || a.file.length === 0 || a.file.length > MAX_APPROVAL_FILE) invalid('An approval file is at most 8 KiB of text');
    return { signer, file: a.file };
  });
  if (new Set(approvals.map(a => a.signer)).size !== approvals.length) invalid('One approval per signer');
  return approvals;
}

function readRequestInput(value: unknown, build: PinnedMidnightBuild): MidnightVaultRequestInput {
  if (!isObject<MidnightVaultRequestInput>(value)) invalid('A request is an object');
  if (!isHex32(value.id)) invalid('A request id is 32 bytes of lowercase hex');
  if (typeof value.kind !== 'string' || !KIND.test(value.kind)) invalid('A request names its kind');
  if (!REQUEST_ORIGINS.includes(value.origin as string)) invalid('A request was made here or imported');
  if (typeof value.file !== 'string' || value.file.length === 0 || value.file.length > MAX_REQUEST_FILE) invalid('A request file is at most 32 KiB of text');
  if (!isUint(value.expiresAt)) invalid('A request\'s expiry is unix seconds');
  return {
    id: value.id,
    kind: value.kind,
    origin: value.origin as MidnightVaultRequestInput['origin'],
    file: value.file,
    expiresAt: value.expiresAt,
    approvals: readApprovals(value.approvals, build),
  };
}

function readRequests(value: unknown, build: PinnedMidnightBuild): StoredMidnightVaultRequest[] {
  if (!Array.isArray(value) || value.length > MAX_REQUESTS) invalid(`A vault keeps at most ${MAX_REQUESTS} open requests`);
  const requests = (value as readonly unknown[]).map(request => {
    const read = readRequestInput(request, build);
    const { createdAt, updatedAt } = request as Untrusted<StoredMidnightVaultRequest>;
    if (!isUint(createdAt) || !isUint(updatedAt) || updatedAt < createdAt) invalid('A request\'s times are milliseconds since the epoch');
    return { ...read, createdAt, updatedAt };
  });
  if (new Set(requests.map(r => r.id)).size !== requests.length) invalid('Two requests share an id');
  return requests;
}

function checkLifecycle(record: MidnightVaultRecord): void {
  const { lifecycle, lastCheck, successor } = record;
  if (lifecycle === 'deploying') {
    if (record.origin !== 'created') fail('LIFECYCLE_MISMATCH', 'Only a vault this device created is still deploying');
  } else if (!lastCheck) {
    fail('LIFECYCLE_MISMATCH', 'A vault past deploying was read from the chain');
  } else if (lifecycle === 'incomplete') {
    if (lastCheck.results.operations === 'complete' && lastCheck.results.committee !== 'interim') {
      fail('LIFECYCLE_MISMATCH', 'A vault with every operation and past the interim committee is not incomplete');
    }
  } else {
    if (lastCheck.results.operations !== 'complete') fail('LIFECYCLE_MISMATCH', 'A vault missing a deferred operation is incomplete');
    if (lifecycle === 'ready' && lastCheck.results.committee === 'interim') {
      fail('LIFECYCLE_MISMATCH', 'A vault under its deployer\'s interim committee is incomplete');
    }
  }
  if (successor !== null) {
    if (!isHex32(successor) || successor === record.vaultId) invalid('A successor is another vault\'s id');
    if (lifecycle !== 'temporary' && lifecycle !== 'moved') fail('LIFECYCLE_MISMATCH', 'Only a recovered or moved vault has a successor');
  } else if (lifecycle === 'moved') {
    fail('LIFECYCLE_MISMATCH', 'A moved vault names its successor');
  }
}

/**
 * The whole record, read again from `draft` and checked: the result holds no reference to the
 * caller's objects and no field the record does not have.
 */
function checkRecord(draft: MidnightVaultRecord, builds: ReadonlyMap<string, PinnedMidnightBuild>, keyProblem: KeyCheck | undefined): MidnightVaultRecord {
  const { vaultId, network, contractAddress } = draft;
  if (!isHex32(vaultId)) invalid('A vault id is 32 bytes of lowercase hex');
  if (!NETWORKS.includes(network)) invalid('A Midnight network is preprod, preview or mainnet');
  if (!isHex32(contractAddress)) invalid('A contract address is 32 bytes of lowercase hex');
  if (midnightVaultId(network, contractAddress) !== vaultId) {
    fail('VAULT_ID_MISMATCH', 'The vault id is not the one this network and contract address give');
  }

  if (!isObject(draft.build) || typeof draft.build.id !== 'string' || !PROFILES.includes(draft.build.profile)) {
    invalid('A build is an id and a profile');
  }
  const build = builds.get(draft.build.id);
  if (!build || build.profile !== draft.build.profile) fail('UNKNOWN_BUILD', 'The build is not a pinned build of this profile');
  if (build.profile === 'test' && network !== TEST_BUILD_ONLY_NETWORK) fail('TEST_BUILD_NETWORK', 'A test build is for preprod only');
  if (!build.networks.includes(network)) fail('BUILD_NETWORK', 'The pinned build does not allow this network');

  if (draft.status !== 'candidate' && draft.status !== 'accepted') invalid('A vault is a candidate or accepted');
  if (!ORIGINS.includes(draft.origin)) invalid('A vault was created, imported or restored');
  if (!LIFECYCLES.includes(draft.lifecycle)) invalid('Unknown lifecycle');
  const name = optionalLabel(draft.name, 'vault name');

  const participants = readParticipants(draft.participants, build, keyProblem);
  const self = readSelf(draft.self, participants);
  if (!isIndex(draft.highestIndex)) invalid('The highest index is from 1 to 2^31 - 1');
  if (self.some(s => s.index > draft.highestIndex)) invalid('The highest index is at least every index of this seed');
  const agreedConfig = readAgreedConfig(draft.agreedConfig, build, keyProblem);
  const verifications = readVerifications(draft.verifications, participants, agreedConfig);
  const deployment = readDeployment(draft.deployment, build);
  const lastCheck = readLastCheck(draft.lastCheck, build, participants);
  const requests = readRequests(draft.requests, build);

  const { createdAt, updatedAt, acceptedAt } = draft;
  if (!isUint(createdAt) || !isUint(updatedAt) || updatedAt < createdAt) invalid('Times are milliseconds since the epoch');
  if ((draft.status === 'accepted') !== (acceptedAt !== null)) invalid('Only an accepted vault has an acceptance time');
  if (acceptedAt !== null && (!isUint(acceptedAt) || acceptedAt < createdAt)) invalid('Times are milliseconds since the epoch');

  const record: MidnightVaultRecord = {
    recordVersion: 1,
    vaultId,
    network,
    contractAddress,
    build: { id: build.id, profile: build.profile },
    status: draft.status,
    origin: draft.origin,
    lifecycle: draft.lifecycle,
    ...(name !== undefined ? { name } : {}),
    self,
    highestIndex: draft.highestIndex,
    participants,
    agreedConfig,
    verifications,
    deployment,
    lastCheck,
    requests,
    successor: draft.successor,
    createdAt,
    updatedAt,
    acceptedAt,
  };
  checkLifecycle(record);
  return record;
}

function checkBuilds(builds: readonly PinnedMidnightBuild[]): ReadonlyMap<string, PinnedMidnightBuild> {
  const map = new Map<string, PinnedMidnightBuild>();
  for (const build of builds) {
    const sound = typeof build?.id === 'string'
      && PROFILES.includes(build.profile)
      && Array.isArray(build.networks) && build.networks.every(n => NETWORKS.includes(n))
      && isHex32(build.manifestHash)
      && isObject(build.circuits) && Object.values(build.circuits).every(c => isHex32(c?.fingerprint) && typeof c.deferred === 'boolean')
      && isObject(build.constants) && Object.values(build.constants).every(isUint)
      && build.constants.ownerSlots >= 1;
    if (!sound || map.has(build.id)) throw new Error('A pinned Midnight vault build is malformed or listed twice');
    map.set(build.id, build);
  }
  return map;
}

function assertVaultId(vaultId: unknown): asserts vaultId is string {
  if (!isHex32(vaultId)) invalid('A vault id is 32 bytes of lowercase hex');
}

function nextUpdatedAt(current: MidnightVaultRecord): number {
  // Strictly increasing, so a review of an earlier version never matches a later one.
  return Math.max(Date.now(), current.updatedAt + 1);
}

// -------------------------------------------------------------------------------------------------
// The store

export function createMidnightVaultStore(options: MidnightVaultStoreOptions): MidnightVaultStore {
  const builds = checkBuilds(options.builds);
  const { keyProblem } = options;
  const openDatabase = options.openDatabase ?? getDb;
  const check = (draft: MidnightVaultRecord) => checkRecord(draft, builds, keyProblem);

  async function database(walletId: number): Promise<Dexie> {
    if (!Number.isSafeInteger(walletId) || walletId < 0) invalid('A wallet id is a non-negative integer');
    let db: Dexie | null;
    try {
      db = await openDatabase(walletId);
    } catch (error) {
      throw new MidnightVaultStoreError('STORE_UNAVAILABLE', 'The wallet database could not be opened', { cause: error });
    }
    if (!db) throw new MidnightVaultStoreError('STORE_UNAVAILABLE', 'The wallet database could not be opened');
    return db;
  }

  /**
   * Runs `work` in one transaction on the table. Only Dexie calls and synchronous checks may run
   * inside it: awaiting anything else would end the transaction early.
   */
  async function withVaults<T>(walletId: number, mode: 'r' | 'rw', work: (table: Table<MidnightVaultRecord, string>) => Promise<T>): Promise<T> {
    const db = await database(walletId);
    try {
      return await db.transaction(mode, TABLE, () => work(db.table<MidnightVaultRecord, string>(TABLE)));
    } catch (error) {
      if (error instanceof MidnightVaultStoreError) throw error;
      throw new MidnightVaultStoreError('STORE_UNAVAILABLE', 'The Midnight vaults of this wallet could not be read or written', { cause: error });
    }
  }

  function readable(row: MidnightVaultRecord): MidnightVaultRecord {
    if (row?.recordVersion !== 1) fail('STORE_UNAVAILABLE', 'A stored Midnight vault has a format this version cannot read');
    return row;
  }

  async function current(table: Table<MidnightVaultRecord, string>, vaultId: string): Promise<MidnightVaultRecord> {
    const row = await table.get(vaultId);
    if (!row) fail('NOT_FOUND', 'This wallet does not hold this vault');
    return readable(row);
  }

  async function addCandidate(walletId: number, input: MidnightVaultCandidateInput): Promise<MidnightVaultRecord> {
    if (!isObject(input)) invalid('A candidate is an object');
    const now = Date.now();
    const record = check({
      recordVersion: 1,
      vaultId: input.vaultId,
      network: input.network,
      contractAddress: input.contractAddress,
      build: input.build,
      status: 'candidate',
      origin: input.origin,
      lifecycle: input.lifecycle,
      ...(input.name !== undefined ? { name: input.name } : {}),
      self: input.self,
      highestIndex: input.highestIndex,
      participants: input.participants,
      agreedConfig: input.agreedConfig ?? null,
      verifications: input.verifications ?? [],
      deployment: input.deployment ?? null,
      lastCheck: (input.lastCheck ?? null) as MidnightVaultLastCheck | null,
      requests: [],
      successor: input.successor ?? null,
      createdAt: now,
      updatedAt: now,
      acceptedAt: null,
    });
    return withVaults(walletId, 'rw', async table => {
      if (await table.get(record.vaultId)) fail('VAULT_EXISTS', 'This wallet already holds this vault');
      await table.add(record);
      return record;
    });
  }

  async function accept(walletId: number, vaultId: string, input: MidnightVaultAcceptInput): Promise<MidnightVaultRecord> {
    assertVaultId(vaultId);
    if (!isObject(input) || !isUint(input.reviewedUpdatedAt)) invalid('Accepting names the version the user reviewed');
    return withVaults(walletId, 'rw', async table => {
      const row = await current(table, vaultId);
      if (row.status !== 'candidate') fail('NOT_A_CANDIDATE', 'This vault is already accepted');
      if (row.updatedAt !== input.reviewedUpdatedAt) fail('STALE_REVIEW', 'This vault changed after it was reviewed');
      if (!ACCEPTABLE.includes(row.lifecycle)) fail('VAULT_INCOMPLETE', 'A vault is accepted only once it is complete on chain');
      const now = nextUpdatedAt(row);
      const next = check({ ...row, status: 'accepted', updatedAt: now, acceptedAt: now });
      await table.put(next);
      return next;
    });
  }

  async function update(walletId: number, vaultId: string, patch: MidnightVaultRecordPatch): Promise<MidnightVaultRecord> {
    assertVaultId(vaultId);
    if (!isObject(patch)) invalid('A patch is an object');
    if (Object.keys(patch).some(key => !PATCH_KEYS.includes(key))) invalid('Only the fields listed in MidnightVaultRecordPatch change');
    return withVaults(walletId, 'rw', async table => {
      const row = await current(table, vaultId);
      const draft: Mutable<MidnightVaultRecord> = { ...row };
      if (patch.name === null) delete draft.name;
      else if (patch.name !== undefined) draft.name = patch.name;
      if (patch.participants !== undefined) draft.participants = patch.participants;
      if (patch.self !== undefined) draft.self = patch.self;
      if (patch.labels !== undefined) draft.participants = relabel(draft.participants, patch.labels);
      if (patch.lifecycle !== undefined) {
        if (patch.lifecycle !== row.lifecycle && patch.lifecycle === 'deploying') fail('LIFECYCLE_MISMATCH', 'A vault never goes back to deploying');
        if (patch.lifecycle !== row.lifecycle && row.lifecycle === 'moved') fail('LIFECYCLE_MISMATCH', 'A moved vault stays moved');
        draft.lifecycle = patch.lifecycle;
      }
      if (patch.highestIndex !== undefined) {
        if (!isIndex(patch.highestIndex) || patch.highestIndex < row.highestIndex) invalid('The highest index is only ever raised');
        draft.highestIndex = patch.highestIndex;
      }
      if (patch.agreedConfig !== undefined) draft.agreedConfig = patch.agreedConfig;
      if (patch.verifications !== undefined) draft.verifications = patch.verifications;
      if (patch.deployment !== undefined) draft.deployment = patch.deployment;
      if (patch.lastCheck !== undefined) draft.lastCheck = patch.lastCheck as MidnightVaultLastCheck | null;
      if (patch.successor !== undefined) draft.successor = patch.successor;
      draft.updatedAt = nextUpdatedAt(row);
      const next = check(draft);
      await table.put(next);
      return next;
    });
  }

  async function putRequest(walletId: number, vaultId: string, request: MidnightVaultRequestInput): Promise<MidnightVaultRecord> {
    assertVaultId(vaultId);
    return withVaults(walletId, 'rw', async table => {
      const row = await current(table, vaultId);
      if (row.status !== 'accepted') fail('NOT_ACCEPTED', 'A candidate is never signed for, so it holds no requests');
      const build = builds.get(row.build.id);
      if (!build) fail('UNKNOWN_BUILD', 'The build is not a pinned build of this profile');
      const input = readRequestInput(request, build);
      const now = nextUpdatedAt(row);
      const stored = row.requests.find(r => r.id === input.id);
      let requests: StoredMidnightVaultRequest[];
      if (!stored) {
        requests = [...row.requests, { ...input, createdAt: now, updatedAt: now }];
      } else {
        if (stored.kind !== input.kind || stored.expiresAt !== input.expiresAt) invalid('Another request has this id');
        const added = input.approvals.filter(a => !stored.approvals.some(s => s.signer === a.signer));
        if (added.length === 0) return row;
        const merged = { ...stored, approvals: [...stored.approvals, ...added], updatedAt: now };
        requests = row.requests.map(r => (r.id === input.id ? merged : r));
      }
      const next = check({ ...row, requests, updatedAt: now });
      await table.put(next);
      return next;
    });
  }

  async function removeRequest(walletId: number, vaultId: string, requestId: string): Promise<MidnightVaultRecord> {
    assertVaultId(vaultId);
    if (!isHex32(requestId)) invalid('A request id is 32 bytes of lowercase hex');
    return withVaults(walletId, 'rw', async table => {
      const row = await current(table, vaultId);
      if (!row.requests.some(r => r.id === requestId)) return row;
      const next = check({ ...row, requests: row.requests.filter(r => r.id !== requestId), updatedAt: nextUpdatedAt(row) });
      await table.put(next);
      return next;
    });
  }

  async function list(walletId: number, filter: MidnightVaultListFilter = {}): Promise<readonly MidnightVaultRecord[]> {
    if (!isObject(filter)) invalid('A filter is an object');
    const rows = await withVaults(walletId, 'r', table => table.toArray());
    return rows
      .map(readable)
      .filter(row => (filter.status === undefined || row.status === filter.status)
        && (filter.network === undefined || row.network === filter.network)
        && (filter.role === undefined || row.self.some(s => s.role === filter.role)))
      .sort((a, b) => a.createdAt - b.createdAt || (a.vaultId < b.vaultId ? -1 : a.vaultId > b.vaultId ? 1 : 0));
  }

  async function get(walletId: number, vaultId: string): Promise<MidnightVaultRecord | undefined> {
    assertVaultId(vaultId);
    const row = await withVaults(walletId, 'r', table => table.get(vaultId));
    return row === undefined ? undefined : readable(row);
  }

  return Object.freeze({ list, get, addCandidate, accept, update, putRequest, removeRequest });
}

function relabel(participants: MidnightVaultParticipants, labels: MidnightVaultRecordPatch['labels']): MidnightVaultParticipants {
  if (!Array.isArray(labels)) invalid('Labels are a list of role, slot and label');
  const next = { owners: [...participants.owners], guardians: [...participants.guardians], delegates: [...participants.delegates] };
  const lists = { owner: next.owners, guardian: next.guardians, delegate: next.delegates } as Record<MidnightVaultRole, { slot: number; label?: string }[]>;
  for (const change of labels) {
    if (!isObject<{ role: unknown; slot: unknown; label: unknown }>(change) || !ROLES.includes(change.role as MidnightVaultRole)) invalid('A label change names a role');
    const list = lists[change.role as MidnightVaultRole];
    const at = list.findIndex(p => p.slot === change.slot);
    if (at < 0) invalid('A label names someone who is not a participant');
    const { label: _old, ...rest } = list[at];
    list[at] = change.label === null ? rest : { ...rest, label: change.label as string };
  }
  return next;
}

/**
 * The store screens use. It refuses every write until the pinned builds are wired in, and the full
 * key check comes from the Midnight keys package at integration.
 */
export const midnightVaultStore: MidnightVaultStore = createMidnightVaultStore({ builds: [] });

/**
 * GeroVault on Midnight: the contract vaults one seed holds, in its wallet database's
 * `midnightVaults` table, and its own index counter per network in `midnightVaultIndexes`
 * (`schema.ts`, version 13). Implements `MidnightVaultStore` of
 * `src/modules/gerovault/midnight/contracts.ts`; `walletId` is the phrase's `secretsWalletId`.
 *
 * Tables of their own beside the Cardano `vaults` table: the Cardano store, its checks and the
 * dApp signing guard (knownVaults.ts) never read them.
 *
 * Every write checks the whole record, so a screen never has to trust a row:
 * - the vault id is the one the network and the contract address give;
 * - the build is a pinned build allowed on the vault's network, and a test build is preprod only;
 * - a candidate's state read passed the import checks: every operation of a known build (or a
 *   deferred one missing), a state the build decodes, a role for this seed, and the agreed
 *   configuration where there is one; nothing that failed one is stored;
 * - the lifecycle agrees with the state read: `ready` has no missing operation and no interim
 *   committee, and a vault is accepted only once it is complete on chain;
 * - a split deployment defers exactly the build's deferred set;
 * - participants sit in the build's slots, their keys are well formed and never twice in one
 *   vault, and each card matches its slot (when `checkCard` is given);
 * - this seed has exactly one entry per role it holds, never both owner and guardian, each role
 *   held by some participant;
 * - verification records name an owner and the agreed configuration's digest;
 * - requests belong to this vault (network, contract, build, digest) and only to an accepted one.
 *
 * A later state read is stored whatever it found (an unknown operation, a committee out of step),
 * so a screen sees the change rather than an earlier good read. What cannot be checked here: that
 * this seed derives the keys at its indexes (that needs the phrase), and anything only the chain
 * knows. Point validity beyond the encoding and card signatures come from `keyProblem` and
 * `checkCard`, which integration passes from the keys library.
 *
 * Every failure is a `MidnightVaultStoreError`; `INVALID_INPUT` carries a `reason`. A database
 * that cannot be read, or a row this version cannot read, throws `STORE_UNAVAILABLE`, never "no
 * vaults".
 */
import type Dexie from 'dexie';
import type { Table } from 'dexie';
import { MIDNIGHT_VAULT_BUILDS, MIDNIGHT_VAULT_CIRCUITS, MIDNIGHT_VAULT_NETWORK_IDS } from '@/chains/midnight/vault/build';
import { getDb } from '@/db/wallet-db';
import { readLabel } from '@/shared/gerovault/labels';
import {
  JUBJUB_IDENTITY_HEX,
  MIDNIGHT_APPROVAL_FILE_TYPE,
  MIDNIGHT_FILE_MAX_BYTES,
  MIDNIGHT_FILE_VERSION,
  MIDNIGHT_REQUEST_FILE_TYPE,
  MIDNIGHT_REQUEST_KINDS,
  midnightVaultId,
  type MidnightApprovalFile,
  type MidnightDelegateSlot,
  type MidnightDeploymentRecord,
  type MidnightLastCheck,
  type MidnightOwnerVerification,
  type MidnightRequestFile,
  type MidnightSelfRole,
  type MidnightStoredGuardian,
  type MidnightStoredOwner,
  type MidnightStoredParticipants,
  type MidnightStoredRequest,
  type MidnightVaultBuild,
  type MidnightVaultCandidateInput,
  type MidnightVaultListFilter,
  type MidnightVaultNetwork,
  type MidnightVaultRecord,
  type MidnightVaultRecordPatch,
  type MidnightVaultStore,
  type MidnightVaultStoreErrorCode,
  type MidnightVerificationSetPin,
} from '@/modules/gerovault/midnight/contracts';

/** Why an `INVALID_INPUT` was refused, so a screen can name the failure. */
export type MidnightVaultStoreRefusal =
  | 'MALFORMED'
  | 'UNKNOWN_BUILD'
  | 'TEST_BUILD_NETWORK'
  | 'BUILD_NETWORK'
  | 'BUILD_MISMATCH'
  | 'IMPORT_CHECK_FAILED'
  | 'INVALID_KEY'
  | 'INVALID_CARD'
  | 'SELF_MISMATCH'
  | 'LIFECYCLE_MISMATCH'
  | 'VAULT_INCOMPLETE'
  | 'NOT_ACCEPTED'
  | 'REQUEST_MISMATCH'
  | 'TOO_MANY_REQUESTS';

export class MidnightVaultStoreError extends Error {
  readonly code: MidnightVaultStoreErrorCode;
  /** Set on every `INVALID_INPUT`. */
  readonly reason?: MidnightVaultStoreRefusal;

  constructor(code: MidnightVaultStoreErrorCode, message: string, options?: { cause?: unknown; reason?: MidnightVaultStoreRefusal }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MidnightVaultStoreError';
    this.code = code;
    if (options?.reason) this.reason = options.reason;
  }
}

/** What a card in a slot must carry: its role, the vault's network and the slot's keys or commitment. */
export interface MidnightCardExpectation {
  readonly role: 'owner' | 'guardian';
  readonly network: MidnightVaultNetwork;
  readonly approvalKey?: string;
  readonly upgradeKey?: string;
  readonly commitment?: string;
}

export interface MidnightVaultStoreOptions {
  /** The pinned builds a vault may name: both vendored builds unless a test passes others. */
  readonly builds?: readonly MidnightVaultBuild[];
  /**
   * The full key check (on the curve, prime-order subgroup; an x-only key that lifts): null when
   * usable, otherwise the reason. Runs after the store's own encoding checks.
   */
  readonly keyProblem?: (key: { readonly kind: 'jubjub' | 'upgrade'; readonly hex: string }) => string | null;
  /** Whether a card's text reads (`readKeyCard`: signatures and all) and matches its slot. */
  readonly checkCard?: (card: string, expected: MidnightCardExpectation) => boolean;
  /** The wallet database; `getDb` unless a test passes another. */
  readonly openDatabase?: (walletId: number) => Promise<Dexie | null>;
}

// -------------------------------------------------------------------------------------------------
// Checks

const VAULTS = 'midnightVaults';
const INDEXES = 'midnightVaultIndexes';
const HEX32 = /^[0-9a-f]{64}$/;
const JUBJUB_HEX = /^[0-9a-f]{128}$/;
const HEX_BYTES = /^(?:[0-9a-f]{2})+$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,38})$/;
const SOURCE = /^[\x21-\x7e][\x20-\x7e]{0,63}$/;
const ORIGINS: readonly string[] = ['created', 'imported', 'restored'];
const LIFECYCLES: readonly string[] = ['deploying', 'incomplete', 'ready', 'temporary', 'moved'];
const ROLES: readonly MidnightSelfRole['role'][] = ['owner', 'guardian', 'delegate'];
const VERIFICATION_METHODS: readonly string[] = ['number', 'qr'];
const OPERATION_CHECKS: readonly string[] = ['exact', 'incomplete', 'unknown-build'];
const COMMITTEE_CHECKS: readonly string[] = ['owners', 'interim', 'temporary', 'drift'];
const REQUEST_STATES: readonly string[] = ['open', 'submitted', 'landed', 'replaced', 'expired', 'failed'];
const SETTLED_STATES: readonly string[] = ['landed', 'replaced', 'expired', 'failed'];
const APPROVAL_ROLES: readonly string[] = ['owner', 'guardian', 'committee'];
/** A vault is accepted only once it is complete on chain. */
const ACCEPTABLE: readonly string[] = ['ready', 'temporary', 'moved'];
const PATCH_KEYS: readonly string[] = ['name', 'lifecycle', 'self', 'participants', 'agreedConfig', 'verifications', 'deployment', 'lastCheck', 'successor'];
const TEST_BUILD_ONLY_NETWORK: MidnightVaultNetwork = 'preprod';
const MAX_INDEX = 2 ** 31 - 1;
const MAX_CARD = 4096;
const MAX_SET_CBOR = 16 * 1024;
const MAX_VERIFICATIONS = 64;
const MAX_REQUESTS = 32;
const MIN_DELEGATE_PERIOD = 600;
const MAX_UINT128 = (1n << 128n) - 1n;
/** Jubjub's base field, the BLS12-381 scalar field: coordinates and field elements are below it. */
const FIELD = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
/** The secp256k1 base field: an x-only key is below it. */
const SECP256K1_FIELD = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** A value shaped like `T` as far as its keys go, every field still to be checked. */
type Untrusted<T> = { readonly [K in keyof T]?: unknown };
type Options = Required<Pick<MidnightVaultStoreOptions, 'builds'>> & Pick<MidnightVaultStoreOptions, 'keyProblem' | 'checkCard'>;

interface IndexRow {
  readonly network: MidnightVaultNetwork;
  readonly highestIndex: number;
}

function refuse(reason: MidnightVaultStoreRefusal, message: string): never {
  throw new MidnightVaultStoreError('INVALID_INPUT', message, { reason });
}

function malformed(message: string): never {
  return refuse('MALFORMED', message);
}

function isObject<T = object>(value: unknown): value is Untrusted<T> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isNetwork(value: unknown): value is MidnightVaultNetwork {
  return (MIDNIGHT_VAULT_NETWORK_IDS as readonly unknown[]).includes(value);
}

function littleEndian(hex: string): bigint {
  let reversed = '';
  for (let i = hex.length - 2; i >= 0; i -= 2) reversed += hex.slice(i, i + 2);
  return BigInt(`0x${reversed}`);
}

/** The JSON text's UTF-8 length: files are bounded in bytes. */
function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** A plain copy of a JSON-safe value, holding none of the caller's objects. */
function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readJubjubKey(value: unknown, what: string, options: Options): string {
  if (typeof value !== 'string' || !JUBJUB_HEX.test(value)) refuse('INVALID_KEY', `The ${what} is not a Jubjub point (64 bytes of lowercase hex)`);
  if (littleEndian(value.slice(0, 64)) >= FIELD || littleEndian(value.slice(64)) >= FIELD) refuse('INVALID_KEY', `The ${what} has a coordinate outside the field`);
  if (value === JUBJUB_IDENTITY_HEX) refuse('INVALID_KEY', `The ${what} is the identity point`);
  if (options.keyProblem?.({ kind: 'jubjub', hex: value })) refuse('INVALID_KEY', `The ${what} is not a usable key`);
  return value;
}

function readUpgradeKey(value: unknown, what: string, options: Options): string {
  if (!isHex32(value)) refuse('INVALID_KEY', `The ${what} is not an x-only key (32 bytes of lowercase hex)`);
  const x = BigInt(`0x${value}`);
  if (x === 0n || x >= SECP256K1_FIELD) refuse('INVALID_KEY', `The ${what} is outside the field`);
  if (options.keyProblem?.({ kind: 'upgrade', hex: value })) refuse('INVALID_KEY', `The ${what} is not a usable key`);
  return value;
}

function readField(value: unknown, what: string): string {
  if (!isHex32(value) || littleEndian(value) >= FIELD || littleEndian(value) === 0n) malformed(`The ${what} is a non-zero field element (32 bytes little-endian)`);
  return value;
}

function optionalLabel(value: unknown): { label?: string } {
  if (value === undefined) return {};
  const label = readLabel(value);
  if (label === undefined) malformed('A label is at most 64 bytes of text with no control character');
  return { label };
}

function optionalCard(value: unknown): { card?: string } {
  if (value === undefined) return {};
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CARD) malformed('A card is the text of a key card file');
  return { card: value };
}

function buildOf(buildId: unknown, network: MidnightVaultNetwork, options: Options): MidnightVaultBuild {
  const build = options.builds.find(b => b.buildId === buildId);
  if (!build) refuse('UNKNOWN_BUILD', 'The build is not a pinned build');
  if (build.profile === 'test' && network !== TEST_BUILD_ONLY_NETWORK) refuse('TEST_BUILD_NETWORK', 'A test build is for preprod only');
  if (!build.networks.includes(network)) refuse('BUILD_NETWORK', 'The pinned build does not allow this network');
  return build;
}

function readSlots<T, R>(value: unknown, count: number, what: string, read: (entry: Untrusted<T>) => R): (R | null)[] {
  if (!Array.isArray(value) || value.length !== count) malformed(`The ${what} are ${count} slots in contract order, null when empty`);
  return (value as readonly unknown[]).map(entry => {
    if (entry === null) return null;
    if (!isObject<T>(entry)) malformed(`A ${what} slot is an object or null`);
    return read(entry);
  });
}

function assertDistinct(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) refuse('INVALID_KEY', message);
}

function present<T>(slots: readonly (T | null)[]): T[] {
  return slots.filter((slot): slot is T => slot !== null);
}

function readParticipants(value: unknown, network: MidnightVaultNetwork, build: MidnightVaultBuild, options: Options): MidnightStoredParticipants {
  if (!isObject<MidnightStoredParticipants>(value)) malformed('Participants are owner, guardian and delegate slots');
  const { ownerSlots, guardianSlots, delegateSlots } = build.constants;
  const owners = readSlots<MidnightStoredOwner, MidnightStoredOwner>(value.owners, ownerSlots, 'owner', o => ({
    approvalKey: readJubjubKey(o.approvalKey, 'owner approval key', options),
    upgradeKey: readUpgradeKey(o.upgradeKey, 'owner upgrade key', options),
    ...optionalLabel(o.label),
    ...optionalCard(o.card),
  }));
  const guardians = readSlots<MidnightStoredGuardian, MidnightStoredGuardian>(value.guardians, guardianSlots, 'guardian', g => ({
    commitment: readField(g.commitment, 'guardian commitment'),
    ...optionalCard(g.card),
    ...optionalLabel(g.label),
  }));
  const delegates = readSlots<MidnightDelegateSlot, MidnightDelegateSlot>(value.delegates, delegateSlots, 'delegate', d => {
    if (typeof d.cap !== 'string' || !DECIMAL.test(d.cap) || BigInt(d.cap) > MAX_UINT128) malformed('A delegate cap is STAR, a decimal string');
    if (!isUint(d.period) || d.period < MIN_DELEGATE_PERIOD) malformed(`A delegate period is at least ${MIN_DELEGATE_PERIOD} seconds`);
    return { key: readJubjubKey(d.key, 'delegate key', options), cap: d.cap, period: d.period, ...optionalLabel(d.label) };
  });
  const ownerList = present(owners);
  if (ownerList.length === 0) malformed('A vault has at least one owner');
  assertDistinct([...ownerList.map(o => o.approvalKey), ...present(delegates).map(d => d.key)], 'A Jubjub key appears twice in one vault');
  assertDistinct(ownerList.map(o => o.upgradeKey), 'Two owners share an upgrade key');
  assertDistinct(present(guardians).map(g => g.commitment), 'Two guardian slots share a commitment');
  if (options.checkCard) {
    for (const owner of ownerList) {
      if (owner.card !== undefined && !options.checkCard(owner.card, { role: 'owner', network, approvalKey: owner.approvalKey, upgradeKey: owner.upgradeKey })) {
        refuse('INVALID_CARD', 'An owner card does not read, or is not the card of its slot');
      }
    }
    for (const guardian of present(guardians)) {
      if (guardian.card !== undefined && !options.checkCard(guardian.card, { role: 'guardian', network, commitment: guardian.commitment })) {
        refuse('INVALID_CARD', 'A guardian card does not read, or is not the card of its slot');
      }
    }
  }
  return { owners, guardians, delegates };
}

function readSelf(value: unknown, participants: MidnightStoredParticipants): MidnightSelfRole[] {
  if (!Array.isArray(value) || value.length === 0) refuse('SELF_MISMATCH', 'This seed holds a role in the vault');
  const self: MidnightSelfRole[] = [];
  for (const entry of value as readonly unknown[]) {
    if (!isObject<MidnightSelfRole>(entry) || !ROLES.includes(entry.role as MidnightSelfRole['role'])) refuse('SELF_MISMATCH', 'A self entry is an owner, a guardian or a delegate');
    const role = entry.role as MidnightSelfRole['role'];
    if (self.some(s => s.role === role)) refuse('SELF_MISMATCH', 'This seed has exactly one entry per role it holds');
    if (!isIndex(entry.index)) malformed('An index is from 1 to 2^31 - 1');
    const slots = role === 'owner' ? participants.owners : role === 'guardian' ? participants.guardians : participants.delegates;
    if (present<unknown>(slots).length === 0) refuse('SELF_MISMATCH', 'This seed holds a role no participant holds');
    self.push({ role, index: entry.index });
  }
  const roles = self.map(s => s.role);
  if (roles.includes('owner') && roles.includes('guardian')) refuse('SELF_MISMATCH', 'A guardian is never an owner of the same vault');
  return self.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
}

function readAgreedConfig(value: unknown): MidnightVerificationSetPin | null {
  if (value === null) return null;
  if (!isObject<MidnightVerificationSetPin>(value)) malformed('The agreed configuration is a pinned verification set');
  if (typeof value.cbor !== 'string' || value.cbor.length > MAX_SET_CBOR || !HEX_BYTES.test(value.cbor)) malformed('A verification set is canonical CBOR, lowercase hex');
  if (!isHex32(value.digest)) malformed('A verification digest is 32 bytes of lowercase hex');
  return { cbor: value.cbor, digest: value.digest };
}

function readVerifications(value: unknown, participants: MidnightStoredParticipants, agreed: MidnightVerificationSetPin | null): MidnightOwnerVerification[] {
  if (!Array.isArray(value) || value.length > MAX_VERIFICATIONS) malformed(`Verification records are a list of at most ${MAX_VERIFICATIONS}`);
  if (value.length > 0 && !agreed) malformed('Verification records need the agreed configuration they verified');
  const owners = present(participants.owners).map(o => o.approvalKey);
  return (value as readonly unknown[]).map(record => {
    if (!isObject<MidnightOwnerVerification>(record) || !VERIFICATION_METHODS.includes(record.method as string)) malformed('A verification record has an unknown method');
    if (!owners.includes(record.approvalKey as string)) malformed('A verification record names someone who is not an owner');
    if (record.verificationDigest !== agreed?.digest) malformed('A verification record is not of the agreed configuration');
    if (!isUint(record.at)) malformed('A verification record\'s time is unix seconds');
    return {
      approvalKey: record.approvalKey as string,
      method: record.method as MidnightOwnerVerification['method'],
      verificationDigest: record.verificationDigest,
      at: record.at,
    };
  });
}

function readDeployment(value: unknown, build: MidnightVaultBuild): MidnightDeploymentRecord | null {
  if (value === null) return null;
  if (!isObject<MidnightDeploymentRecord>(value)) malformed('A deployment is an object');
  for (const field of ['deployTxHash', 'completionTxHash'] as const) {
    if (value[field] !== undefined && !isHex32(value[field])) malformed('A transaction hash is 32 bytes of lowercase hex');
  }
  if (value.completionTxHash !== undefined && value.deployTxHash === undefined) malformed('A completion update follows a deploy');
  if (!Array.isArray(value.deferred) || !value.deferred.every(c => (MIDNIGHT_VAULT_CIRCUITS as readonly unknown[]).includes(c))) {
    malformed('The deferred circuits are circuit names');
  }
  const deferred = [...(value.deferred as MidnightDeploymentRecord['deferred'])].sort();
  if (deferred.length > 0 && deferred.join() !== [...build.deferred].sort().join()) refuse('BUILD_MISMATCH', 'A split deployment defers exactly the build\'s deferred set');
  return {
    ...(value.deployTxHash !== undefined ? { deployTxHash: value.deployTxHash as string } : {}),
    ...(value.completionTxHash !== undefined ? { completionTxHash: value.completionTxHash as string } : {}),
    deferred,
  };
}

function readLastCheck(value: unknown, agreed: MidnightVerificationSetPin | null): MidnightLastCheck | null {
  if (value === null) return null;
  if (!isObject<MidnightLastCheck>(value)) malformed('A state read is an object');
  if (typeof value.source !== 'string' || !SOURCE.test(value.source)) malformed('A state read names its source');
  if (!isUint(value.blockHeight) || !isHex32(value.blockHash)) malformed('A state read names its block: a height and a 32-byte hash');
  if (!isUint(value.at)) malformed('A state read\'s time is milliseconds since the epoch');
  const checks = value.checks;
  if (!isObject<MidnightLastCheck['checks']>(checks)
    || !OPERATION_CHECKS.includes(checks.operations as string)
    || !COMMITTEE_CHECKS.includes(checks.committee as string)
    || typeof checks.decoded !== 'boolean'
    || typeof checks.role !== 'boolean'
    || !(checks.matchesAgreed === null || typeof checks.matchesAgreed === 'boolean')) {
    malformed('A state read carries the results of every import check');
  }
  if ((checks.matchesAgreed === null) !== (agreed === null)) malformed('The agreed configuration was compared exactly when there is one');
  return {
    source: value.source,
    blockHeight: value.blockHeight,
    blockHash: value.blockHash,
    at: value.at,
    checks: {
      operations: checks.operations as MidnightLastCheck['checks']['operations'],
      committee: checks.committee as MidnightLastCheck['checks']['committee'],
      decoded: checks.decoded,
      role: checks.role,
      matchesAgreed: checks.matchesAgreed as boolean | null,
    },
  };
}

/** The import checks a state read must have passed before a candidate is stored or accepted. */
function assertImportChecks(check: MidnightLastCheck | null): void {
  if (!check) return;
  const { operations, decoded, role, matchesAgreed } = check.checks;
  if (operations === 'unknown-build') refuse('IMPORT_CHECK_FAILED', 'Not a known build: the contract has an operation no pinned build has');
  if (!decoded) refuse('IMPORT_CHECK_FAILED', 'The state does not decode with the build\'s reader');
  if (!role) refuse('IMPORT_CHECK_FAILED', 'This seed holds no role in the vault');
  if (matchesAgreed === false) refuse('IMPORT_CHECK_FAILED', 'The state is not the configuration verified in the ceremony');
}

interface VaultContext {
  readonly network: MidnightVaultNetwork;
  readonly contractAddress: string;
  readonly build: MidnightVaultBuild;
}

function readApproval(value: unknown, vault: VaultContext, digest: string): MidnightApprovalFile {
  if (!isObject<MidnightApprovalFile>(value)) malformed('An approval is an approval file');
  if (value.type !== MIDNIGHT_APPROVAL_FILE_TYPE || value.version !== MIDNIGHT_FILE_VERSION || !APPROVAL_ROLES.includes(value.role as string)) {
    malformed('An approval is a version 1 approval file');
  }
  if (value.network !== vault.network || value.contract !== vault.contractAddress || value.digest !== digest) {
    refuse('REQUEST_MISMATCH', 'An approval names another vault or another request');
  }
  if (!isUint(value.createdAt)) malformed('An approval\'s time is milliseconds since the epoch');
  if (jsonBytes(value) > MIDNIGHT_FILE_MAX_BYTES.approval) malformed(`An approval file is at most ${MIDNIGHT_FILE_MAX_BYTES.approval} bytes`);
  return jsonCopy(value as MidnightApprovalFile);
}

/** Owners and guardians sign with their Jubjub key, committee members with their upgrade key. */
function signerOf(approval: MidnightApprovalFile): string {
  const key = approval.role === 'committee' ? approval.upgrade?.key : approval.approvalKey;
  const shape = approval.role === 'committee' ? HEX32 : JUBJUB_HEX;
  if (typeof key !== 'string' || !shape.test(key)) malformed('An approval names its signer\'s key');
  return `${approval.role === 'committee' ? 'upgrade' : 'jubjub'}:${key}`;
}

function readStoredRequest(value: unknown, vault: VaultContext): MidnightStoredRequest {
  if (!isObject<MidnightStoredRequest>(value)) malformed('A stored request is an object');
  const request = value.request;
  if (!isObject<MidnightRequestFile>(request)) malformed('A stored request holds its request file');
  if (request.type !== MIDNIGHT_REQUEST_FILE_TYPE || request.version !== MIDNIGHT_FILE_VERSION
    || !(MIDNIGHT_REQUEST_KINDS as readonly unknown[]).includes(request.kind) || !isObject(request.body)) {
    malformed('A request is a version 1 request file');
  }
  if (request.network !== vault.network || request.contract !== vault.contractAddress || request.build !== vault.build.buildId) {
    refuse('REQUEST_MISMATCH', 'The request names another vault or another build');
  }
  if (!isHex32(request.digest) || !isUint(request.expiry) || !isUint(request.createdAt)) malformed('A request has its digest, expiry and time');
  if (jsonBytes(request) > MIDNIGHT_FILE_MAX_BYTES.request) malformed(`A request file is at most ${MIDNIGHT_FILE_MAX_BYTES.request} bytes`);
  const maxApprovals = vault.build.constants.ownerSlots + vault.build.constants.guardianSlots;
  if (!Array.isArray(value.approvals) || value.approvals.length > maxApprovals) malformed(`A request has at most ${maxApprovals} approvals`);
  const approvals = (value.approvals as readonly unknown[]).map(a => readApproval(a, vault, request.digest as string));
  const signers = approvals.map(signerOf);
  if (new Set(signers).size !== signers.length) malformed('One approval per signer');
  if (!REQUEST_STATES.includes(value.state as string)) malformed('Unknown request state');
  if (value.txHash !== undefined && !isHex32(value.txHash)) malformed('A transaction hash is 32 bytes of lowercase hex');
  if (!isUint(value.updatedAt)) malformed('A request\'s time is milliseconds since the epoch');
  return {
    request: jsonCopy(request as MidnightRequestFile),
    approvals,
    state: value.state as MidnightStoredRequest['state'],
    ...(value.txHash !== undefined ? { txHash: value.txHash as string } : {}),
    updatedAt: value.updatedAt,
  };
}

function readRequests(value: unknown, vault: VaultContext): MidnightStoredRequest[] {
  if (!Array.isArray(value) || value.length > MAX_REQUESTS) malformed(`A vault keeps at most ${MAX_REQUESTS} requests`);
  const requests = (value as readonly unknown[]).map(r => readStoredRequest(r, vault));
  if (new Set(requests.map(r => r.request.digest)).size !== requests.length) malformed('Two requests share a digest');
  return requests;
}

function checkLifecycle(record: MidnightVaultRecord): void {
  const { lifecycle, lastCheck, successor } = record;
  if (lifecycle === 'deploying') {
    if (record.origin !== 'created') refuse('LIFECYCLE_MISMATCH', 'Only a vault this device created is still deploying');
  } else if (!lastCheck) {
    refuse('LIFECYCLE_MISMATCH', 'A vault past deploying was read from the chain');
  } else {
    const { operations, committee } = lastCheck.checks;
    if (lifecycle === 'incomplete') {
      if (operations !== 'incomplete' && committee !== 'interim') refuse('LIFECYCLE_MISMATCH', 'A vault with every operation and past the interim committee is not incomplete');
    } else {
      if (operations === 'incomplete') refuse('LIFECYCLE_MISMATCH', 'A vault missing an operation is incomplete');
      if (lifecycle === 'ready' && committee === 'interim') refuse('LIFECYCLE_MISMATCH', 'A vault under its deployer\'s interim committee is incomplete');
    }
  }
  if (successor !== null) {
    if (!isHex32(successor) || successor === record.vaultId) malformed('A successor is another vault\'s id');
    if (lifecycle !== 'temporary' && lifecycle !== 'moved') refuse('LIFECYCLE_MISMATCH', 'Only a recovered or moved vault has a successor');
  } else if (lifecycle === 'moved') {
    refuse('LIFECYCLE_MISMATCH', 'A moved vault names its successor');
  }
}

/**
 * The whole record, read again from `draft` and checked: the result holds none of the caller's
 * objects and no field the record does not have.
 */
function checkRecord(draft: MidnightVaultRecord, options: Options): MidnightVaultRecord {
  const { vaultId, network, contractAddress } = draft;
  if (!isHex32(vaultId)) malformed('A vault id is 32 bytes of lowercase hex');
  if (!isNetwork(network)) malformed('A Midnight network is preprod, preview or mainnet');
  if (!isHex32(contractAddress)) malformed('A contract address is 32 bytes of lowercase hex');
  if (midnightVaultId(network, contractAddress) !== vaultId) {
    throw new MidnightVaultStoreError('VAULT_ID_MISMATCH', 'The vault id is not the one this network and contract address give');
  }
  const build = buildOf(draft.build, network, options);
  if (draft.status !== 'candidate' && draft.status !== 'accepted') malformed('A vault is a candidate or accepted');
  if (!ORIGINS.includes(draft.origin)) malformed('A vault was created, imported or restored');
  if (!LIFECYCLES.includes(draft.lifecycle)) malformed('Unknown lifecycle');
  const name = draft.name === undefined ? {} : { name: optionalLabel(draft.name).label as string };

  const participants = readParticipants(draft.participants, network, build, options);
  const self = readSelf(draft.self, participants);
  const agreedConfig = readAgreedConfig(draft.agreedConfig);
  const verifications = readVerifications(draft.verifications, participants, agreedConfig);
  const deployment = readDeployment(draft.deployment, build);
  const lastCheck = readLastCheck(draft.lastCheck, agreedConfig);
  const requests = readRequests(draft.requests, { network, contractAddress, build });
  if (requests.length > 0 && draft.status !== 'accepted') refuse('NOT_ACCEPTED', 'A candidate is never signed for, so it holds no requests');

  const { createdAt, updatedAt, acceptedAt } = draft;
  if (!isUint(createdAt) || !isUint(updatedAt) || updatedAt < createdAt) malformed('Times are milliseconds since the epoch');
  if ((draft.status === 'accepted') !== (acceptedAt !== null)) malformed('Only an accepted vault has an acceptance time');
  if (acceptedAt !== null && (!isUint(acceptedAt) || acceptedAt < createdAt)) malformed('Times are milliseconds since the epoch');

  const record: MidnightVaultRecord = {
    recordVersion: 1,
    vaultId,
    network,
    contractAddress,
    build: build.buildId,
    status: draft.status,
    origin: draft.origin,
    lifecycle: draft.lifecycle,
    ...name,
    self,
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

function assertVaultId(vaultId: unknown): asserts vaultId is string {
  if (!isHex32(vaultId)) malformed('A vault id is 32 bytes of lowercase hex');
}

function assertNetwork(network: unknown): asserts network is MidnightVaultNetwork {
  if (!isNetwork(network)) malformed('A Midnight network is preprod, preview or mainnet');
}

/** Strictly increasing, so a version a screen showed is never mistaken for a later one. */
function nextUpdatedAt(current: MidnightVaultRecord): number {
  return Math.max(Date.now(), current.updatedAt + 1);
}

// -------------------------------------------------------------------------------------------------
// The store

export function createMidnightVaultStore(storeOptions: MidnightVaultStoreOptions = {}): MidnightVaultStore {
  const options: Options = {
    builds: storeOptions.builds ?? [MIDNIGHT_VAULT_BUILDS.test, MIDNIGHT_VAULT_BUILDS.production],
    keyProblem: storeOptions.keyProblem,
    checkCard: storeOptions.checkCard,
  };
  const openDatabase = storeOptions.openDatabase ?? getDb;
  const check = (draft: MidnightVaultRecord) => checkRecord(draft, options);

  async function database(walletId: number): Promise<Dexie> {
    if (!Number.isSafeInteger(walletId) || walletId < 0) malformed('A wallet id is a non-negative integer');
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
   * Runs `work` in one transaction on both tables. Only Dexie calls and synchronous checks may run
   * inside it: awaiting anything else would end the transaction early.
   */
  async function withTables<T>(
    walletId: number,
    mode: 'r' | 'rw',
    work: (vaults: Table<MidnightVaultRecord, string>, indexes: Table<IndexRow, string>) => Promise<T>,
  ): Promise<T> {
    const db = await database(walletId);
    try {
      return await db.transaction(mode, [VAULTS, INDEXES], () => work(db.table<MidnightVaultRecord, string>(VAULTS), db.table<IndexRow, string>(INDEXES)));
    } catch (error) {
      if (error instanceof MidnightVaultStoreError) throw error;
      throw new MidnightVaultStoreError('STORE_UNAVAILABLE', 'The Midnight vaults of this wallet could not be read or written', { cause: error });
    }
  }

  function readable(row: MidnightVaultRecord): MidnightVaultRecord {
    if (row?.recordVersion !== 1) throw new MidnightVaultStoreError('STORE_UNAVAILABLE', 'A stored Midnight vault has a format this version cannot read');
    return row;
  }

  async function current(vaults: Table<MidnightVaultRecord, string>, vaultId: string): Promise<MidnightVaultRecord> {
    const row = await vaults.get(vaultId);
    if (!row) throw new MidnightVaultStoreError('NOT_FOUND', 'This wallet does not hold this vault');
    return readable(row);
  }

  async function highestIn(vaults: Table<MidnightVaultRecord, string>, indexes: Table<IndexRow, string>, network: MidnightVaultNetwork): Promise<number> {
    const counter = (await indexes.get(network))?.highestIndex ?? 0;
    const rows = (await vaults.where('network').equals(network).toArray()).map(readable);
    return Math.max(counter, ...rows.flatMap(row => row.self.map(s => s.index)));
  }

  /** Records this seed's indexes in a record as taken: an index is never handed out twice. */
  async function recordIndexes(indexes: Table<IndexRow, string>, record: MidnightVaultRecord): Promise<void> {
    const highest = Math.max(...record.self.map(s => s.index));
    const counter = (await indexes.get(record.network))?.highestIndex ?? 0;
    if (highest > counter) await indexes.put({ network: record.network, highestIndex: highest });
  }

  async function addCandidate(walletId: number, input: MidnightVaultCandidateInput): Promise<MidnightVaultRecord> {
    if (!isObject(input)) malformed('A candidate is an object');
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
      participants: input.participants,
      agreedConfig: input.agreedConfig ?? null,
      verifications: input.verifications ?? [],
      deployment: input.deployment ?? null,
      lastCheck: input.lastCheck ?? null,
      requests: [],
      successor: null,
      createdAt: now,
      updatedAt: now,
      acceptedAt: null,
    });
    // Nothing that failed an import check is stored.
    assertImportChecks(record.lastCheck);
    return withTables(walletId, 'rw', async (vaults, indexes) => {
      if (await vaults.get(record.vaultId)) throw new MidnightVaultStoreError('VAULT_EXISTS', 'This wallet already holds this vault');
      await vaults.add(record);
      await recordIndexes(indexes, record);
      return record;
    });
  }

  async function accept(walletId: number, vaultId: string, input: { readonly verifications?: readonly MidnightOwnerVerification[] } = {}): Promise<MidnightVaultRecord> {
    assertVaultId(vaultId);
    if (!isObject(input)) malformed('Acceptance input is an object');
    return withTables(walletId, 'rw', async vaults => {
      const row = await current(vaults, vaultId);
      if (row.status !== 'candidate') throw new MidnightVaultStoreError('NOT_A_CANDIDATE', 'This vault is already accepted');
      if (!ACCEPTABLE.includes(row.lifecycle)) refuse('VAULT_INCOMPLETE', 'A vault is accepted only once it is complete on chain');
      assertImportChecks(row.lastCheck);
      const now = nextUpdatedAt(row);
      const next = check({
        ...row,
        ...(input.verifications !== undefined ? { verifications: input.verifications } : {}),
        status: 'accepted',
        updatedAt: now,
        acceptedAt: now,
      });
      await vaults.put(next);
      return next;
    });
  }

  async function update(walletId: number, vaultId: string, patch: MidnightVaultRecordPatch): Promise<MidnightVaultRecord> {
    assertVaultId(vaultId);
    if (!isObject(patch)) malformed('A patch is an object');
    if (Object.keys(patch).some(key => !PATCH_KEYS.includes(key))) malformed('Only the fields of MidnightVaultRecordPatch change');
    return withTables(walletId, 'rw', async (vaults, indexes) => {
      const row = await current(vaults, vaultId);
      const draft: Mutable<MidnightVaultRecord> = { ...row };
      if (patch.name === null) delete draft.name;
      else if (patch.name !== undefined) draft.name = patch.name;
      if (patch.lifecycle !== undefined && patch.lifecycle !== row.lifecycle) {
        if (patch.lifecycle === 'deploying') refuse('LIFECYCLE_MISMATCH', 'A vault never goes back to deploying');
        if (row.lifecycle === 'moved') refuse('LIFECYCLE_MISMATCH', 'A moved vault stays moved');
        draft.lifecycle = patch.lifecycle;
      }
      if (patch.self !== undefined) draft.self = patch.self;
      if (patch.participants !== undefined) draft.participants = patch.participants;
      if (patch.agreedConfig !== undefined) draft.agreedConfig = patch.agreedConfig;
      if (patch.verifications !== undefined) draft.verifications = patch.verifications;
      if (patch.deployment !== undefined) draft.deployment = patch.deployment;
      if (patch.lastCheck !== undefined) draft.lastCheck = patch.lastCheck;
      if (patch.successor !== undefined) draft.successor = patch.successor;
      draft.updatedAt = nextUpdatedAt(row);
      const next = check(draft);
      await vaults.put(next);
      await recordIndexes(indexes, next);
      return next;
    });
  }

  async function putRequest(walletId: number, vaultId: string, request: MidnightStoredRequest): Promise<MidnightVaultRecord> {
    assertVaultId(vaultId);
    return withTables(walletId, 'rw', async vaults => {
      const row = await current(vaults, vaultId);
      const now = nextUpdatedAt(row);
      const stored = readStoredRequest(isObject(request) ? { ...request, updatedAt: now } : request, {
        network: row.network,
        contractAddress: row.contractAddress,
        build: buildOf(row.build, row.network, options),
      });
      const digest = stored.request.digest;
      let requests = row.requests.some(r => r.request.digest === digest)
        ? row.requests.map(r => (r.request.digest === digest ? stored : r))
        : [...row.requests, stored];
      if (requests.length > MAX_REQUESTS) {
        // Make room by dropping the oldest settled request; open and submitted ones stay.
        const settled = requests.filter(r => SETTLED_STATES.includes(r.state)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
        if (!settled) refuse('TOO_MANY_REQUESTS', `A vault keeps at most ${MAX_REQUESTS} requests, and none of them is settled`);
        requests = requests.filter(r => r !== settled);
      }
      const next = check({ ...row, requests, updatedAt: now });
      await vaults.put(next);
      return next;
    });
  }

  async function list(walletId: number, filter: MidnightVaultListFilter = {}): Promise<readonly MidnightVaultRecord[]> {
    if (!isObject(filter)) malformed('A filter is an object');
    const rows = await withTables(walletId, 'r', vaults => vaults.toArray());
    return rows
      .map(readable)
      .filter(row => (filter.status === undefined || row.status === filter.status) && (filter.network === undefined || row.network === filter.network))
      .sort((a, b) => a.createdAt - b.createdAt || (a.vaultId < b.vaultId ? -1 : a.vaultId > b.vaultId ? 1 : 0));
  }

  async function get(walletId: number, vaultId: string): Promise<MidnightVaultRecord | undefined> {
    assertVaultId(vaultId);
    const row = await withTables(walletId, 'r', vaults => vaults.get(vaultId));
    return row === undefined ? undefined : readable(row);
  }

  async function allocateIndex(walletId: number, network: MidnightVaultNetwork): Promise<number> {
    assertNetwork(network);
    return withTables(walletId, 'rw', async (vaults, indexes) => {
      const highest = await highestIn(vaults, indexes, network);
      if (highest >= MAX_INDEX) throw new MidnightVaultStoreError('INDEX_EXHAUSTED', 'Every index of this seed on this network is taken');
      await indexes.put({ network, highestIndex: highest + 1 });
      return highest + 1;
    });
  }

  async function highestIndex(walletId: number, network: MidnightVaultNetwork): Promise<number> {
    assertNetwork(network);
    return withTables(walletId, 'r', (vaults, indexes) => highestIn(vaults, indexes, network));
  }

  async function raiseIndex(walletId: number, network: MidnightVaultNetwork, index: number): Promise<void> {
    assertNetwork(network);
    if (!isUint(index) || index > MAX_INDEX) malformed('An index is from 0 to 2^31 - 1');
    await withTables(walletId, 'rw', async (_vaults, indexes) => {
      const counter = (await indexes.get(network))?.highestIndex ?? 0;
      if (index > counter) await indexes.put({ network, highestIndex: index });
    });
  }

  return Object.freeze({ list, get, addCandidate, accept, update, putRequest, allocateIndex, highestIndex, raiseIndex });
}

/** The store, over both pinned builds. The full key and card checks are wired in at integration. */
export const midnightVaultStore: MidnightVaultStore = createMidnightVaultStore();

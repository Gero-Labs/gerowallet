/**
 * GeroVault store: the vaults one wallet holds, in that wallet's `vaults` table (`schema.ts`,
 * version 12). The API and the record are in `src/modules/gerovault/contracts.ts`.
 *
 * Everything that can be checked here is checked on write, so a screen never has to trust a row:
 * - both scripts are canonical native scripts of a vault template, and of the same one;
 * - the vault id is the one the scripts and the network give;
 * - the participants are exactly the scripts' keys, each in the branch of their role, and one of
 *   them is this wallet;
 * - a manifest decodes, describes this vault and never goes back to an older revision;
 * - every verification record names a participant.
 *
 * This wallet's own index cannot be checked here (it needs the account key), but index 0 is refused
 * for now (see `addCandidate`). Every failure is a `VaultStoreError`, and a database that cannot be
 * read throws, never answers "no vaults".
 */
import { Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import type Dexie from 'dexie';
import type { Table } from 'dexie';
import { getDb } from '@/db/wallet-db';
import {
  MAX_BACKUP_KEYS,
  MAX_OWNERS,
  ROLE,
  decodeManifest,
  encodeVaultPublicKeys,
  isVaultIndex,
  parseVaultScript,
  readLabel,
  vaultId as vaultIdOf,
  vaultKeyHashes,
  vaultScript,
  type CosignerVerification,
  type ParsedVaultScript,
  type Role,
  type VaultNetwork,
  type VaultScript,
} from '@/shared/gerovault';
import type {
  StoredManifest,
  StoredVaultParticipant,
  VaultAcceptInput,
  VaultCandidateInput,
  VaultListFilter,
  VaultParticipantInput,
  VaultRecord,
  VaultRecordPatch,
  VaultStore,
  VaultStoreErrorCode,
} from '@/modules/gerovault/contracts';

export class VaultStoreError extends Error {
  readonly code: VaultStoreErrorCode;

  constructor(code: VaultStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VaultStoreError';
    this.code = code;
  }
}

const TABLE = 'vaults';
const HEX32 = /^[0-9a-f]{64}$/;
const HEX_CBOR = /^(?:[0-9a-f]{2})+$/;
const NETWORKS: readonly VaultNetwork[] = ['mainnet', 'preprod', 'preview'];
const ORIGINS: readonly string[] = ['created', 'imported', 'restored'];
const ROLES: readonly string[] = ['owner', 'backupHolder'];
const VERIFICATION_METHODS: readonly string[] = ['number', 'qr', 'external', 'endorsed', 'provider'];
/** 8 KiB per script, the manifest's own bound. */
const MAX_SCRIPT_HEX = 16384;
const MAX_PARTICIPANTS = MAX_OWNERS + MAX_BACKUP_KEYS;
const MAX_VERIFICATIONS = 256;
const PATCH_KEYS: readonly string[] = ['name', 'labels', 'manifest', 'verifications'];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type VaultIdentity = Pick<VaultRecord, 'vaultId' | 'network' | 'paymentScriptCbor' | 'stakeScriptCbor'>;

function invalid(message: string): never {
  throw new VaultStoreError('INVALID_INPUT', message);
}

function assertVaultId(vaultId: unknown): asserts vaultId is string {
  if (typeof vaultId !== 'string' || !HEX32.test(vaultId)) invalid('A vault id is 32 bytes of lowercase hex');
}

async function database(walletId: number): Promise<Dexie> {
  if (!Number.isSafeInteger(walletId) || walletId < 0) invalid('A wallet id is a non-negative integer');
  let db: Dexie | null;
  try {
    db = await getDb(walletId);
  } catch (error) {
    throw new VaultStoreError('STORE_UNAVAILABLE', 'The wallet database could not be opened', { cause: error });
  }
  if (!db) throw new VaultStoreError('STORE_UNAVAILABLE', 'The wallet database could not be opened');
  return db;
}

/**
 * Runs `work` in one transaction on the vaults table. Only Dexie calls and synchronous checks may
 * run inside it: awaiting anything else would end the transaction early.
 */
async function withVaults<T>(walletId: number, mode: 'r' | 'rw', work: (table: Table<VaultRecord, string>) => Promise<T>): Promise<T> {
  const db = await database(walletId);
  try {
    return await db.transaction(mode, TABLE, () => work(db.table<VaultRecord, string>(TABLE)));
  } catch (error) {
    if (error instanceof VaultStoreError) throw error;
    throw new VaultStoreError('STORE_UNAVAILABLE', 'The vaults of this wallet could not be read or written', { cause: error });
  }
}

function readScript(role: Role, cbor: unknown, what: string): { script: VaultScript; parsed: ParsedVaultScript } {
  if (typeof cbor !== 'string' || cbor.length > MAX_SCRIPT_HEX || !HEX_CBOR.test(cbor)) invalid(`The ${what} script is not lowercase hex CBOR`);
  let script: VaultScript;
  try {
    script = vaultScript(role, Serialization.NativeScript.fromCbor(HexBlob(cbor)).toCore());
  } catch {
    return invalid(`The ${what} script is not a native script`);
  }
  if (script.cbor !== cbor) invalid(`The ${what} script is not in canonical CBOR`);
  const parsed = parseVaultScript(script.script);
  if (!parsed) invalid(`The ${what} script is not a vault template`);
  return { script, parsed };
}

function backupKeys(script: ParsedVaultScript): readonly string[] {
  return script.kind === 'backup' ? script.backups : [];
}

function assertSameTemplate(payment: ParsedVaultScript, stake: ParsedVaultScript): void {
  const same = payment.kind === stake.kind
    && payment.threshold === stake.threshold
    && payment.owners.length === stake.owners.length
    && backupKeys(payment).length === backupKeys(stake).length
    && (payment.kind !== 'backup' || (stake.kind === 'backup'
      && payment.backupThreshold === stake.backupThreshold
      && payment.backupAfterSlot === stake.backupAfterSlot));
  if (!same) invalid('The payment and stake scripts are not the same template');
}

function optionalLabel(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined;
  const label = readLabel(value);
  if (label === undefined) invalid(`The ${what} is not a valid label`);
  return label;
}

function sameKeys(stored: readonly string[], script: readonly string[]): boolean {
  return stored.length === script.length && new Set(stored).size === stored.length && stored.every(hash => script.includes(hash));
}

async function readParticipants(
  inputs: unknown,
  payment: ParsedVaultScript,
  stake: ParsedVaultScript,
): Promise<StoredVaultParticipant[]> {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_PARTICIPANTS) invalid('A vault has 2 to 40 participants');
  const participants: StoredVaultParticipant[] = [];
  for (const input of inputs as readonly VaultParticipantInput[]) {
    if (!input || typeof input !== 'object' || !ROLES.includes(input.role)) invalid('A participant is an owner or a backup holder');
    let hashes: Awaited<ReturnType<typeof vaultKeyHashes>>;
    let encoded: ReturnType<typeof encodeVaultPublicKeys>;
    try {
      hashes = await vaultKeyHashes(input.vaultKeys);
      encoded = encodeVaultPublicKeys(input.vaultKeys);
    } catch {
      return invalid('A participant\'s keys are not a vault\'s public keys');
    }
    const label = optionalLabel(input.label, 'participant label');
    participants.push({
      role: input.role,
      credential: hashes.payment,
      stakeKeyHash: hashes.stake,
      vaultKeys: { payment: encoded.payment, stake: encoded.stake },
      ...(label !== undefined ? { label } : {}),
      self: input.self === true,
    });
  }
  if (participants.filter(p => p.self).length !== 1) invalid('Exactly one participant is this wallet');
  const owners = participants.filter(p => p.role === 'owner');
  const backups = participants.filter(p => p.role === 'backupHolder');
  if (!sameKeys(owners.map(p => p.credential), payment.owners)
    || !sameKeys(owners.map(p => p.stakeKeyHash), stake.owners)
    || !sameKeys(backups.map(p => p.credential), backupKeys(payment))
    || !sameKeys(backups.map(p => p.stakeKeyHash), backupKeys(stake))) {
    invalid('The participants are not exactly the keys of the scripts, each in the branch of their role');
  }
  return participants;
}

function readManifest(hex: unknown, vault: VaultIdentity): StoredManifest {
  if (typeof hex !== 'string') throw new VaultStoreError('MANIFEST_INVALID', 'A manifest is canonical CBOR, lowercase hex');
  const decoded = decodeManifest(hex);
  if (decoded.ok === false) throw new VaultStoreError('MANIFEST_INVALID', `The manifest does not decode (${decoded.code})`);
  const { manifest } = decoded;
  if (manifest.vaultId !== vault.vaultId || manifest.network !== vault.network
    || manifest.paymentScript !== vault.paymentScriptCbor || manifest.stakeScript !== vault.stakeScriptCbor) {
    throw new VaultStoreError('MANIFEST_INVALID', 'The manifest describes another vault');
  }
  return { cbor: decoded.cbor, hash: decoded.hash, version: manifest.version };
}

function assertNoRollback(current: StoredManifest | null, next: StoredManifest): void {
  if (!current) return;
  if (next.version < current.version || (next.version === current.version && next.hash !== current.hash)) {
    throw new VaultStoreError('MANIFEST_ROLLBACK', `The stored manifest is version ${current.version}; this one is older or another revision of it`);
  }
}

function readVerifications(value: unknown, participants: readonly StoredVaultParticipant[]): CosignerVerification[] {
  if (!Array.isArray(value) || value.length > MAX_VERIFICATIONS) invalid('Verification records are a list of at most 256');
  const credentials = new Set(participants.map(p => p.credential));
  for (const record of value as readonly CosignerVerification[]) {
    if (!record || typeof record !== 'object' || !VERIFICATION_METHODS.includes(record.method)) invalid('A verification record has an unknown method');
    if (!credentials.has(record.credential)) invalid('A verification record names someone who is not a participant');
    if (!Number.isSafeInteger(record.at) || record.at < 0) invalid('A verification record\'s time is unix seconds');
  }
  return [...(value as readonly CosignerVerification[])];
}

async function addCandidate(walletId: number, input: VaultCandidateInput): Promise<VaultRecord> {
  if (!input || typeof input !== 'object') invalid('A candidate is an object');
  if (!NETWORKS.includes(input.network)) invalid('A vault network is mainnet, preprod or preview');
  if (!ORIGINS.includes(input.origin)) invalid('A vault was created, imported or restored');
  if (!isVaultIndex(input.ownIndex)) invalid('This wallet\'s index is a CIP-1854 soft index');
  // Index 0 is the one 1854 key the generic signers may still use (vaultSignGuard.ts, rule 1). Until
  // knownVaultScriptHashes() reads this store, a vault at 0 would rely on rule 2 alone, which is empty.
  if (input.ownIndex === 0) invalid('Index 0 is left to the wallet\'s existing multisig key');
  assertVaultId(input.vaultId);
  const payment = readScript(ROLE.PAYMENT, input.paymentScriptCbor, 'payment');
  const stake = readScript(ROLE.STAKE, input.stakeScriptCbor, 'stake');
  assertSameTemplate(payment.parsed, stake.parsed);
  if (vaultIdOf({ payment: payment.script, stake: stake.script }, input.network) !== input.vaultId) {
    throw new VaultStoreError('VAULT_ID_MISMATCH', 'The vault id is not the one these scripts give on this network');
  }
  const participants = await readParticipants(input.participants, payment.parsed, stake.parsed);
  const name = optionalLabel(input.name, 'vault name');
  const identity: VaultIdentity = {
    vaultId: input.vaultId,
    network: input.network,
    paymentScriptCbor: input.paymentScriptCbor,
    stakeScriptCbor: input.stakeScriptCbor,
  };
  const manifest = input.manifest === undefined ? null : readManifest(input.manifest, identity);
  const verifications = readVerifications(input.verifications ?? [], participants);
  const now = Date.now();
  const record: VaultRecord = {
    recordVersion: 1,
    kind: 'native',
    ...identity,
    status: 'candidate',
    origin: input.origin,
    ...(name !== undefined ? { name } : {}),
    paymentScriptHash: payment.script.hash,
    stakeScriptHash: stake.script.hash,
    participants,
    ownIndex: input.ownIndex,
    manifest,
    verifications,
    createdAt: now,
    updatedAt: now,
    acceptedAt: null,
  };
  return withVaults(walletId, 'rw', async table => {
    if (await table.get(record.vaultId)) throw new VaultStoreError('VAULT_EXISTS', 'This wallet already holds this vault');
    await table.add(record);
    return record;
  });
}

async function accept(walletId: number, vaultId: string, input: VaultAcceptInput = {}): Promise<VaultRecord> {
  assertVaultId(vaultId);
  if (!input || typeof input !== 'object') invalid('Acceptance input is an object');
  return withVaults(walletId, 'rw', async table => {
    const current = await table.get(vaultId);
    if (!current) throw new VaultStoreError('NOT_FOUND', 'This wallet does not hold this vault');
    if (current.status !== 'candidate') throw new VaultStoreError('NOT_A_CANDIDATE', 'This vault is already accepted');
    let manifest = current.manifest;
    if (input.manifest !== undefined) {
      manifest = readManifest(input.manifest, current);
      assertNoRollback(current.manifest, manifest);
    }
    const verifications = input.verifications === undefined ? current.verifications : readVerifications(input.verifications, current.participants);
    const now = Date.now();
    const next: VaultRecord = { ...current, status: 'accepted', manifest, verifications, updatedAt: now, acceptedAt: now };
    await table.put(next);
    return next;
  });
}

async function update(walletId: number, vaultId: string, patch: VaultRecordPatch): Promise<VaultRecord> {
  assertVaultId(vaultId);
  if (!patch || typeof patch !== 'object') invalid('A patch is an object');
  if (Object.keys(patch).some(key => !PATCH_KEYS.includes(key))) invalid('Only the name, labels, manifest and verification records change');
  return withVaults(walletId, 'rw', async table => {
    const current = await table.get(vaultId);
    if (!current) throw new VaultStoreError('NOT_FOUND', 'This wallet does not hold this vault');
    const next: Mutable<VaultRecord> = { ...current };
    if (patch.name === null) delete next.name;
    else if (patch.name !== undefined) next.name = optionalLabel(patch.name, 'vault name');
    if (patch.labels !== undefined) {
      if (!patch.labels || typeof patch.labels !== 'object') invalid('Labels are a map from credential to label');
      const labels = patch.labels;
      for (const credential of Object.keys(labels)) {
        if (!current.participants.some(p => p.credential === credential)) invalid('A label names someone who is not a participant');
      }
      next.participants = current.participants.map(participant => {
        if (!Object.prototype.hasOwnProperty.call(labels, participant.credential)) return participant;
        const { label: _old, ...rest } = participant;
        const label = labels[participant.credential];
        return label === null ? rest : { ...rest, label: optionalLabel(label, 'participant label') };
      });
    }
    if (patch.manifest !== undefined) {
      const manifest = readManifest(patch.manifest, current);
      assertNoRollback(current.manifest, manifest);
      next.manifest = manifest;
    }
    if (patch.verifications !== undefined) next.verifications = readVerifications(patch.verifications, current.participants);
    next.updatedAt = Date.now();
    await table.put(next);
    return next;
  });
}

async function list(walletId: number, filter: VaultListFilter = {}): Promise<readonly VaultRecord[]> {
  const rows = await withVaults(walletId, 'r', table => table.toArray());
  return rows
    .filter(row => (filter.status === undefined || row.status === filter.status) && (filter.network === undefined || row.network === filter.network))
    .sort((a, b) => a.createdAt - b.createdAt || (a.vaultId < b.vaultId ? -1 : a.vaultId > b.vaultId ? 1 : 0));
}

async function get(walletId: number, vaultId: string): Promise<VaultRecord | undefined> {
  assertVaultId(vaultId);
  return withVaults(walletId, 'r', table => table.get(vaultId));
}

export const vaultStore: VaultStore = Object.freeze({ list, get, addCandidate, accept, update });

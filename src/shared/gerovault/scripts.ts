/**
 * Native scripts of a phase 1 vault (spec 4.1).
 *
 *   standard  payment  atLeast t [ sig(owner_i role 0 key at y) ]
 *             stake    atLeast t [ sig(owner_i role 2 key at y) ]
 *   backup    any [ atLeast t owners, all [ atLeast b backupKeys, after slot ] ]   (GV-69)
 *
 * No script-wide time bound in the standard template: inside the script it would lock the
 * address, deposits and rewards included, for good after the slot (spec 4.1).
 *
 * Key order: neither CIP-1854 nor CIP-0146 fixes the order of the keys inside a script (CIP-1854
 * leaves templates to the application). A new vault therefore sorts the key hashes of each script
 * by their bytes, so every cosigner who builds the vault from the same keys gets the same bytes and
 * the same address. `instantiateVaultScripts` keeps a given order, for rebuilding a script someone
 * else registered.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { GeroVaultError } from './errors';
import { deriveParticipantKeyHashes } from './keys';
import { assertVaultIndex } from './paths';
import {
  BackupTemplate,
  ParticipantKeyHashes,
  ROLE,
  Role,
  SharedRoleKeys,
  VaultAddresses,
  VaultNetwork,
  VaultScript,
  VaultScripts,
  VaultTemplate,
  VaultWarning,
} from './types';

/**
 * Owner bounds: a threshold of at least 2 (a 1-of-n vault is not shared custody), so at least two
 * owners, and at most `MAX_OWNERS = 20` (spec 4.2.3, applied to native vaults too).
 */
export const MIN_THRESHOLD = 2;
export const MIN_OWNERS = MIN_THRESHOLD;
export const MAX_OWNERS = 20;
/** Backup holders of the dated backup path: one may be enough (inheritance), at most 20. */
export const MIN_BACKUP_KEYS = 1;
export const MAX_BACKUP_KEYS = 20;

const KEY_HASH = /^[0-9a-f]{56}$/;

const NETWORK_ID: Record<VaultNetwork, Cardano.NetworkId> = {
  mainnet: Cardano.NetworkId.Mainnet,
  preprod: Cardano.NetworkId.Testnet,
  preview: Cardano.NetworkId.Testnet,
};

/** A vault description by key hashes. `backups` belongs to the backup template only. */
export interface VaultSpec {
  readonly template: VaultTemplate;
  readonly owners: readonly ParticipantKeyHashes[];
  readonly backups?: readonly ParticipantKeyHashes[];
}

/** The key hashes of one script, in script order. */
export interface ScriptKeyHashes {
  readonly owners: readonly Ed25519KeyHashHex[];
  readonly backups: readonly Ed25519KeyHashHex[];
}

/** What `parseVaultScript` recognises in a native script. */
export type ParsedVaultScript =
  | { readonly kind: 'standard'; readonly threshold: number; readonly owners: readonly Ed25519KeyHashHex[] }
  | {
      readonly kind: 'backup';
      readonly threshold: number;
      readonly owners: readonly Ed25519KeyHashHex[];
      readonly backupThreshold: number;
      readonly backups: readonly Ed25519KeyHashHex[];
      readonly backupAfterSlot: number;
    };

function fail(code: ConstructorParameters<typeof GeroVaultError>[0], message: string): never {
  throw new GeroVaultError(code, message);
}

function isCount(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function assertKeyHash(value: unknown): asserts value is Ed25519KeyHashHex {
  if (typeof value !== 'string' || !KEY_HASH.test(value)) {
    fail('INVALID_KEY_HASH', 'A key hash is 28 bytes of lowercase hex');
  }
}

function assertDistinct(hashes: readonly string[], what: string): void {
  if (new Set(hashes).size !== hashes.length) fail('DUPLICATE_KEY', `The same ${what} key appears twice`);
}

/** Warnings the caller must acknowledge for this spec (see `VaultWarning`). */
export function vaultSpecWarnings(spec: VaultSpec): VaultWarning[] {
  const owners = Array.isArray(spec?.owners) ? spec.owners.length : 0;
  return spec?.template?.kind === 'standard' && spec.template.threshold === owners ? ['ALL_OWNERS_REQUIRED'] : [];
}

/** Options of the builders. */
export interface BuildOptions {
  /** Warnings from `vaultSpecWarnings` the user has acknowledged. */
  readonly acknowledged?: readonly VaultWarning[];
}

function assertAcknowledged(spec: VaultSpec, options: BuildOptions | undefined): VaultWarning[] {
  const warnings = vaultSpecWarnings(spec);
  const acknowledged = Array.isArray(options?.acknowledged) ? options.acknowledged : [];
  const missing = warnings.filter(w => !acknowledged.includes(w));
  if (missing.length > 0) fail('WARNING_NOT_ACKNOWLEDGED', `Not acknowledged: ${missing.join(', ')}`);
  return warnings;
}

/** Throws a `GeroVaultError` naming the first rule the spec breaks. */
export function validateVaultSpec(spec: VaultSpec): void {
  const template = spec?.template;
  if (template?.kind !== 'standard' && template?.kind !== 'backup') {
    fail('UNKNOWN_TEMPLATE', 'A vault template is standard or backup');
  }
  const owners = Array.isArray(spec.owners) ? spec.owners : [];
  const backups = Array.isArray(spec.backups) ? spec.backups : [];
  if (owners.length < MIN_OWNERS) fail('TOO_FEW_OWNERS', `A vault has at least ${MIN_OWNERS} owners`);
  if (owners.length > MAX_OWNERS) fail('TOO_MANY_OWNERS', `A vault has at most ${MAX_OWNERS} owners`);
  if (Number.isInteger(template.threshold) && template.threshold < MIN_THRESHOLD) {
    fail('THRESHOLD_TOO_LOW', `The threshold is at least ${MIN_THRESHOLD}`);
  }
  if (!isCount(template.threshold, MIN_THRESHOLD, owners.length)) {
    fail('THRESHOLD_OUT_OF_RANGE', `The threshold is between ${MIN_THRESHOLD} and ${owners.length}`);
  }
  for (const p of [...owners, ...backups]) {
    assertKeyHash(p?.payment);
    assertKeyHash(p?.stake);
  }
  if (template.kind === 'standard') {
    if (backups.length > 0) fail('UNEXPECTED_BACKUP_KEYS', 'The standard template has no backup keys');
  } else {
    validateBackup(template, backups);
    const ownerKeys = new Set(owners.flatMap(p => [p.payment, p.stake]));
    if (backups.some(p => ownerKeys.has(p.payment) || ownerKeys.has(p.stake))) {
      fail('BACKUP_OVERLAPS_OWNER', 'A backup key is also an owner key of this vault');
    }
  }
  assertDistinct([...owners, ...backups].map(p => p.payment), 'payment');
  assertDistinct([...owners, ...backups].map(p => p.stake), 'stake');
}

function validateBackup(template: BackupTemplate, backups: readonly ParticipantKeyHashes[]): void {
  if (backups.length < MIN_BACKUP_KEYS) fail('BACKUP_KEYS_REQUIRED', 'The backup template needs backup keys');
  if (backups.length > MAX_BACKUP_KEYS) fail('TOO_MANY_BACKUP_KEYS', `At most ${MAX_BACKUP_KEYS} backup keys`);
  if (!isCount(template.backupThreshold, 1, backups.length)) {
    fail('BACKUP_THRESHOLD_OUT_OF_RANGE', `The backup threshold is between 1 and ${backups.length}`);
  }
  if (!isCount(template.backupAfterSlot, 1, Number.MAX_SAFE_INTEGER)) {
    fail('BACKUP_SLOT_REQUIRED', 'The backup template needs the absolute slot its backup path opens at');
  }
}

const sig = (keyHash: Ed25519KeyHashHex): Cardano.RequireSignatureScript => ({
  __type: Cardano.ScriptType.Native,
  kind: Cardano.NativeScriptKind.RequireSignature,
  keyHash,
});

const atLeast = (required: number, keys: readonly Ed25519KeyHashHex[]): Cardano.RequireAtLeastScript => ({
  __type: Cardano.ScriptType.Native,
  kind: Cardano.NativeScriptKind.RequireNOf,
  required,
  scripts: keys.map(sig),
});

function templateScript(template: VaultTemplate, keys: ScriptKeyHashes): Cardano.NativeScript {
  const owners = atLeast(template.threshold, keys.owners);
  if (template.kind === 'standard') return owners;
  return {
    __type: Cardano.ScriptType.Native,
    kind: Cardano.NativeScriptKind.RequireAnyOf,
    scripts: [
      owners,
      {
        __type: Cardano.ScriptType.Native,
        kind: Cardano.NativeScriptKind.RequireAllOf,
        scripts: [
          atLeast(template.backupThreshold, keys.backups),
          {
            __type: Cardano.ScriptType.Native,
            kind: Cardano.NativeScriptKind.RequireTimeAfter,
            slot: Cardano.Slot(template.backupAfterSlot),
          },
        ],
      },
    ],
  };
}

/** Canonical CBOR and hash of a native script (`blake2b-224(0x00 || cbor)`, via the SDK). */
export function vaultScript(role: Role, script: Cardano.NativeScript): VaultScript {
  const serialized = Serialization.NativeScript.fromCore(script);
  return Object.freeze({ role, script, cbor: serialized.toCbor(), hash: Hash28ByteBase16(serialized.hash()) });
}

const byBytes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Instantiates the template with the key hashes in the order given (validated first). For a new
 * vault use `buildVaultScripts`, which sorts.
 */
export function instantiateVaultScripts(
  spec: VaultSpec,
  order: { readonly payment: ScriptKeyHashes; readonly stake: ScriptKeyHashes },
  options?: BuildOptions,
): VaultScripts {
  validateVaultSpec(spec);
  const warnings = assertAcknowledged(spec, options);
  const owners = spec.owners;
  const backups = spec.backups ?? [];
  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort(byBytes).every((h, i) => h === [...b].sort(byBytes)[i]);
  if (!sameSet(order.payment.owners, owners.map(p => p.payment)) || !sameSet(order.payment.backups, backups.map(p => p.payment))
    || !sameSet(order.stake.owners, owners.map(p => p.stake)) || !sameSet(order.stake.backups, backups.map(p => p.stake))) {
    fail('INVALID_KEY_HASH', 'The script order names other keys than the vault');
  }
  return Object.freeze({
    template: Object.freeze({ ...spec.template }),
    warnings: Object.freeze(warnings),
    owners: Object.freeze([...owners]),
    backups: Object.freeze([...backups]),
    payment: vaultScript(ROLE.PAYMENT, templateScript(spec.template, order.payment)),
    stake: vaultScript(ROLE.STAKE, templateScript(spec.template, order.stake)),
  });
}

/** Builds a new vault's payment and stake scripts, each script's key hashes sorted by bytes. */
export function buildVaultScripts(spec: VaultSpec, options?: BuildOptions): VaultScripts {
  validateVaultSpec(spec);
  const backups = spec.backups ?? [];
  const sorted = (hashes: Ed25519KeyHashHex[]) => hashes.sort(byBytes);
  return instantiateVaultScripts(
    {
      template: spec.template,
      owners: [...spec.owners].sort((a, b) => byBytes(a.payment, b.payment)),
      backups: [...backups].sort((a, b) => byBytes(a.payment, b.payment)),
    },
    {
      payment: { owners: sorted(spec.owners.map(p => p.payment)), backups: sorted(backups.map(p => p.payment)) },
      stake: { owners: sorted(spec.owners.map(p => p.stake)), backups: sorted(backups.map(p => p.stake)) },
    },
    options,
  );
}

/**
 * Derives every participant's keys at vault index `index` and builds the vault. The same index
 * is used for all participants and both roles (CIP-1854 instantiation rules 1 and 2), backup
 * holders included: their keys are at `0/y` and `2/y` like the owners', so a backup holder's own
 * seed scan finds the vault.
 */
export async function buildVaultFromRoleKeys(input: {
  readonly template: VaultTemplate;
  readonly owners: readonly SharedRoleKeys[];
  readonly backups?: readonly SharedRoleKeys[];
  readonly index: number;
  readonly acknowledged?: readonly VaultWarning[];
}): Promise<VaultScripts> {
  assertVaultIndex(input.index);
  const derive = (keys: readonly SharedRoleKeys[] | undefined) =>
    Promise.all((keys ?? []).map(k => deriveParticipantKeyHashes(k, input.index)));
  const [owners, backups] = await Promise.all([derive(input.owners), derive(input.backups)]);
  return buildVaultScripts({ template: input.template, owners, backups }, { acknowledged: input.acknowledged });
}

function networkId(network: VaultNetwork): Cardano.NetworkId {
  const id = Object.prototype.hasOwnProperty.call(NETWORK_ID, network) ? NETWORK_ID[network] : undefined;
  if (id === undefined) fail('UNKNOWN_NETWORK', 'A vault network is mainnet, preprod or preview');
  return id;
}

/** Base address (script payment, script stake) and reward address of a vault. */
export function vaultAddresses(vault: Pick<VaultScripts, 'payment' | 'stake'>, network: VaultNetwork): VaultAddresses {
  const id = networkId(network);
  const credential = (s: VaultScript): Cardano.Credential => ({ type: Cardano.CredentialType.ScriptHash, hash: s.hash });
  const base = Cardano.BaseAddress.fromCredentials(id, credential(vault.payment), credential(vault.stake));
  const reward = Cardano.RewardAddress.fromCredentials(id, credential(vault.stake));
  return Object.freeze({
    base: Cardano.PaymentAddress(base.toAddress().toBech32()),
    reward: Cardano.RewardAccount(reward.toAddress().toBech32()),
  });
}

function signatureKeys(script: Cardano.NativeScript): Ed25519KeyHashHex[] | undefined {
  if (script.kind !== Cardano.NativeScriptKind.RequireNOf || script.scripts.length === 0) return undefined;
  const keys: Ed25519KeyHashHex[] = [];
  for (const child of script.scripts) {
    if (child.kind !== Cardano.NativeScriptKind.RequireSignature) return undefined;
    keys.push(child.keyHash);
  }
  return isCount(script.required, 1, keys.length) ? keys : undefined;
}

/**
 * Recognises the two vault templates in a native script, exactly as `buildVaultScripts` writes
 * them (any key order). Anything else, including n-of-n `all` scripts other wallets write, is
 * `undefined`.
 */
export function parseVaultScript(script: Cardano.NativeScript): ParsedVaultScript | undefined {
  if (!script || script.__type !== Cardano.ScriptType.Native) return undefined;
  const owners = signatureKeys(script);
  if (owners && script.kind === Cardano.NativeScriptKind.RequireNOf) {
    return { kind: 'standard', threshold: script.required, owners };
  }
  if (script.kind !== Cardano.NativeScriptKind.RequireAnyOf || script.scripts.length !== 2) return undefined;
  const [quorum, backupPath] = script.scripts;
  const ownerKeys = signatureKeys(quorum);
  if (!ownerKeys || quorum.kind !== Cardano.NativeScriptKind.RequireNOf) return undefined;
  if (backupPath.kind !== Cardano.NativeScriptKind.RequireAllOf || backupPath.scripts.length !== 2) return undefined;
  const [backupQuorum, after] = backupPath.scripts;
  const backupKeys = signatureKeys(backupQuorum);
  if (!backupKeys || backupQuorum.kind !== Cardano.NativeScriptKind.RequireNOf) return undefined;
  if (after.kind !== Cardano.NativeScriptKind.RequireTimeAfter || !isCount(after.slot, 1, Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }
  return {
    kind: 'backup',
    threshold: quorum.required,
    owners: ownerKeys,
    backupThreshold: backupQuorum.required,
    backups: backupKeys,
    backupAfterSlot: after.slot,
  };
}

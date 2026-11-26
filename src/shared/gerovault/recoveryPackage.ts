/**
 * Recovery package export and restore (spec 6.8, GV-14): with their seed and their own package,
 * one participant (owner, backup holder or guardian) rebuilds the vault and can build and submit
 * a spend through any provider, with every Gero service unavailable (the vendor-independence
 * release gate, spec 14).
 *
 * - Export encodes the payload (`recoveryPayload.ts`), checks that its native scripts rebuild from
 *   its keys, seals it (`recoveryFormat.ts`), then opens the file once with the passphrase and
 *   compares the plaintext, so a package is never handed out that its passphrase does not open.
 * - Restore opens the file, checks that the restoring seed's keys are the exporter's, rebuilds the
 *   native scripts with the core rebuild (`registration.ts`) from the package's keys and the
 *   seed's own, derives the address and the vault identifier, and compares the scripts with what
 *   the chain shows. Nothing is a vault before all of that passes.
 *
 * Like the core's scans, this file does no network I/O: the chain facts are the caller's input,
 * gathered from any provider for the package's network.
 *
 * Plutus vaults: applying the seed to the audited validator template to derive `h` (spec 4.2.1,
 * GV-64) needs that template, which does not exist yet. A Plutus package decodes, and its
 * restoring seed is checked, but the restore stops at `PLUTUS_TEMPLATE_UNAVAILABLE` rather than
 * trusting a recorded hash.
 *
 * Every function here returns typed refusals for untrusted input and never changes its inputs, so
 * a refused restore loses nothing: the file, the passphrase and whatever the wallet already holds
 * are untouched.
 */
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { bech32 } from 'bech32';
import { bytesToHex, hexToBytes } from './cbor';
import { GeroVaultError } from './errors';
import {
  BECH32_PREFIX,
  deriveVaultKey,
  deriveVaultPublicKeys,
  parseExternalCosignerKeys,
  parseVaultPublicKeys,
  vaultKeyHashes,
} from './keys';
import {
  RecoveryFileRefusal,
  RecoveryHeader,
  SealOptions,
  openRecoveryFile,
  recoveryPassphraseBytes,
  sealRecoveryFile,
} from './recoveryFormat';
import {
  BackupTerms,
  DecodeRecoveryPayloadResult,
  ManifestRevision,
  NativeVaultRecord,
  PackageParticipant,
  PackageRole,
  RecoveryPackage,
  RecoveryPackageContents,
  decodeRecoveryPayload,
  encodeRecoveryPayload,
  manifestHash,
} from './recoveryPayload';
import { DecodedRegistration, EXTERNAL_SCAN_MAX, RebuildParticipant, dedupeRegistrations, rebuildFromRegistration } from './registration';
import { vaultAddresses } from './scripts';
import { vaultId } from './vaultId';
import { ROLE, RoleKeys, VaultAddresses, VaultNetwork, VaultPublicKeys, VaultScripts, VaultWarning } from './types';

// ---------------------------------------------------------------------------------------------
// Opening

export type OpenRecoveryPackageResult =
  | { readonly ok: true; readonly header: RecoveryHeader; readonly package: RecoveryPackage }
  | RecoveryFileRefusal
  | Extract<DecodeRecoveryPayloadResult, { ok: false }>;

/**
 * Opens and decodes a package file. Never throws. A refusal says why: not a package, an unknown
 * format or payload version, truncated, too large, weak or out-of-range key derivation
 * parameters, a wrong passphrase, a tampered file or an invalid payload.
 *
 * The package's vault facts are claims until `restoreVaultFromPackage` checks them.
 */
export async function openRecoveryPackage(file: unknown, passphrase: unknown): Promise<OpenRecoveryPackageResult> {
  const opened = await openRecoveryFile(file, passphrase);
  if (opened.ok !== true) return opened;
  const decoded = decodeRecoveryPayload(opened.payload);
  if (decoded.ok !== true) return decoded;
  return { ok: true, header: opened.header, package: decoded.package };
}

// ---------------------------------------------------------------------------------------------
// Consistency of a native package: its scripts are the template over its keys

type Refusal<C extends string> = { readonly ok: false; readonly code: C; readonly detail?: string };

const refusal = <C extends string>(code: C, detail?: string): Refusal<C> =>
  Object.freeze({ ok: false as const, code, ...(detail ? { detail } : {}) });

const toVaultPublicKeys = (payment: string, stake: string): VaultPublicKeys =>
  parseVaultPublicKeys({
    payment: bech32.encode(BECH32_PREFIX.PAYMENT_VK, bech32.toWords(hexToBytes(payment) as Uint8Array), 1023),
    stake: bech32.encode(BECH32_PREFIX.STAKE_VK, bech32.toWords(hexToBytes(stake) as Uint8Array), 1023),
  });

type NativePackage = RecoveryPackageContents & { readonly vault: NativeVaultRecord };

interface NativeRebuild {
  readonly ok: true;
  readonly vault: VaultScripts;
  readonly canonicalOrder: boolean;
}

/** Whether an external wallet's extended key derives the recorded vault keys at one of its indexes. */
async function externalMatches(p: PackageParticipant): Promise<boolean> {
  let roleKeys: RoleKeys;
  try {
    roleKeys = await parseExternalCosignerKeys(p.external as Parameters<typeof parseExternalCosignerKeys>[0]);
  } catch {
    return false;
  }
  for (let i = 0; i <= EXTERNAL_SCAN_MAX; i++) {
    const keys = await deriveVaultPublicKeys(roleKeys, i);
    if (keys.payment === p.payment && keys.stake === p.stake) return true;
  }
  return false;
}

/**
 * Rebuilds a native package's scripts from its participants' vault keys with the core rebuild,
 * the exporter's keys replaced by `own` when given, and checks roles, backup terms and external
 * keys against the result.
 */
async function rebuildNative(pkg: NativePackage, own?: VaultPublicKeys): Promise<NativeRebuild | Refusal<'PACKAGE_INCONSISTENT'>> {
  const participants: RebuildParticipant[] = pkg.participants.map((p, i) => ({
    kind: 'vaultKeys',
    keys: i === pkg.self.position && own ? own : toVaultPublicKeys(p.payment, p.stake as string),
  }));
  // The package's two scripts, given to the core rebuild as a registration with no description.
  const registration: DecodedRegistration = {
    encryption: 'none',
    scripts: [pkg.vault.payment, pkg.vault.stake],
    payment: pkg.vault.payment,
    stake: pkg.vault.stake,
    participants: {},
  };
  const rebuilt = await rebuildFromRegistration(registration, participants);
  if (rebuilt.ok !== true) return refusal('PACKAGE_INCONSISTENT', `rebuild: ${rebuilt.code}`);

  const owners = new Set(rebuilt.owners);
  const backups = new Set(rebuilt.backups);
  const roleOf = (i: number): PackageRole | undefined => (owners.has(i) ? 'owner' : backups.has(i) ? 'backup' : undefined);
  if (pkg.participants.some((p, i) => roleOf(i) !== p.role)) return refusal('PACKAGE_INCONSISTENT', 'roles differ from the scripts');

  const template = rebuilt.vault.template;
  const terms = pkg.vault.backup;
  if (template.kind === 'backup') {
    if (!terms || terms.threshold !== template.backupThreshold || terms.afterSlot !== template.backupAfterSlot) {
      return refusal('PACKAGE_INCONSISTENT', 'backup terms differ from the scripts');
    }
  } else if (terms !== undefined) {
    return refusal('PACKAGE_INCONSISTENT', 'backup terms without a backup path');
  }

  for (const p of pkg.participants) {
    if (p.external !== undefined && !(await externalMatches(p))) {
      return refusal('PACKAGE_INCONSISTENT', 'an external key does not derive its vault keys');
    }
  }
  return { ok: true, vault: rebuilt.vault, canonicalOrder: rebuilt.canonicalOrder };
}

// ---------------------------------------------------------------------------------------------
// Export

/**
 * Builds the encrypted package file. Throws `GeroVaultError`: `INVALID_PASSPHRASE` for a
 * passphrase that cannot be one, `INVALID_PACKAGE` for contents that break a rule of the payload
 * or whose native scripts do not rebuild from their keys, and `PACKAGE_CHECK_FAILED` if the sealed
 * file does not open again with the passphrase to the same payload. `options` is for tests only.
 *
 * The passphrase rules beyond "non-empty" (length, strength) belong to the screen that asks for it.
 */
export async function exportRecoveryPackage(
  contents: RecoveryPackageContents,
  passphrase: string,
  options?: SealOptions,
): Promise<Uint8Array> {
  if (!recoveryPassphraseBytes(passphrase)) {
    throw new GeroVaultError('INVALID_PASSPHRASE', 'A passphrase is a non-empty, well-formed string');
  }
  const payload = encodeRecoveryPayload(contents);
  const decoded = decodeRecoveryPayload(payload);
  if (decoded.ok !== true) throw new GeroVaultError('INVALID_PACKAGE', `The payload does not decode: ${decoded.detail ?? decoded.code}`);
  if (decoded.package.vault.kind === 'native') {
    const rebuilt = await rebuildNative(decoded.package as NativePackage);
    if (rebuilt.ok !== true) throw new GeroVaultError('INVALID_PACKAGE', `The scripts do not rebuild from the keys: ${rebuilt.detail}`);
  }
  const file = await sealRecoveryFile(payload, passphrase, options);
  const reopened = await openRecoveryFile(file, passphrase);
  if (reopened.ok !== true || reopened.payload.length !== payload.length || !reopened.payload.every((b, i) => b === payload[i])) {
    throw new GeroVaultError('PACKAGE_CHECK_FAILED', 'The package does not open again with its passphrase');
  }
  return file;
}

// ---------------------------------------------------------------------------------------------
// Restore

/**
 * What the chain shows, from any provider, for the package's network. Untrusted: everything is
 * hashed and compared here.
 * - `registrations`: CIP-0146 registrations found for the vault, by a discovery scan of the
 *   restoring participant's keys or by the package's script hashes, each decoded by
 *   `decodeRegistration`. Anyone can publish one, so they confirm scripts, never consent.
 * - `revealedScripts`: native scripts the chain revealed (witness sets, auxiliary data, reference
 *   scripts), CBOR hex, for example looked up by the package's two script hashes.
 */
export interface RecoveryChainFacts {
  readonly network: VaultNetwork;
  readonly registrations: readonly DecodedRegistration[];
  readonly revealedScripts?: readonly string[];
}

export interface RestoreOptions {
  /** The restoring participant's own CIP-1854 role keys, derived from their seed. */
  readonly roleKeys: RoleKeys;
  readonly chain: RecoveryChainFacts;
}

export type RestoreRefusalCode =
  | 'INVALID_INPUT'
  /** The chain facts are for another network than the package's. */
  | 'NETWORK_MISMATCH'
  /** The restoring seed's keys at the package's index are not the exporter's keys. */
  | 'SEED_MISMATCH'
  /** The package's scripts do not rebuild from its keys, or its roles, backup terms or external keys disagree with them. */
  | 'PACKAGE_INCONSISTENT'
  /** Nothing on chain carries the package's scripts. */
  | 'NOT_ON_CHAIN'
  /** The chain shows the vault's scripts or the restoring participant's keys at this index otherwise than the package. */
  | 'CHAIN_MISMATCH'
  /** A Plutus vault, whose derivation needs the audited template (GV-64). */
  | 'PLUTUS_TEMPLATE_UNAVAILABLE';

export interface RestoredVault {
  readonly kind: 'native';
  readonly network: VaultNetwork;
  readonly vaultId: string;
  readonly scripts: VaultScripts;
  readonly addresses: VaultAddresses;
  readonly self: { readonly position: number; readonly index: number; readonly role: PackageRole };
  readonly backup?: BackupTerms;
  /** The warnings the vault carries (`ALL_OWNERS_REQUIRED`), for the screen to show. */
  readonly warnings: readonly VaultWarning[];
  /** What on chain carried both scripts. */
  readonly evidence: 'registration' | 'revealed';
  /** The scripts' key order is the one `buildVaultScripts` writes. */
  readonly canonicalOrder: boolean;
}

export type RestoreResult = { readonly ok: true; readonly vault: RestoredVault } | Refusal<RestoreRefusalCode>;

const MAX_REVEALED_SCRIPTS = 64;
const MAX_REVEALED_SCRIPT_BYTES = 16384;

/** A native script's hash, `blake2b-224(0x00 || cbor)`, over the bytes as given. */
function nativeScriptHash(bytes: Uint8Array): string {
  const tagged = new Uint8Array(bytes.length + 1);
  tagged.set(bytes, 1);
  return bytesToHex(blake2b(tagged, { dkLen: 28 }));
}

function keyHashesIn(script: VaultScripts['payment']['script'] | undefined, out = new Set<string>()): Set<string> {
  if (!script) return out;
  if ('keyHash' in script) out.add(script.keyHash);
  if ('scripts' in script) script.scripts.forEach(s => keyHashesIn(s, out));
  return out;
}

type ChainCheck = { readonly ok: true; readonly evidence: RestoredVault['evidence'] } | Refusal<'INVALID_INPUT' | 'NOT_ON_CHAIN' | 'CHAIN_MISMATCH'>;

function checkChain(
  vault: VaultScripts,
  own: { readonly payment: Ed25519KeyHashHex; readonly stake: Ed25519KeyHashHex },
  chain: RecoveryChainFacts,
): ChainCheck {
  if (!Array.isArray(chain.registrations)) return refusal('INVALID_INPUT', 'registrations');
  const revealed = chain.revealedScripts ?? [];
  if (!Array.isArray(revealed) || revealed.length > MAX_REVEALED_SCRIPTS) return refusal('INVALID_INPUT', 'revealed scripts');
  const ours = { payment: vault.payment.hash as string, stake: vault.stake.hash as string };
  const hashes = new Set<string>();
  for (const hex of revealed) {
    const bytes = hexToBytes(hex);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_REVEALED_SCRIPT_BYTES) return refusal('INVALID_INPUT', 'a revealed script is not CBOR hex');
    hashes.add(nativeScriptHash(bytes));
  }

  let conflict = false;
  for (const r of dedupeRegistrations(chain.registrations)) {
    const paymentSame = r.payment.hash === ours.payment;
    const stakeSame = r.stake?.hash === ours.stake;
    if (paymentSame && stakeSame) return { ok: true, evidence: 'registration' };
    const paymentOther = !paymentSame;
    const stakeOther = r.stake !== undefined && !stakeSame;
    // One of this vault's scripts paired with a different second script, or the restoring
    // participant's key at this index inside a different script.
    if ((paymentSame && stakeOther) || (stakeSame && paymentOther)
      || (paymentOther && keyHashesIn(r.payment.script).has(own.payment))
      || (stakeOther && keyHashesIn(r.stake?.script).has(own.stake))) {
      conflict = true;
    }
  }

  if (hashes.has(ours.payment) && hashes.has(ours.stake)) return { ok: true, evidence: 'revealed' };
  return conflict ? refusal('CHAIN_MISMATCH') : refusal('NOT_ON_CHAIN');
}

function validRoleKeys(keys: RoleKeys | undefined): boolean {
  return keys?.payment?.level === 'role' && keys.payment.role === ROLE.PAYMENT && keys?.stake?.level === 'role' && keys.stake.role === ROLE.STAKE;
}

/**
 * Restores a vault from an opened package, the restoring participant's own role keys and the
 * chain facts. Never throws. In order:
 * 1. the chain facts are for the package's network (`NETWORK_MISMATCH`);
 * 2. the seed's keys at the package's own index are the exporter's recorded keys (`SEED_MISMATCH`);
 * 3. Plutus vaults stop here (`PLUTUS_TEMPLATE_UNAVAILABLE`);
 * 4. the native scripts rebuild from the package's keys and the seed's own, in the package's key
 *    order, with roles, backup terms and external keys agreeing (`PACKAGE_INCONSISTENT`);
 * 5. a registration or the revealed scripts carry both scripts (`NOT_ON_CHAIN`, or
 *    `CHAIN_MISMATCH` when the chain shows this vault's scripts or the restoring participant's
 *    keys at this index otherwise).
 */
export async function restoreVaultFromPackage(pkg: RecoveryPackage, options: RestoreOptions): Promise<RestoreResult> {
  try {
    if (!pkg || typeof pkg !== 'object' || !validRoleKeys(options?.roleKeys) || !options?.chain) return refusal('INVALID_INPUT');
    try {
      encodeRecoveryPayload(pkg);
    } catch {
      return refusal('INVALID_INPUT', 'not a valid package');
    }
    if (options.chain.network !== pkg.network) return refusal('NETWORK_MISMATCH');

    const me = pkg.participants[pkg.self.position];
    const [payment, stake] = await Promise.all([
      deriveVaultKey(options.roleKeys.payment, pkg.self.index),
      deriveVaultKey(options.roleKeys.stake, pkg.self.index),
    ]);
    if (payment.publicKey !== me.payment || (me.stake !== undefined && stake.publicKey !== me.stake)) {
      return refusal('SEED_MISMATCH');
    }
    if (pkg.vault.kind === 'plutus') return refusal('PLUTUS_TEMPLATE_UNAVAILABLE', `template version ${pkg.vault.templateVersion}`);

    const own = await deriveVaultPublicKeys(options.roleKeys, pkg.self.index);
    const rebuilt = await rebuildNative(pkg as NativePackage, own);
    if (rebuilt.ok !== true) return rebuilt;

    const chain = checkChain(rebuilt.vault, await vaultKeyHashes(own), options.chain);
    if (chain.ok !== true) return chain;

    const vault: RestoredVault = {
      kind: 'native',
      network: pkg.network,
      vaultId: vaultId(rebuilt.vault, pkg.network),
      scripts: rebuilt.vault,
      addresses: vaultAddresses(rebuilt.vault, pkg.network),
      self: Object.freeze({ position: pkg.self.position, index: pkg.self.index, role: me.role }),
      ...(pkg.vault.backup ? { backup: pkg.vault.backup } : {}),
      warnings: rebuilt.vault.warnings,
      evidence: chain.evidence,
      canonicalOrder: rebuilt.canonicalOrder,
    };
    return { ok: true, vault: Object.freeze(vault) };
  } catch {
    return refusal('INVALID_INPUT', 'unexpected input');
  }
}

// ---------------------------------------------------------------------------------------------
// Staleness

/** The latest manifest revision the wallet holds for the vault. */
export interface LatestManifestRevision {
  readonly version: number;
  /** blake2b-256 of its canonical CBOR, hex; compared when the versions are equal. */
  readonly hash?: string;
}

export type RecoveryPackageStaleness =
  | { readonly stale: false }
  | {
      readonly stale: true;
      /**
       * `NO_MANIFEST`: the package has no manifest and the vault has one. `OLDER_REVISION`: the
       * package's latest revision is older. `OTHER_REVISION`: same version, other bytes.
       */
      readonly reason: 'NO_MANIFEST' | 'OLDER_REVISION' | 'OTHER_REVISION';
    };

const HASH_HEX = /^[0-9a-f]{64}$/;

/**
 * Whether to remind the participant to export a fresh package: the package is older than the
 * vault's latest manifest revision. `latest` absent means the vault has no manifest, so there is
 * nothing to compare. Throws `GeroVaultError('INVALID_MANIFEST_REVISION')` for a malformed `latest`.
 */
export function recoveryPackageStaleness(
  pkg: { readonly manifests: readonly ManifestRevision[] },
  latest: LatestManifestRevision | undefined,
): RecoveryPackageStaleness {
  if (latest === undefined) return { stale: false };
  if (!Number.isSafeInteger(latest?.version) || latest.version < 0 || (latest.hash !== undefined && !HASH_HEX.test(latest.hash))) {
    throw new GeroVaultError('INVALID_MANIFEST_REVISION', 'A manifest revision is an unsigned version and an optional blake2b-256 hash');
  }
  const manifests = Array.isArray(pkg?.manifests) ? pkg.manifests : [];
  const newest = manifests[manifests.length - 1];
  if (!newest) return { stale: true, reason: 'NO_MANIFEST' };
  if (newest.version < latest.version) return { stale: true, reason: 'OLDER_REVISION' };
  if (newest.version === latest.version && latest.hash !== undefined && manifestHash(newest.cbor) !== latest.hash) {
    return { stale: true, reason: 'OTHER_REVISION' };
  }
  return { stale: false };
}

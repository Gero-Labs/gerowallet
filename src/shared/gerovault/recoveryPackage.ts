/**
 * Recovery package export and restore (spec 6.8, GV-14): with their seed and their own package,
 * one participant (owner, backup holder or guardian) rebuilds the vault and can build and submit
 * a spend through any provider, with every Gero service unavailable (the vendor-independence
 * release gate, spec 14).
 *
 * - Export makes the history and the address book fit, checks that the exporting seed's keys are the exporter's entry
 *   and that the native scripts rebuild from the package's keys, seals the file
 *   (`recoveryFormat.ts`), then opens it once with the passphrase and compares the plaintext.
 * - Restore re-reads the package through its canonical bytes, checks that the restoring seed's
 *   keys are the exporter's, and then:
 *   - native: rebuilds the scripts with the core rebuild (`registration.ts`) from the package's
 *     keys and the seed's own, and derives the address and the vault identifier. The scripts are
 *     the vault and the rebuild is the proof, so chain facts are shown, never required: a funded
 *     vault that was never registered and never spent from still restores.
 *   - Plutus: hashes the carried validator to `h` and requires the state UTxO holding
 *     `(h, "state")` at `(Script(h), Inline(Script(h)))` (spec 4.2.1). The datum check needs the
 *     datum codec of GV-64, which does not exist yet, so the restore stops there with a typed
 *     refusal that carries what it found.
 *   Either way the result is a quarantined candidate for the review screen, never an accepted
 *   vault: a package proves that its keys build the vault, not that this participant agreed to
 *   it (spec 4.0, GV-23).
 *
 * Like the core's scans, this file does no network I/O: the chain facts are the caller's input,
 * gathered from any provider for the package's network.
 *
 * Every function here returns typed refusals for untrusted input and never changes its inputs, so
 * a refused restore loses nothing: the file, the passphrase and whatever the wallet already holds
 * are untouched.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { blake2b } from '@noble/hashes/blake2.js';
import { bech32 } from 'bech32';
import { bytesToHex, hexToBytes } from './cbor';
import { ATTESTATION_METHOD, OwnerAttestation, verifyAttestation } from './attestation';
import { GeroVaultError } from './errors';
import {
  BECH32_PREFIX,
  deriveVaultKey,
  deriveVaultPublicKeys,
  parseExternalCosignerKeys,
  parseVaultPublicKeys,
  vaultKeyHashes,
} from './keys';
import { RecoveryFileRefusal, RecoveryHeader, openRecoveryFile, recoveryPassphraseProblem, sealRecoveryFile } from './recoveryFormat';
import {
  BackupTerms,
  DecodeRecoveryPayloadResult,
  ManifestRevision,
  NativeVaultRecord,
  PackageParticipant,
  PackageRole,
  PlutusVaultRecord,
  RecoveryPackage,
  RecoveryPackageContents,
  RecoverySkipped,
  decodeRecoveryPayload,
  encodeRecoveryPayload,
  fitRecoveryHistory,
  manifestRevisionHashOf,
  sameBytes,
} from './recoveryPayload';
import { ParticipantEntry, VaultManifest, bindingDigest, decodeManifest } from './manifest';
import { DecodedRegistration, EXTERNAL_SCAN_MAX, RebuildParticipant, RegistrationInput, decodeRegistration, rebuildFromRegistration } from './registration';
import { vaultAddresses } from './scripts';
import { ExternalEndorsement, externalAttestationHash, verificationDigest, verifyExternalEndorsement } from './verificationNumber';
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
 * format or payload version, truncated, too large, other key derivation parameters than the
 * format's, a wrong passphrase, a tampered file or an invalid payload.
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
// The dated backup path's time

/**
 * The first Shelley slot of each network and its Unix time in seconds; every slot since lasts one
 * second. From the networks' genesis files (system start, and 20-second Byron slots in epochs of
 * 21600 for mainnet's 208 and preprod's 4 Byron epochs) and the first Shelley epoch's start time.
 */
const SHELLEY_START: Readonly<Record<VaultNetwork, { readonly slot: number; readonly unixSeconds: number }>> = Object.freeze({
  mainnet: { slot: 4492800, unixSeconds: 1596059091 },
  preprod: { slot: 86400, unixSeconds: 1655769600 },
  preview: { slot: 0, unixSeconds: 1666656000 },
});

/**
 * When a dated backup path opens, in Unix milliseconds: the time of its slot. The screen shows
 * this, never a date written next to the slot. `undefined` for an unknown network or a slot before
 * the network's Shelley era.
 */
export function backupPathOpensAtMs(network: VaultNetwork, afterSlot: number): number | undefined {
  const start = Object.prototype.hasOwnProperty.call(SHELLEY_START, network) ? SHELLEY_START[network] : undefined;
  if (!start || !Number.isSafeInteger(afterSlot) || afterSlot < start.slot) return undefined;
  return (start.unixSeconds + (afterSlot - start.slot)) * 1000;
}

// ---------------------------------------------------------------------------------------------
// Shared checks

type Refusal<C extends string> = { readonly ok: false; readonly code: C; readonly detail?: string };

const refusal = <C extends string>(code: C, detail?: string): Refusal<C> =>
  Object.freeze({ ok: false as const, code, ...(detail ? { detail } : {}) });

const toVaultPublicKeys = (payment: string, stake: string): VaultPublicKeys =>
  parseVaultPublicKeys({
    payment: bech32.encode(BECH32_PREFIX.PAYMENT_VK, bech32.toWords(hexToBytes(payment) as Uint8Array), 1023),
    stake: bech32.encode(BECH32_PREFIX.STAKE_VK, bech32.toWords(hexToBytes(stake) as Uint8Array), 1023),
  });

type NativePackage = RecoveryPackageContents & { readonly vault: NativeVaultRecord };
type PlutusPackage = RecoveryPackageContents & { readonly vault: PlutusVaultRecord };

function validRoleKeys(keys: RoleKeys | undefined): boolean {
  return keys?.payment?.level === 'role' && keys.payment.role === ROLE.PAYMENT && keys?.stake?.level === 'role' && keys.stake.role === ROLE.STAKE;
}

/** The seed's vault keys at the package's own index, when they are the exporter's recorded keys. */
async function ownKeysOf(pkg: RecoveryPackageContents, roleKeys: RoleKeys): Promise<VaultPublicKeys | undefined> {
  const me = pkg.participants[pkg.self.position];
  const [payment, stake] = await Promise.all([deriveVaultKey(roleKeys.payment, pkg.self.index), deriveVaultKey(roleKeys.stake, pkg.self.index)]);
  if (payment.publicKey !== me.payment || (me.stake !== undefined && stake.publicKey !== me.stake)) return undefined;
  return deriveVaultPublicKeys(roleKeys, pkg.self.index);
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

interface NativeRebuild {
  readonly ok: true;
  readonly vault: VaultScripts;
  readonly canonicalOrder: boolean;
}

/**
 * Rebuilds a native package's scripts from its participants' vault keys with the core rebuild, the
 * exporter's keys replaced by `own` (the seed's), and checks roles, backup terms and external keys
 * against the result.
 */
async function rebuildNative(pkg: NativePackage, own: VaultPublicKeys): Promise<NativeRebuild | Refusal<'PACKAGE_INCONSISTENT'>> {
  const participants: RebuildParticipant[] = pkg.participants.map((p, i) => ({
    kind: 'vaultKeys',
    keys: i === pkg.self.position ? own : toVaultPublicKeys(p.payment, p.stake as string),
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

/** The package as its canonical bytes read it, so that nothing but those bytes is trusted. */
function reread(pkg: RecoveryPackageContents): RecoveryPackage | undefined {
  let bytes: Uint8Array;
  try {
    bytes = encodeRecoveryPayload(pkg);
  } catch {
    return undefined;
  }
  const decoded = decodeRecoveryPayload(bytes);
  return decoded.ok === true ? decoded.package : undefined;
}

// ---------------------------------------------------------------------------------------------
// Export

/** What an export left out, by kind. */
export interface ExportSkipped extends RecoverySkipped {
  /** Endorsements that do not verify against the latest accepted manifest, or name no carried attestation. */
  readonly endorsements: number;
  /** External attestations that no kept endorsement names. */
  readonly externalAttestations: number;
}

export interface ExportedRecoveryPackage {
  readonly file: Uint8Array;
  /** Proposals left out of the package, the oldest first, to fit it or because they could not be carried (earlier exports included). */
  readonly proposalsDropped: number;
  readonly proposalHistoryTruncated: boolean;
  /** Address book entries left out, likewise; entries carry no usage time, so the oldest added go first. */
  readonly addressBookDropped: number;
  readonly addressBookTruncated: boolean;
  /**
   * What this export left out, by kind: proposals, address book entries and participant labels it
   * could not carry (part of the counts above), and endorsements and external attestations that did
   * not verify.
   */
  readonly skipped: ExportSkipped;
}

const isRecord = (x: unknown): x is object => typeof x === 'object' && x !== null;

/**
 * The history's latest accepted manifest: its highest version, decoded, when it is this vault's
 * (same network and both scripts). `undefined` otherwise, a Plutus vault included.
 */
function latestManifestOf(contents: RecoveryPackageContents): VaultManifest | undefined {
  const vault = contents.vault;
  if (!Array.isArray(contents.manifests) || !isRecord(vault) || vault.kind !== 'native') return undefined;
  let latest: ManifestRevision | undefined;
  for (const r of contents.manifests as readonly Partial<ManifestRevision>[]) {
    if (isRecord(r) && Number.isSafeInteger(r.version) && (!latest || (r.version as number) > latest.version)) latest = r as ManifestRevision;
  }
  if (!latest) return undefined;
  const decoded = decodeManifest(latest.cbor);
  if (decoded.ok !== true) return undefined;
  const m = decoded.manifest;
  return m.version === latest.version && m.network === contents.network
    && m.paymentScript === vault.payment?.cbor && m.stakeScript === vault.stake?.cbor
    ? m
    : undefined;
}

interface CheckedEndorsements {
  readonly contents: RecoveryPackageContents;
  readonly endorsements: number;
  readonly externalAttestations: number;
}

/**
 * Keeps the endorsements and external attestations that verify (spec 5.3, GV-61). Each endorsement
 * is paired by hash with the carried attestation it names (`externalAttestationHash`) and checked
 * with `verifyExternalEndorsement` against the latest accepted manifest; an attestation is kept when
 * a kept endorsement names it. Everything else is left out and counted, so that a package never
 * carries a claim its restorer would take on trust. Lists that are not lists are left as they are,
 * for the payload to refuse.
 */
async function checkedEndorsements(contents: RecoveryPackageContents): Promise<CheckedEndorsements> {
  const endorsements: unknown = contents?.endorsements;
  const attestations: unknown = contents?.externalAttestations;
  const none = { contents, endorsements: 0, externalAttestations: 0 };
  if ((endorsements !== undefined && !Array.isArray(endorsements)) || (attestations !== undefined && !Array.isArray(attestations))) return none;
  const allEndorsements = (endorsements ?? []) as readonly ExternalEndorsement[];
  const allAttestations = (attestations ?? []) as readonly OwnerAttestation[];
  if (allEndorsements.length === 0 && allAttestations.length === 0) return none;
  const hashOf = (a: OwnerAttestation): string | undefined => {
    try {
      return isRecord(a) && a.method === ATTESTATION_METHOD.EXPIRED_TX && typeof a.proof === 'string' ? externalAttestationHash(a.proof) : undefined;
    } catch {
      return undefined;
    }
  };
  const hashes = allAttestations.map(hashOf);
  const latest = latestManifestOf(contents);
  const kept: ExternalEndorsement[] = [];
  const named = new Set<string>();
  for (const e of latest ? allEndorsements : []) {
    const i = isRecord(e) && typeof e.externalAttestationHash === 'string' ? hashes.indexOf(e.externalAttestationHash) : -1;
    if (i < 0) continue;
    const check = await verifyExternalEndorsement(latest as VaultManifest, e, allAttestations[i].proof);
    if (check.ok !== true) continue;
    kept.push(e);
    named.add(hashes[i] as string);
  }
  const keptAttestations = allAttestations.filter((_, i) => hashes[i] !== undefined && named.has(hashes[i] as string));
  return {
    contents: { ...contents, endorsements: kept, externalAttestations: keptAttestations },
    endorsements: allEndorsements.length - kept.length,
    externalAttestations: allAttestations.length - keptAttestations.length,
  };
}

/**
 * Builds the encrypted package file for the participant whose seed gives `roleKeys`. Throws
 * `GeroVaultError`:
 * - `INVALID_PASSPHRASE` for a passphrase the writer refuses (control characters, fewer than 16
 *   code points once normalised);
 * - `INVALID_PACKAGE` for contents that break a rule of the payload, or whose native scripts do not
 *   rebuild from their keys, roles, backup terms and external keys;
 * - `SEED_MISMATCH` when `roleKeys` do not derive the exporter's recorded keys at its index;
 * - `HISTORY_TOO_LARGE`, with the sizes, when the package does not fit even without any proposal
 *   or address book entry, or the manifest history has more than `MAX_MANIFEST_REVISIONS`
 *   revisions (every manifest revision and every endorsement and external attestation that
 *   verifies is kept; the oldest proposals and address book entries are left out first, and one
 *   that cannot be carried is left out and counted, so neither ever makes an export fail);
 * - `MANIFEST_HISTORY_CORRUPT` when a manifest revision cannot be carried, or two different
 *   revisions share a version: the wallet's own accepted history is damaged;
 * - `PACKAGE_CHECK_FAILED` if the sealed file does not open again with the passphrase to the same
 *   payload.
 * An endorsement is kept only when it verifies against the latest accepted manifest and pairs by
 * hash with a carried external attestation, and an external attestation only when a kept
 * endorsement names it; the rest is left out and counted in `skipped`.
 */
export async function exportRecoveryPackage(
  contents: RecoveryPackageContents,
  passphrase: string,
  roleKeys: RoleKeys,
): Promise<ExportedRecoveryPackage> {
  const problem = recoveryPassphraseProblem(passphrase);
  if (problem) throw new GeroVaultError('INVALID_PASSPHRASE', `The passphrase is refused: ${problem}`);
  if (!validRoleKeys(roleKeys)) throw new GeroVaultError('INVALID_ROLE_KEY', 'The exporter\'s role keys are needed');
  const checked = await checkedEndorsements(contents);
  const { contents: fitted, skipped } = fitRecoveryHistory(checked.contents);
  const payload = encodeRecoveryPayload(fitted);
  const decoded = decodeRecoveryPayload(payload);
  if (decoded.ok !== true) throw new GeroVaultError('INVALID_PACKAGE', `The payload does not decode: ${decoded.detail ?? decoded.code}`);
  const pkg = decoded.package;
  const own = await ownKeysOf(pkg, roleKeys);
  if (!own) throw new GeroVaultError('SEED_MISMATCH', 'The exporting seed does not derive the exporter\'s keys at its index');
  if (pkg.vault.kind === 'native') {
    const rebuilt = await rebuildNative(pkg as NativePackage, own);
    if (rebuilt.ok !== true) throw new GeroVaultError('INVALID_PACKAGE', `The scripts do not rebuild from the keys: ${rebuilt.detail}`);
  }
  const file = await sealRecoveryFile(payload, passphrase);
  const reopened = await openRecoveryFile(file, passphrase);
  if (reopened.ok !== true || !sameBytes(reopened.payload, payload)) {
    throw new GeroVaultError('PACKAGE_CHECK_FAILED', 'The package does not open again with its passphrase');
  }
  return Object.freeze({
    file,
    proposalsDropped: pkg.proposalsDropped,
    proposalHistoryTruncated: pkg.proposalHistoryTruncated,
    addressBookDropped: pkg.addressBookDropped,
    addressBookTruncated: pkg.addressBookTruncated,
    skipped: Object.freeze({ ...skipped, endorsements: checked.endorsements, externalAttestations: checked.externalAttestations }),
  });
}

// ---------------------------------------------------------------------------------------------
// Restore: inputs

/** One UTxO as a provider returns it, for a Plutus vault's state. */
export interface RecoveryChainUtxo {
  /** Bech32. */
  readonly address: string;
  readonly assets: readonly { readonly policyId: string; readonly assetName: string; readonly quantity: bigint | number | string }[];
}

/**
 * What the chain shows, from any provider, for the package's network. Untrusted: everything is
 * decoded, hashed and compared here, and for a native vault none of it is required. Only the first
 * `MAX_CHAIN_REGISTRATIONS` registrations and `MAX_REVEALED_SCRIPTS` revealed scripts are read
 * (`chainFactsTruncated` says so); entries that do not decode are ignored, never refused.
 * - `registrations`: CIP-0146 registrations found for the vault (by a discovery scan of the
 *   restoring participant's keys or by the package's script hashes), as `decodeRegistration` takes
 *   them. Anyone can publish one: one that does not decode is ignored.
 * - `revealedScripts`: native scripts the chain ran, CBOR hex, from transaction witness sets.
 * - `funded`, `used`: whether a provider shows value at the vault's payment credential, and a
 *   transaction spending from it. Shown only.
 * - `utxos`: for a Plutus vault, the UTxOs a provider returned for its address or its state token.
 */
export interface RecoveryChainFacts {
  readonly network: VaultNetwork;
  readonly registrations?: readonly RegistrationInput[];
  readonly revealedScripts?: readonly string[];
  readonly funded?: boolean;
  readonly used?: boolean;
  readonly utxos?: readonly RecoveryChainUtxo[];
}

/**
 * What an attestation verifier is asked: whether the manifest history holds the restorer's own
 * owner attestation for this vault. The verifier must bind what it accepts to this vault: the
 * attested binding must name this vault's identifier, and the verification digest must be the one
 * computed from these scripts and participants (spec 5.3). An attestation copied from another vault
 * must not verify. Its answer names the vault and the credential it verified, and restore compares
 * both with its own.
 */
export interface OwnAttestationQuery {
  readonly network: VaultNetwork;
  readonly vaultId: string;
  /** The rebuilt scripts: the vault the attestation must be bound to. */
  readonly scripts: Pick<VaultScripts, 'payment' | 'stake'>;
  /** The package's participants, claims from the package. */
  readonly participants: readonly PackageParticipant[];
  readonly manifests: RecoveryPackage['manifests'];
  /** The restorer's vault keys at their own index, derived from their seed. */
  readonly vaultKeys: VaultPublicKeys;
  /** The hash of the restorer's payment vault key: their credential in the manifest. */
  readonly credential: Ed25519KeyHashHex;
  /** Aborted when the restore stops waiting (`attestationTimeoutMs`, or the caller's own signal). */
  readonly signal: AbortSignal;
}

export type OwnAttestationResult =
  | {
      readonly verified: true;
      /**
       * The recorded `revisedAt` of the earliest revision found holding the attesting binding, in
       * Unix milliseconds; a restore never gives one later than the package's export time. No
       * signature covers it: a screen shows it as "recorded on <date>", never as a proven date.
       */
      readonly recordedAtMs: number;
      /** The vault and the credential the verified attestation is bound to. */
      readonly vaultId: string;
      readonly credential: Ed25519KeyHashHex;
      /** The verification digest of the manifest revision that holds it, when the verifier gives it. */
      readonly verificationDigest?: string;
      /**
       * The newest revision of this vault in the package no longer holds the binding that carries
       * the attestation: its device was removed later (or bound again under a binding that does not
       * verify). Deposits then stay blocked until the cosigner verification is redone.
       */
      readonly attestingDeviceRemoved: boolean;
    }
  | { readonly verified: false };

/**
 * Verifies the restorer's own owner attestation in the manifest history, signed by their vault
 * key at their index. A restore with no verifier given uses `verifyOwnAttestationInManifests`.
 * The restore's timeout is a timer, so a verifier with long work yields to the event loop between
 * steps and stops once `signal` is aborted.
 */
export type OwnAttestationVerifier = (query: OwnAttestationQuery) => Promise<OwnAttestationResult>;

const HASH224 = (hex: string) => bytesToHex(blake2b(hexToBytes(hex) as Uint8Array, { dkLen: 28 }));

const participantKey = (role: string, payment: string, stake: string | undefined, credential: string) => `${role}|${payment}|${stake ?? ''}|${credential}`;

/** The package's participants, with their roles and keys, as `sameParticipants` compares them. */
function packageParticipantKeys(participants: readonly PackageParticipant[]): readonly string[] {
  return participants.map(p => participantKey(p.role, p.payment, p.stake, HASH224(p.payment))).sort();
}

/** Whether a manifest revision names exactly the package's participants, with their roles and keys. */
function sameParticipants(m: VaultManifest, inPackage: readonly string[]): boolean {
  const inManifest = [
    ...m.roles.owners.map(e => participantKey('owner', e.vaultKeys.payment, e.vaultKeys.stake, e.credential)),
    ...m.roles.backupHolders.map(e => participantKey('backup', e.vaultKeys.payment, e.vaultKeys.stake, e.credential)),
    ...m.roles.guardians.map(e => participantKey('guardian', e.vaultKeys.payment, e.vaultKeys.stake, e.credential)),
    ...m.roles.external.map(e => participantKey(e.role === 'owner' ? 'owner' : 'backup', e.vaultKeys.payment, e.vaultKeys.stake, e.credential)),
  ].sort();
  return inManifest.length === inPackage.length && inManifest.every((k, i) => k === inPackage[i]);
}

/** How long the default verifier works between two yields to the event loop, in milliseconds. */
const VERIFIER_SLICE_MS = 8;

const clock = (): number => (typeof performance === 'object' && typeof performance.now === 'function' ? performance.now() : Date.now());

/** One turn of the macrotask queue, so that timers (the restore's timeout among them) run. */
const nextTurn = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

/**
 * The default verifier (spec 5.3, GV-22): the restorer's own owner attestation in the package's
 * manifest history, verified with the manifest code's attestation verifier. A revision counts
 * only when it decodes, carries the version the package gives it, names this vault's identifier,
 * network and both scripts, and names exactly the package's participants with their keys, so that
 * its verification digest is this vault's; then the restorer's entry must hold their own vault
 * keys, and one of its device bindings must carry an attestation by their vault payment key over
 * that binding's digest, which names this vault. An attestation from another vault, a tampered
 * one, or one by another key never verifies.
 *
 * The scan goes newest first, each distinct revision decoded once and each binding verified once.
 * A binding carries forward unchanged from revision to revision and a removed one never returns, so
 * the revisions holding it are consecutive; the newest one that holds a verified binding settles
 * the answer, and only its recorded date needs a look further back, by bisection. When that
 * revision is not the newest of this vault in the package, the device was removed later
 * (`attestingDeviceRemoved`). The scan yields to the macrotask queue between revisions at least
 * every `VERIFIER_SLICE_MS` of work, so the restore's timeout can fire, and stops once the query's
 * signal is aborted. Never throws.
 */
export const verifyOwnAttestationInManifests: OwnAttestationVerifier = async query => {
  try {
    const signal = query.signal;
    const revisions = (query.manifests as readonly Partial<ManifestRevision>[])
      .filter((r): r is ManifestRevision => isRecord(r) && Number.isSafeInteger(r.version) && typeof r.cbor === 'string')
      .sort((a, b) => b.version - a.version);
    const inPackage = packageParticipantKeys(query.participants);
    const decoded = new Map<string, VaultManifest | null>();
    /** Revision `i` as this vault's manifest, each distinct encoding decoded once; `undefined` when it is not. */
    const manifestAt = (i: number): VaultManifest | undefined => {
      const { version, cbor } = revisions[i];
      let m = decoded.get(cbor);
      if (m === undefined) {
        const d = decodeManifest(cbor);
        const ours = d.ok === true && d.manifest.vaultId === query.vaultId && d.manifest.network === query.network
          && d.manifest.paymentScript === query.scripts.payment.cbor && d.manifest.stakeScript === query.scripts.stake.cbor
          && sameParticipants(d.manifest, inPackage);
        m = ours ? d.manifest : null;
        decoded.set(cbor, m);
      }
      return m !== null && m.version === version ? m : undefined;
    };
    /** The restorer's entry in a revision, when it holds their own vault keys. */
    const entryIn = (m: VaultManifest | undefined): ParticipantEntry | undefined => {
      const e = m && [...m.roles.owners, ...m.roles.backupHolders, ...m.roles.guardians].find(x => x.credential === query.credential);
      return e && e.vaultKeys.payment === query.vaultKeys.payment && e.vaultKeys.stake === query.vaultKeys.stake ? e : undefined;
    };
    let sliceStart = clock();
    /** Between two revisions: yields once the slice is used up; true once the restore stopped waiting. */
    const stopped = async (): Promise<boolean> => {
      if (clock() - sliceStart >= VERIFIER_SLICE_MS) {
        await nextTurn();
        sliceStart = clock();
      }
      return signal?.aborted === true;
    };
    const verifiedBindings = new Map<string, boolean>();
    let newest: number | undefined;
    for (let i = 0; i < revisions.length; i++) {
      if (await stopped()) return { verified: false };
      const m = manifestAt(i);
      if (!m) continue;
      if (newest === undefined) newest = i;
      for (const binding of entryIn(m)?.devices ?? []) {
        const attestation = binding.attestation;
        if (!attestation || binding.vaultId !== query.vaultId || binding.credential !== query.credential) continue;
        const digest = bindingDigest(binding);
        const key = `${digest}|${attestation.method}|${attestation.proof}`;
        if (!verifiedBindings.has(key)) {
          verifiedBindings.set(key, (await verifyAttestation(attestation, query.credential, { kind: 'binding', digest, network: query.network })).ok === true);
        }
        if (verifiedBindings.get(key) !== true) continue;
        // The earliest revision that still holds this very binding: its recorded date is shown.
        const holds = (j: number) => entryIn(manifestAt(j))?.devices.some(d => d.attestation?.method === attestation.method
          && d.attestation.proof === attestation.proof && bindingDigest(d) === digest) === true;
        let first = i;
        let last = revisions.length - 1;
        while (first < last) {
          if (await stopped()) return { verified: false };
          const mid = Math.ceil((first + last) / 2);
          if (holds(mid)) first = mid;
          else last = mid - 1;
        }
        return {
          verified: true,
          recordedAtMs: (manifestAt(first) as VaultManifest).revisedAt * 1000,
          vaultId: m.vaultId,
          credential: query.credential,
          verificationDigest: verificationDigest(m),
          attestingDeviceRemoved: i !== newest,
        };
      }
    }
  } catch {
    return { verified: false };
  }
  return { verified: false };
};

/** How long a restore waits for the verifier by default, in milliseconds. */
export const ATTESTATION_TIMEOUT_MS = 10000;

export interface RestoreOptions {
  /** The restoring participant's own CIP-1854 role keys, derived from their seed. */
  readonly roleKeys: RoleKeys;
  readonly chain: RecoveryChainFacts;
  /** The own-attestation verifier; `verifyOwnAttestationInManifests` when not given. */
  readonly verifyOwnAttestation?: OwnAttestationVerifier;
  /** How long to wait for the verifier before taking the "no attestation" path; 10 s by default. */
  readonly attestationTimeoutMs?: number;
  /** Stops waiting for the verifier when aborted. */
  readonly signal?: AbortSignal;
}

// ---------------------------------------------------------------------------------------------
// Restore: results

/** What the chain shows of a native vault, for display only. */
export interface RecoveryChainState {
  /** A registration carries the vault's payment script and no other stake script. */
  readonly registered: boolean;
  /** A provider shows value at the vault's payment credential. */
  readonly funded: boolean;
  /** The chain ran one of the vault's scripts, or a provider shows a spend from it. */
  readonly used: boolean;
  /** None of the above: shown as "never seen on chain". */
  readonly neverSeen: boolean;
}

/**
 * A native vault rebuilt from a package: a quarantined candidate for the review screen, never an
 * accepted vault. The review shows the exact scripts and address, the threshold, every
 * participant with their key and label marked as claims from the package, the backup terms and
 * the restorer's position, and the user confirms it is a vault they agreed to join. Deposits from
 * this wallet stay blocked until the cosigner verification of spec 5.3 is redone, unless the
 * restorer's own attestation was found in the manifest history on a binding the newest revision
 * still holds (not `attestingDeviceRemoved`); spending works either way.
 */
export interface RestoredNativeCandidate {
  readonly kind: 'native';
  readonly status: 'candidate';
  readonly network: VaultNetwork;
  readonly vaultId: string;
  readonly scripts: VaultScripts;
  readonly addresses: VaultAddresses;
  readonly self: { readonly position: number; readonly index: number; readonly role: PackageRole };
  /** Claims from the package; their keys rebuild the scripts, their labels are unverified and shown only through `displayLabel`. */
  readonly participants: readonly PackageParticipant[];
  readonly backup?: BackupTerms & { /** The time of the slot; `undefined` when it cannot be computed. */ readonly opensAtMs?: number };
  /** The warnings the vault carries (`ALL_OWNERS_REQUIRED`), for the screen to show. */
  readonly warnings: readonly VaultWarning[];
  /** The scripts' key order is the one `buildVaultScripts` writes. */
  readonly canonicalOrder: boolean;
  readonly chainState: RecoveryChainState;
  /** More chain facts were given than are read; the state and conflicts cover the first ones only. */
  readonly chainFactsTruncated: boolean;
  /**
   * Hashes of other scripts on chain that hold either of the restorer's keys at this index,
   * whatever role a registration declares for them. Shown, never a refusal: anyone who knows a
   * public key can publish such a script.
   */
  readonly conflicts: readonly string[];
  readonly ownAttestation: OwnAttestationResult;
  readonly depositsBlocked: boolean;
}

/** What a Plutus restore found before it stopped. */
export interface PlutusRestoreFacts {
  /** `h`: the Plutus V3 hash of the carried validator. */
  readonly scriptHash: Hash28ByteBase16;
  /** `(Script(h), Inline(Script(h)))`. */
  readonly address: Cardano.PaymentAddress;
  readonly templateVersion: number;
  /** No template version is pinned yet, so no vault is verified against an audited template. */
  readonly templateVerified: false;
  /** Without a verified template a vault may only be spent from, never newly funded. */
  readonly spendOnly: true;
}

export type RestoreRefusalCode =
  | 'INVALID_INPUT'
  /** The chain facts are for another network than the package's. */
  | 'NETWORK_MISMATCH'
  /** The restoring seed's keys at the package's index are not the exporter's keys. */
  | 'SEED_MISMATCH'
  /** The package's scripts do not rebuild from its keys, or its roles, backup terms or external keys disagree with them. */
  | 'PACKAGE_INCONSISTENT'
  /** No state UTxO holding `(h, "state")` at the address of the carried validator. */
  | 'PLUTUS_VAULT_NOT_FOUND'
  /** The state UTxO is there; the datum check needs the datum codec of GV-64. */
  | 'PLUTUS_DATUM_CODEC_UNAVAILABLE';

export type RestoreResult =
  | { readonly ok: true; readonly candidate: RestoredNativeCandidate }
  | Refusal<Exclude<RestoreRefusalCode, 'PLUTUS_VAULT_NOT_FOUND' | 'PLUTUS_DATUM_CODEC_UNAVAILABLE'>>
  | (Refusal<'PLUTUS_VAULT_NOT_FOUND' | 'PLUTUS_DATUM_CODEC_UNAVAILABLE'> & { readonly plutus: PlutusRestoreFacts });

// ---------------------------------------------------------------------------------------------
// Restore: native chain state

export const MAX_CHAIN_REGISTRATIONS = 1024;
export const MAX_REVEALED_SCRIPTS = 256;
const MAX_REVEALED_SCRIPT_BYTES = 16384;

/** A script's hash over the bytes as given: `blake2b-224(tag || bytes)`, tag 0 for native, 3 for Plutus V3. */
function scriptHash(tag: number, bytes: Uint8Array): string {
  const tagged = new Uint8Array(bytes.length + 1);
  tagged[0] = tag;
  tagged.set(bytes, 1);
  return bytesToHex(blake2b(tagged, { dkLen: 28 }));
}

function keyHashesIn(script: Cardano.NativeScript | undefined, out = new Set<string>()): Set<string> {
  if (!script) return out;
  if ('keyHash' in script) out.add(script.keyHash);
  if ('scripts' in script) script.scripts.forEach(s => keyHashesIn(s, out));
  return out;
}

/** The key hashes of a native script as the chain revealed it, in any valid encoding; empty if unreadable. */
function revealedKeyHashes(hex: string): Set<string> {
  try {
    return keyHashesIn(Serialization.NativeScript.fromCbor(HexBlob(hex)).toCore());
  } catch {
    return new Set();
  }
}

type ChainReading =
  | { readonly ok: true; readonly state: RecoveryChainState; readonly conflicts: readonly string[]; readonly truncated: boolean }
  | Refusal<'INVALID_INPUT'>;

function readNativeChain(
  vault: VaultScripts,
  own: { readonly payment: Ed25519KeyHashHex; readonly stake: Ed25519KeyHashHex },
  chain: RecoveryChainFacts,
): ChainReading {
  const registrations = chain.registrations ?? [];
  const revealed = chain.revealedScripts ?? [];
  if (!Array.isArray(registrations)) return refusal('INVALID_INPUT', 'registrations');
  if (!Array.isArray(revealed)) return refusal('INVALID_INPUT', 'revealed scripts');
  if ((chain.funded !== undefined && typeof chain.funded !== 'boolean') || (chain.used !== undefined && typeof chain.used !== 'boolean')) {
    return refusal('INVALID_INPUT', 'funded or used');
  }
  const truncated = registrations.length > MAX_CHAIN_REGISTRATIONS || revealed.length > MAX_REVEALED_SCRIPTS;
  const ours = new Set<string>([vault.payment.hash, vault.stake.hash]);
  const conflicts = new Set<string>();
  const holdsOwnKey = (keys: ReadonlySet<string>) => keys.has(own.payment) || keys.has(own.stake);

  let registered = false;
  for (const input of registrations.slice(0, MAX_CHAIN_REGISTRATIONS)) {
    // Hashes are recomputed from the published bytes; whatever does not decode is someone's noise.
    const decoded = decodeRegistration(input);
    if (decoded.ok !== true) continue;
    const r = decoded.registration;
    if (r.payment.hash === vault.payment.hash && (r.stake === undefined || r.stake.hash === vault.stake.hash)) registered = true;
    // Both keys against every script, whatever role the registration declares for it.
    for (const sc of r.scripts) if (!ours.has(sc.hash) && holdsOwnKey(keyHashesIn(sc.script))) conflicts.add(sc.hash);
  }

  let ran = false;
  for (const hex of revealed.slice(0, MAX_REVEALED_SCRIPTS)) {
    const bytes = hexToBytes(hex);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_REVEALED_SCRIPT_BYTES) continue;
    const hash = scriptHash(0, bytes);
    if (ours.has(hash)) {
      ran = true;
      continue;
    }
    if (holdsOwnKey(revealedKeyHashes(hex as string))) conflicts.add(hash);
  }

  const funded = chain.funded === true;
  const used = ran || chain.used === true;
  return {
    ok: true,
    state: Object.freeze({ registered, funded, used, neverSeen: !registered && !funded && !used }),
    conflicts: Object.freeze([...conflicts].sort()),
    truncated,
  };
}

/**
 * Asks the verifier, for at most the timeout. Only an answer bound to this vault and this restorer
 * counts, and its recorded date is never later than `exportedAtMs`, the package's export time.
 */
async function ownAttestation(
  options: RestoreOptions,
  query: Omit<OwnAttestationQuery, 'signal'>,
  exportedAtMs: number,
): Promise<OwnAttestationResult> {
  const verify = options.verifyOwnAttestation ?? verifyOwnAttestationInManifests;
  if (typeof verify !== 'function') return { verified: false };
  const ms = Number.isSafeInteger(options.attestationTimeoutMs) && (options.attestationTimeoutMs as number) > 0
    ? (options.attestationTimeoutMs as number)
    : ATTESTATION_TIMEOUT_MS;
  const controller = new AbortController();
  const outer = options.signal;
  const stop = () => controller.abort();
  if (outer?.aborted) return { verified: false };
  outer?.addEventListener?.('abort', stop);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<OwnAttestationResult>(resolve => {
    controller.signal.addEventListener('abort', () => resolve({ verified: false }));
    timer = setTimeout(stop, ms);
  });
  try {
    const r = await Promise.race([verify({ ...query, signal: controller.signal }), gaveUp]);
    return r?.verified === true && Number.isSafeInteger(r.recordedAtMs) && r.recordedAtMs >= 0
      && typeof r.attestingDeviceRemoved === 'boolean' && r.vaultId === query.vaultId && r.credential === query.credential
      ? Object.freeze({
        verified: true,
        recordedAtMs: Math.min(r.recordedAtMs, exportedAtMs),
        vaultId: r.vaultId,
        credential: r.credential,
        ...(typeof r.verificationDigest === 'string' ? { verificationDigest: r.verificationDigest } : {}),
        attestingDeviceRemoved: r.attestingDeviceRemoved,
      })
      : { verified: false };
  } catch {
    return { verified: false };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    outer?.removeEventListener?.('abort', stop);
    controller.abort();
  }
}

// ---------------------------------------------------------------------------------------------
// Restore: Plutus

const STATE_ASSET_NAME = bytesToHex(new TextEncoder().encode('state'));

/** Exactly one: the integer 1, the bigint 1, or the decimal string "1". */
function isOne(quantity: unknown): boolean {
  if (typeof quantity === 'bigint') return quantity === 1n;
  if (typeof quantity === 'number') return Number.isSafeInteger(quantity) && quantity === 1;
  return typeof quantity === 'string' && quantity === '1';
}

function addressBytes(bech: unknown): string | undefined {
  try {
    return typeof bech === 'string' ? Cardano.Address.fromBech32(bech).toBytes() : undefined;
  } catch {
    return undefined;
  }
}

function restorePlutus(pkg: PlutusPackage, chain: RecoveryChainFacts): RestoreResult {
  const utxos = chain.utxos ?? [];
  if (!Array.isArray(utxos)) return refusal('INVALID_INPUT', 'utxos');
  const h = Hash28ByteBase16(scriptHash(3, hexToBytes(pkg.vault.validator) as Uint8Array));
  const credential: Cardano.Credential = { type: Cardano.CredentialType.ScriptHash, hash: h };
  const networkId = pkg.network === 'mainnet' ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
  const full = Cardano.BaseAddress.fromCredentials(networkId, credential, credential).toAddress();
  const plutus: PlutusRestoreFacts = Object.freeze({
    scriptHash: h,
    address: Cardano.PaymentAddress(full.toBech32()),
    templateVersion: pkg.vault.templateVersion,
    templateVerified: false,
    spendOnly: true,
  });
  const fullBytes = full.toBytes();
  // Only the state token is looked for, however many UTxOs there are. A state token under any
  // other policy, or at any other address, is never accepted (spec 4.2.1).
  const holdsState = (u: RecoveryChainUtxo | undefined) => Array.isArray(u?.assets)
    && (u as RecoveryChainUtxo).assets.some(a => a?.policyId === h && a.assetName === STATE_ASSET_NAME && isOne(a.quantity));
  const state = utxos.find(u => holdsState(u) && addressBytes(u.address) === fullBytes);
  if (!state) return { ...refusal('PLUTUS_VAULT_NOT_FOUND'), plutus };
  return { ...refusal('PLUTUS_DATUM_CODEC_UNAVAILABLE', 'the state datum check needs the GV-64 datum codec'), plutus };
}

// ---------------------------------------------------------------------------------------------
// Restore

/**
 * Restores a vault from an opened package, the restoring participant's own role keys and the
 * chain facts, as a quarantined candidate. Never throws. In order:
 * 1. the package is re-read through its canonical bytes (`INVALID_INPUT` if it is not one);
 * 2. the chain facts are for the package's network (`NETWORK_MISMATCH`);
 * 3. the seed's keys at the package's own index are the exporter's recorded keys (`SEED_MISMATCH`);
 * 4. Plutus: `h` from the carried validator and the state UTxO at its address
 *    (`PLUTUS_VAULT_NOT_FOUND`), then `PLUTUS_DATUM_CODEC_UNAVAILABLE` until the datum codec exists;
 * 5. native: the scripts rebuild from the package's keys and the seed's own, in the package's key
 *    order, with roles, backup terms and external keys agreeing (`PACKAGE_INCONSISTENT`); then the
 *    chain state and any conflicts are read for display, and the restorer's own attestation is
 *    looked for through `verifyOwnAttestation`, for at most `attestationTimeoutMs`.
 */
export async function restoreVaultFromPackage(pkg: RecoveryPackageContents, options: RestoreOptions): Promise<RestoreResult> {
  try {
    if (!options || typeof options !== 'object' || !validRoleKeys(options.roleKeys) || !options.chain || typeof options.chain !== 'object') {
      return refusal('INVALID_INPUT');
    }
    const fresh = reread(pkg);
    if (!fresh) return refusal('INVALID_INPUT', 'not a valid package');
    if (options.chain.network !== fresh.network) return refusal('NETWORK_MISMATCH');

    const own = await ownKeysOf(fresh, options.roleKeys);
    if (!own) return refusal('SEED_MISMATCH');
    if (fresh.vault.kind === 'plutus') return restorePlutus(fresh as PlutusPackage, options.chain);

    const rebuilt = await rebuildNative(fresh as NativePackage, own);
    if (rebuilt.ok !== true) return rebuilt;
    const ownHashes = await vaultKeyHashes(own);
    const chain = readNativeChain(rebuilt.vault, ownHashes, options.chain);
    if (chain.ok !== true) return chain;

    const id = vaultId(rebuilt.vault, fresh.network);
    const attestation = await ownAttestation(options, {
      network: fresh.network,
      vaultId: id,
      scripts: { payment: rebuilt.vault.payment, stake: rebuilt.vault.stake },
      participants: fresh.participants,
      manifests: fresh.manifests,
      vaultKeys: own,
      credential: ownHashes.payment,
    }, fresh.exportedAtMs);
    const terms = (fresh as NativePackage).vault.backup;
    const opensAtMs = terms ? backupPathOpensAtMs(fresh.network, terms.afterSlot) : undefined;
    const me = fresh.participants[fresh.self.position];
    const candidate: RestoredNativeCandidate = {
      kind: 'native',
      status: 'candidate',
      network: fresh.network,
      vaultId: id,
      scripts: rebuilt.vault,
      addresses: vaultAddresses(rebuilt.vault, fresh.network),
      self: Object.freeze({ position: fresh.self.position, index: fresh.self.index, role: me.role }),
      participants: fresh.participants,
      ...(terms ? { backup: Object.freeze({ ...terms, ...(opensAtMs === undefined ? {} : { opensAtMs }) }) } : {}),
      warnings: rebuilt.vault.warnings,
      canonicalOrder: rebuilt.canonicalOrder,
      chainState: chain.state,
      chainFactsTruncated: chain.truncated,
      conflicts: chain.conflicts,
      ownAttestation: attestation,
      depositsBlocked: attestation.verified !== true || attestation.attestingDeviceRemoved,
    };
    return { ok: true, candidate: Object.freeze(candidate) };
  } catch {
    return refusal('INVALID_INPUT', 'unexpected input');
  }
}

// ---------------------------------------------------------------------------------------------
// Staleness

/** The latest manifest revision the wallet holds for the vault. */
export interface LatestManifestRevision {
  readonly version: number;
  /** The tagged manifest hash, lowercase hex; compared when the versions are equal. */
  readonly hash?: string;
}

export type RecoveryPackageStaleness =
  | { readonly stale: false }
  | {
      readonly stale: true;
      /**
       * `NO_MANIFEST`: the package has no manifest and the vault has one. `OLDER_REVISION`: the
       * package's latest revision is older. `OTHER_REVISION`: same version, other bytes.
       * `UNREADABLE_PACKAGE`: the package's manifest list is malformed.
       */
      readonly reason: 'NO_MANIFEST' | 'OLDER_REVISION' | 'OTHER_REVISION' | 'UNREADABLE_PACKAGE';
    };

const HASH_HEX = /^[0-9a-f]{64}$/;

/**
 * Whether to remind the participant to export a fresh package: the package is older than the
 * vault's latest manifest revision. `latest` absent means the vault has no manifest, so there is
 * nothing to compare. A malformed package manifest list reads as stale; only a malformed `latest`,
 * which is the wallet's own record, throws `GeroVaultError('INVALID_MANIFEST_REVISION')`.
 */
export function recoveryPackageStaleness(
  pkg: { readonly manifests: readonly ManifestRevision[] },
  latest: LatestManifestRevision | undefined,
): RecoveryPackageStaleness {
  if (latest === undefined) return { stale: false };
  if (!Number.isSafeInteger(latest?.version) || latest.version < 0 || (latest.hash !== undefined && !HASH_HEX.test(latest.hash))) {
    throw new GeroVaultError('INVALID_MANIFEST_REVISION', 'A manifest revision is an unsigned version and an optional tagged hash');
  }
  const manifests: unknown = pkg?.manifests;
  if (!Array.isArray(manifests)) return { stale: true, reason: 'UNREADABLE_PACKAGE' };
  let newest: { version: number; hash: string } | undefined;
  for (const m of manifests as unknown[]) {
    const r = m as Partial<ManifestRevision> | undefined;
    const hash = manifestRevisionHashOf(r?.cbor);
    if (!Number.isSafeInteger(r?.version) || (r?.version as number) < 0 || hash === undefined) return { stale: true, reason: 'UNREADABLE_PACKAGE' };
    // A decoded package lists revisions in ascending order; any other list is not assumed to.
    if (!newest || (r?.version as number) > newest.version) newest = { version: r?.version as number, hash };
  }
  if (!newest) return { stale: true, reason: 'NO_MANIFEST' };
  if (newest.version < latest.version) return { stale: true, reason: 'OLDER_REVISION' };
  if (newest.version === latest.version && latest.hash !== undefined && newest.hash !== latest.hash) {
    return { stale: true, reason: 'OTHER_REVISION' };
  }
  return { stale: false };
}

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
  decodeRecoveryPayload,
  encodeRecoveryPayload,
  fitRecoveryHistory,
  manifestRevisionHash,
} from './recoveryPayload';
import { DecodedRegistration, EXTERNAL_SCAN_MAX, RebuildParticipant, RegistrationInput, decodeRegistration, rebuildFromRegistration } from './registration';
import { vaultAddresses } from './scripts';
import { vaultId } from './vaultId';
import { ROLE, RoleKeys, VaultAddresses, VaultNetwork, VaultPublicKeys, VaultScript, VaultScripts, VaultWarning } from './types';

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

export interface ExportedRecoveryPackage {
  readonly file: Uint8Array;
  /** Proposals left out of the package, the oldest first, to fit it (earlier exports included). */
  readonly proposalsDropped: number;
  readonly proposalHistoryTruncated: boolean;
  /** Address book entries left out, the oldest first (entries carry no usage time). */
  readonly addressBookDropped: number;
  readonly addressBookTruncated: boolean;
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
 *   or address book entry (every manifest revision is kept; the oldest proposals and address book
 *   entries are left out first, so neither ever makes an export fail);
 * - `PACKAGE_CHECK_FAILED` if the sealed file does not open again with the passphrase to the same
 *   payload.
 */
export async function exportRecoveryPackage(
  contents: RecoveryPackageContents,
  passphrase: string,
  roleKeys: RoleKeys,
): Promise<ExportedRecoveryPackage> {
  const problem = recoveryPassphraseProblem(passphrase);
  if (problem) throw new GeroVaultError('INVALID_PASSPHRASE', `The passphrase is refused: ${problem}`);
  if (!validRoleKeys(roleKeys)) throw new GeroVaultError('INVALID_ROLE_KEY', 'The exporter\'s role keys are needed');
  const payload = encodeRecoveryPayload(fitRecoveryHistory(contents));
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
  if (reopened.ok !== true || reopened.payload.length !== payload.length || !reopened.payload.every((b, i) => b === payload[i])) {
    throw new GeroVaultError('PACKAGE_CHECK_FAILED', 'The package does not open again with its passphrase');
  }
  return Object.freeze({
    file,
    proposalsDropped: pkg.proposalsDropped,
    proposalHistoryTruncated: pkg.proposalHistoryTruncated,
    addressBookDropped: pkg.addressBookDropped,
    addressBookTruncated: pkg.addressBookTruncated,
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
 * decoded, hashed and compared here, and for a native vault none of it is required.
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

/** What an attestation verifier is asked: whether the manifest history holds the restorer's own attestation. */
export interface OwnAttestationQuery {
  readonly network: VaultNetwork;
  readonly vaultId: string;
  readonly manifests: RecoveryPackage['manifests'];
  /** The restorer's vault keys at their own index, derived from their seed. */
  readonly vaultKeys: VaultPublicKeys;
  /** The hash of the restorer's payment vault key: their credential in the manifest. */
  readonly credential: Ed25519KeyHashHex;
}

export type OwnAttestationResult = { readonly verified: true; readonly acceptedAtMs: number } | { readonly verified: false };

/**
 * Verifies the restorer's own owner attestation in the manifest history, signed by their vault
 * key at their index. The verifier belongs to the manifest work (GV-22); until it is wired in,
 * no caller passes one and every restore takes the "no attestation" path.
 */
export type OwnAttestationVerifier = (query: OwnAttestationQuery) => Promise<OwnAttestationResult>;

export interface RestoreOptions {
  /** The restoring participant's own CIP-1854 role keys, derived from their seed. */
  readonly roleKeys: RoleKeys;
  readonly chain: RecoveryChainFacts;
  readonly verifyOwnAttestation?: OwnAttestationVerifier;
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
 * restorer's own attestation was found in the manifest history; spending works either way.
 */
export interface RestoredNativeCandidate {
  readonly kind: 'native';
  readonly status: 'candidate';
  readonly network: VaultNetwork;
  readonly vaultId: string;
  readonly scripts: VaultScripts;
  readonly addresses: VaultAddresses;
  readonly self: { readonly position: number; readonly index: number; readonly role: PackageRole };
  /** Claims from the package; their keys rebuild the scripts, their labels are unverified. */
  readonly participants: readonly PackageParticipant[];
  readonly backup?: BackupTerms & { /** The time of the slot; `undefined` when it cannot be computed. */ readonly opensAtMs?: number };
  /** The warnings the vault carries (`ALL_OWNERS_REQUIRED`), for the screen to show. */
  readonly warnings: readonly VaultWarning[];
  /** The scripts' key order is the one `buildVaultScripts` writes. */
  readonly canonicalOrder: boolean;
  readonly chainState: RecoveryChainState;
  /**
   * Hashes of other scripts on chain that hold the restorer's key at this index. Shown, never a
   * refusal: anyone who knows a public key can publish such a script.
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

const MAX_CHAIN_REGISTRATIONS = 1024;
const MAX_REVEALED_SCRIPTS = 256;
const MAX_REVEALED_SCRIPT_BYTES = 16384;
const MAX_CHAIN_UTXOS = 1024;

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

type ChainReading = { readonly ok: true; readonly state: RecoveryChainState; readonly conflicts: readonly string[] } | Refusal<'INVALID_INPUT'>;

function readNativeChain(
  vault: VaultScripts,
  own: { readonly payment: Ed25519KeyHashHex; readonly stake: Ed25519KeyHashHex },
  chain: RecoveryChainFacts,
): ChainReading {
  const registrations = chain.registrations ?? [];
  const revealed = chain.revealedScripts ?? [];
  if (!Array.isArray(registrations) || registrations.length > MAX_CHAIN_REGISTRATIONS) return refusal('INVALID_INPUT', 'registrations');
  if (!Array.isArray(revealed) || revealed.length > MAX_REVEALED_SCRIPTS) return refusal('INVALID_INPUT', 'revealed scripts');
  if ((chain.funded !== undefined && typeof chain.funded !== 'boolean') || (chain.used !== undefined && typeof chain.used !== 'boolean')) {
    return refusal('INVALID_INPUT', 'funded or used');
  }
  const ours = new Set<string>([vault.payment.hash, vault.stake.hash]);
  const conflicts = new Set<string>();
  const holdsOwnKey = (s: VaultScript) =>
    keyHashesIn(s.script).has(s.role === ROLE.PAYMENT ? own.payment : own.stake);

  let registered = false;
  for (const input of registrations) {
    // Hashes are recomputed from the published bytes; whatever does not decode is someone's noise.
    const decoded = decodeRegistration(input);
    if (decoded.ok !== true) continue;
    const r = decoded.registration;
    if (r.payment.hash === vault.payment.hash && (r.stake === undefined || r.stake.hash === vault.stake.hash)) registered = true;
    for (const s of r.scripts) if (!ours.has(s.hash) && holdsOwnKey(s)) conflicts.add(s.hash);
  }

  let ran = false;
  for (const hex of revealed) {
    const bytes = hexToBytes(hex);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_REVEALED_SCRIPT_BYTES) return refusal('INVALID_INPUT', 'a revealed script is not CBOR hex');
    const hash = scriptHash(0, bytes);
    if (ours.has(hash)) {
      ran = true;
      continue;
    }
    const keys = revealedKeyHashes(hex as string);
    if (keys.has(own.payment) || keys.has(own.stake)) conflicts.add(hash);
  }

  const funded = chain.funded === true;
  const used = ran || chain.used === true;
  return {
    ok: true,
    state: Object.freeze({ registered, funded, used, neverSeen: !registered && !funded && !used }),
    conflicts: Object.freeze([...conflicts].sort()),
  };
}

async function ownAttestation(
  verify: OwnAttestationVerifier | undefined,
  query: OwnAttestationQuery,
): Promise<OwnAttestationResult> {
  if (typeof verify !== 'function') return { verified: false };
  try {
    const r = await verify(query);
    return r?.verified === true && Number.isSafeInteger(r.acceptedAtMs) && r.acceptedAtMs >= 0
      ? Object.freeze({ verified: true, acceptedAtMs: r.acceptedAtMs })
      : { verified: false };
  } catch {
    return { verified: false };
  }
}

// ---------------------------------------------------------------------------------------------
// Restore: Plutus

const STATE_ASSET_NAME = bytesToHex(new TextEncoder().encode('state'));

function isOne(quantity: unknown): boolean {
  try {
    return (typeof quantity === 'bigint' || typeof quantity === 'number' || typeof quantity === 'string') && BigInt(quantity) === 1n;
  } catch {
    return false;
  }
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
  if (!Array.isArray(utxos) || utxos.length > MAX_CHAIN_UTXOS) return refusal('INVALID_INPUT', 'utxos');
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
  // A state token under any other policy, or at any other address, is never accepted (spec 4.2.1).
  const state = utxos.find(u => addressBytes(u?.address) === fullBytes && Array.isArray(u.assets)
    && u.assets.some(a => a?.policyId === h && a.assetName === STATE_ASSET_NAME && isOne(a.quantity)));
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
 *    looked for through `verifyOwnAttestation`.
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
    const attestation = await ownAttestation(options.verifyOwnAttestation, {
      network: fresh.network,
      vaultId: id,
      manifests: fresh.manifests,
      vaultKeys: own,
      credential: ownHashes.payment,
    });
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
      conflicts: chain.conflicts,
      ownAttestation: attestation,
      depositsBlocked: !attestation.verified,
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
    const hash = manifestRevisionHash(r?.cbor);
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

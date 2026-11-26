/**
 * The checks a device makes before it acknowledges and accepts a manifest (spec 5.3, GV-60 #1728).
 *
 * `decodeManifest` and `normalizeManifest` already guarantee that the manifest is well formed and
 * that its participants are exactly the keys of the scripts it carries, each in the branch of their
 * role. On top of that, before `VAULT_ACK`:
 *
 * - the device's own entry must hold the vault keys it derives locally at its own index, in the
 *   role it agreed to, and its own binding when it expects one;
 * - every signature must verify (strict Ed25519): each binding's `deviceSig`, each participant
 *   binding's attestation, each tombstone's removal attestation, each viewer binding's
 *   `admittedBy`, and each external entry's `importSig` by the importing owner's payment key;
 * - the manifest must agree with this device's accepted history of the vault: the same hash at a
 *   version already accepted (a redelivery), or the next version extending the latest accepted
 *   revision (`checkManifestRevision`: tombstones kept, removals attested, authorisations of
 *   unchanged bodies carried forward). A different manifest at an accepted version, or one that
 *   does not extend the latest revision, is a fork: both are refused and every owner alerted;
 * - a binding whose body changed, or a device that comes back after being removed, must carry a
 *   `bindingVersion` above the highest this device ever saw for that device id, tombstones
 *   included, so an old binding (an old key agreement key) cannot be replayed;
 * - its scripts must not belong to another accepted vault on the same network.
 *
 * The history is a compact index per vault (`AcceptedVault`): the hash of every accepted
 * revision, the scripts, the binding high-water marks and the latest revision in full. Only the
 * latest revision and the incoming one are normalised, whatever the length of the history.
 *
 * Accepting a revision is a separate condition from passing these checks. A device added or
 * removed by its own participant's attestation, and a viewer admitted by one owner device, are
 * authorised now. Removing a viewer or changing an external label needs the owners' threshold
 * attestations of the revision (GV-22 #1690), which this module cannot check yet: such a result
 * has `attestationsVerified: false`, the revision is not accepted (`acceptRevision` refuses it),
 * the vault stays at its last accepted revision and no `VAULT_ACK` is sent on it.
 *
 * An acknowledgement is branded: only this module creates one, so the funding gate never takes a
 * hand-made result. It lives in memory only; after a restart the stored manifest is checked again.
 */
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { brandAck, isManifestAck } from './ackBrand';
import { AttestationRefusalCode, verifyAttestation, verifyEd25519 } from './attestation';
import { hexToBytes } from './cbor';
import { GeroVaultError } from './errors';
import { deriveVaultPublicKeys, vaultKeyHashes } from './keys';
import {
  ManifestRevisionRefusal,
  OwnerDeviceBinding,
  VaultManifest,
  WIRE_NETWORK,
  bindingDigest,
  checkManifestRevision,
  deviceRemovalDigest,
  externalImportDigest,
  lapsedAdmissions,
  manifestHash,
  manifestScripts,
  manifestTemplate,
  normalizeManifest,
  scriptsHaveCanonicalKeyOrder,
  verifyDeviceSignature,
  viewerAdmissionDigest,
} from './manifest';
import { RoleKeys, VaultNetwork, VaultPublicKeys, VaultTemplate } from './types';
import { verificationDigest } from './verificationNumber';

/** This device's own keys for one device binding. */
export interface OwnDevice {
  readonly ed25519Pub: string;
  readonly x25519Pub: string;
}

/**
 * Who this device is in the vault:
 * - a participant with script keys: its own CIP-1854 role keys and its own index for this vault
 *   (from its own vault record), the role it agreed to, and its device keys when it expects its
 *   binding to be in this revision;
 * - a viewer: its device keys only.
 */
export type OwnParticipant =
  | {
      readonly kind: 'participant';
      readonly roleKeys: RoleKeys;
      readonly index: number;
      readonly role?: 'owner' | 'backupHolder';
      readonly device?: OwnDevice;
    }
  | { readonly kind: 'viewer'; readonly device: OwnDevice };

/** Revision changes that need the owners' threshold attestations (GV-22), not verified here. */
export type UnverifiedChange = 'VIEWER_REMOVED' | 'EXTERNAL_CHANGE';

/** One accepted revision of a vault, as the history index keeps it. */
export interface AcceptedRevision {
  readonly version: number;
  readonly manifestHash: string;
}

/**
 * What a device keeps of one vault it accepted: the hash of each accepted revision by version,
 * the scripts, the high-water mark of `bindingVersion` per device id (removed devices included)
 * and the latest accepted revision in full. Built and extended by `acceptRevision` only.
 */
export interface AcceptedVault {
  readonly network: VaultNetwork;
  readonly vaultId: string;
  readonly paymentScript: string;
  readonly stakeScript: string;
  /** In version order; revision 1 and the latest `MAX_ACCEPTED_REVISIONS - 1` are kept. */
  readonly revisions: readonly AcceptedRevision[];
  readonly bindingVersions: Readonly<Record<string, number>>;
  readonly latest: VaultManifest;
}

/** Revisions kept per vault, the same bound as the recovery package's (spec 5.3). */
export const MAX_ACCEPTED_REVISIONS = 16384;

export interface ManifestAckInput {
  readonly manifest: VaultManifest;
  readonly network: VaultNetwork;
  readonly own: OwnParticipant;
  /** Every vault this device has accepted, on every network. A vault left out loses the fork, replay and script checks. */
  readonly accepted?: readonly AcceptedVault[];
}

export type ManifestAckRefusalCode =
  | 'INVALID_INPUT'
  | 'INVALID_MANIFEST'
  | 'NETWORK_MISMATCH'
  | 'VAULT_ALREADY_ACCEPTED'
  | 'MANIFEST_FORK'
  | 'UNKNOWN_VAULT'
  | 'STALE_REVISION'
  | 'REVISION_GAP'
  | 'REVISION_INVALID'
  | 'BINDING_REPLAY'
  | 'SCRIPT_OF_ANOTHER_VAULT'
  | 'OWN_ENTRY_MISSING'
  | 'OWN_KEYS_MISMATCH'
  | 'OWN_ROLE_MISMATCH'
  | 'OWN_DEVICE_MISMATCH'
  | 'DEVICE_SIGNATURE_INVALID'
  | 'ATTESTATION_INVALID'
  | 'REMOVAL_INVALID'
  | 'ADMISSION_INVALID'
  | 'IMPORT_SIGNATURE_INVALID';

export interface ManifestAck {
  readonly ok: true;
  readonly vaultId: string;
  /** The hash of the manifest checked; the funding gate takes this result for this manifest only. */
  readonly manifestHash: string;
  /** The digest the ceremony compares (`verificationNumber.ts`). */
  readonly verificationDigest: string;
  readonly template: VaultTemplate;
  readonly ownRole: 'owner' | 'backupHolder' | 'viewer';
  /** This device's payment key hash, derived from its own keys; absent for a viewer. */
  readonly ownCredential?: Ed25519KeyHashHex;
  /** A revision this device accepted already. */
  readonly redelivery: boolean;
  /**
   * Whether this revision is the latest accepted one: a redelivery of the latest revision, or the
   * next revision with every change authorised. The funding gate requires it.
   */
  readonly latest: boolean;
  /** False when the scripts list keys in another order than this wallet writes. */
  readonly canonicalKeyOrder: boolean;
  /**
   * Revision acceptance: true only when every change this manifest makes is authorised by a
   * verified signature. When false, do not accept the revision or send `VAULT_ACK`.
   */
  readonly attestationsVerified: boolean;
  readonly unverified: readonly UnverifiedChange[];
  /** Owners and backup holders with no attested binding yet: funding waits for each of them. */
  readonly unattested: readonly Ed25519KeyHashHex[];
  /** External cosigners: funding waits for each one's own attestation (`verificationNumber.ts`). */
  readonly externals: readonly Ed25519KeyHashHex[];
  /** Viewer devices whose admission lapsed with the owner device that admitted them: no standing. */
  readonly lapsedViewers: readonly string[];
  /** The high-water mark of `bindingVersion` per device id after this manifest. */
  readonly bindingVersions: Readonly<Record<string, number>>;
}

export type ManifestAckResult =
  | ManifestAck
  | {
      readonly ok: false;
      readonly code: ManifestAckRefusalCode;
      /** The credential of the participant at fault, where there is one. */
      readonly credential?: Ed25519KeyHashHex;
      /** Set on a fork: the client refuses both manifests and alerts every owner (spec 5.3). */
      readonly alert?: true;
      readonly revision?: ManifestRevisionRefusal;
      readonly attestation?: AttestationRefusalCode;
    };

type Refusal = Extract<ManifestAckResult, { ok: false }>;

const refuse = (code: ManifestAckRefusalCode, extra: Omit<Refusal, 'ok' | 'code'> = {}): Refusal => ({ ok: false, code, ...extra });

const HEX16 = /^[0-9a-f]{32}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const HEX = /^(?:[0-9a-f]{2})+$/;

function hasDevice(devices: readonly OwnerDeviceBinding[], own: OwnDevice): boolean {
  return devices.some(d => d.ed25519Pub === own?.ed25519Pub && d.x25519Pub === own?.x25519Pub);
}

function allBindings(m: VaultManifest): OwnerDeviceBinding[] {
  return [...m.roles.owners, ...m.roles.backupHolders, ...m.roles.viewers].flatMap(e => e.devices);
}

const tombstonesOf = (m: VaultManifest) => [...m.roles.owners, ...m.roles.backupHolders].flatMap(e => e.removedDevices);

/** What changed between two revisions that only threshold attestations (GV-22) can authorise. */
function unverifiedChanges(prev: VaultManifest, next: VaultManifest): UnverifiedChange[] {
  const out: UnverifiedChange[] = [];
  const viewersNow = new Set(next.roles.viewers.flatMap(e => e.devices.map(d => d.deviceId)));
  if (prev.roles.viewers.flatMap(e => e.devices).some(d => !viewersNow.has(d.deviceId))) out.push('VIEWER_REMOVED');
  const labels = (m: VaultManifest) => JSON.stringify(m.roles.external.map(e => [e.credential, e.label]));
  if (labels(prev) !== labels(next)) out.push('EXTERNAL_CHANGE');
  return out;
}

/** The shape of a stored index, checked without normalising anything. */
function wellFormedVault(v: AcceptedVault): boolean {
  if (!v || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(WIRE_NETWORK, v.network) || !HEX32.test(v.vaultId ?? '')) return false;
  if (!HEX.test(v.paymentScript ?? '') || !HEX.test(v.stakeScript ?? '') || !v.latest || typeof v.latest !== 'object') return false;
  if (!Array.isArray(v.revisions) || v.revisions.length === 0 || v.revisions.length > MAX_ACCEPTED_REVISIONS) return false;
  if (!v.revisions.every(r => Number.isSafeInteger(r?.version) && r.version >= 1 && HEX32.test(r.manifestHash ?? ''))) return false;
  const marks = v.bindingVersions;
  return Boolean(marks) && typeof marks === 'object' && Object.entries(marks).every(([id, n]) => HEX16.test(id) && Number.isSafeInteger(n) && n >= 1);
}

/**
 * The checks before `VAULT_ACK`. Never throws: any failure is a typed refusal, and the manifest
 * must then be refused (spec 5.3). A refusal with `alert` is a fork: refuse both manifests and
 * alert every owner.
 */
export async function checkManifestBeforeAck(input: ManifestAckInput): Promise<ManifestAckResult> {
  try {
    let manifest: VaultManifest;
    try {
      manifest = normalizeManifest(input?.manifest);
    } catch {
      return refuse('INVALID_MANIFEST');
    }
    const { network, own } = input;
    if (!own) return refuse('INVALID_INPUT');
    if (manifest.network !== network) return refuse('NETWORK_MISMATCH');
    const vaults = input.accepted ?? [];
    if (!Array.isArray(vaults) || !vaults.every(wellFormedVault)) return refuse('INVALID_INPUT');
    const hash = manifestHash(manifest);

    // The same scripts are one vault: no second vault id for a script of an accepted vault.
    for (const other of vaults) {
      if (other.network === manifest.network && other.vaultId !== manifest.vaultId
        && (other.paymentScript === manifest.paymentScript || other.stakeScript === manifest.stakeScript)) {
        return refuse('SCRIPT_OF_ANOTHER_VAULT');
      }
    }

    // This vault's history: hashes by version, and the latest revision, the only one normalised.
    const mine = vaults.filter(v => v.network === manifest.network && v.vaultId === manifest.vaultId);
    if (mine.length > 1) return refuse('INVALID_INPUT');
    const vault = mine[0];
    const byVersion = new Map<number, string>();
    let latest: VaultManifest | undefined;
    if (vault) {
      for (const r of vault.revisions) {
        const seen = byVersion.get(r.version);
        if (seen !== undefined && seen !== r.manifestHash) return refuse('MANIFEST_FORK', { alert: true });
        byVersion.set(r.version, r.manifestHash);
      }
      try {
        latest = normalizeManifest(vault.latest);
      } catch {
        return refuse('INVALID_INPUT');
      }
      let top = 0;
      for (const v of byVersion.keys()) top = Math.max(top, v);
      if (latest.vaultId !== vault.vaultId || latest.network !== vault.network || latest.version !== top
        || byVersion.get(top) !== manifestHash(latest) || latest.paymentScript !== vault.paymentScript || latest.stakeScript !== vault.stakeScript) {
        return refuse('INVALID_INPUT');
      }
    }

    let redelivery = false;
    let unverified: UnverifiedChange[] = [];
    const atVersion = byVersion.get(manifest.version);
    if (atVersion !== undefined) {
      if (atVersion !== hash) return refuse(manifest.version === 1 ? 'VAULT_ALREADY_ACCEPTED' : 'MANIFEST_FORK', { alert: true });
      redelivery = true;
    } else if (!latest) {
      if (manifest.version !== 1) return refuse('UNKNOWN_VAULT');
    } else if (manifest.version < latest.version) {
      return refuse('STALE_REVISION');
    } else if (manifest.version > latest.version + 1) {
      return refuse('REVISION_GAP');
    } else {
      const link = checkManifestRevision(latest, manifest);
      if (link.ok === false) {
        return refuse('REVISION_INVALID', { revision: link.code, ...(link.code === 'PREV_HASH_MISMATCH' ? { alert: true as const } : {}) });
      }
      unverified = unverifiedChanges(latest, manifest);
    }

    // Binding replay: a changed or returning device needs a bindingVersion above every one seen.
    const marks = new Map<string, number>();
    const mark = (id: string, v: number) => marks.set(id, Math.max(marks.get(id) ?? 0, v));
    for (const [id, v] of Object.entries<number>(vault?.bindingVersions ?? {})) mark(id, v);
    if (latest) {
      for (const b of allBindings(latest)) mark(b.deviceId, b.bindingVersion);
      for (const t of tombstonesOf(latest)) mark(t.deviceId, t.bindingVersion);
    }
    if (!redelivery) {
      // A binding is the same when its body is; its authorisations are carried forward with it.
      const current = new Map((latest ? allBindings(latest) : []).map(b => [b.deviceId, bindingDigest(b)]));
      for (const b of allBindings(manifest)) {
        if (current.get(b.deviceId) === bindingDigest(b)) continue;
        if (marks.has(b.deviceId) && b.bindingVersion <= marks.get(b.deviceId)) return refuse('BINDING_REPLAY', b.credential ? { credential: b.credential } : {});
      }
    }
    for (const b of allBindings(manifest)) mark(b.deviceId, b.bindingVersion);
    for (const t of tombstonesOf(manifest)) mark(t.deviceId, t.bindingVersion);

    // The device's own entry.
    const { owners, backupHolders, viewers, external } = manifest.roles;
    let ownRole: 'owner' | 'backupHolder' | 'viewer';
    let ownCredential: Ed25519KeyHashHex | undefined;
    if (own.kind === 'viewer') {
      if (!viewers.some(v => hasDevice(v.devices, own.device))) return refuse('OWN_DEVICE_MISMATCH');
      ownRole = 'viewer';
    } else if (own.kind === 'participant') {
      let keys: VaultPublicKeys;
      try {
        keys = await deriveVaultPublicKeys(own.roleKeys, own.index);
      } catch (e) {
        if (e instanceof GeroVaultError) return refuse('INVALID_INPUT');
        throw e;
      }
      const credential = (await vaultKeyHashes(keys)).payment;
      const asOwner = owners.find(e => e.credential === credential);
      const entry = asOwner ?? backupHolders.find(e => e.credential === credential);
      if (!entry) return refuse('OWN_ENTRY_MISSING', { credential });
      if (entry.vaultKeys.payment !== keys.payment || entry.vaultKeys.stake !== keys.stake) return refuse('OWN_KEYS_MISMATCH', { credential });
      ownRole = asOwner ? 'owner' : 'backupHolder';
      if (own.role !== undefined && own.role !== ownRole) return refuse('OWN_ROLE_MISMATCH', { credential });
      if (own.device !== undefined && !hasDevice(entry.devices, own.device)) return refuse('OWN_DEVICE_MISMATCH', { credential });
      ownCredential = credential;
    } else {
      return refuse('INVALID_INPUT');
    }

    // Every signature.
    for (const entry of [...owners, ...backupHolders]) {
      for (const binding of entry.devices) {
        if (!(await verifyDeviceSignature(binding))) return refuse('DEVICE_SIGNATURE_INVALID', { credential: entry.credential });
        const check = await verifyAttestation(binding.attestation, entry.credential, { kind: 'binding', digest: bindingDigest(binding) });
        if (check.ok === false) return refuse('ATTESTATION_INVALID', { credential: entry.credential, attestation: check.code });
      }
      for (const tombstone of entry.removedDevices) {
        const check = await verifyAttestation(tombstone.removal, entry.credential, { kind: 'removal', digest: deviceRemovalDigest(manifest.vaultId, tombstone) });
        if (check.ok === false) return refuse('REMOVAL_INVALID', { credential: entry.credential, attestation: check.code });
      }
    }
    // An admission verifies against the admitting owner device's key, bound now or kept in its tombstone.
    const ownerKey = new Map<string, string>(owners.flatMap(e => e.removedDevices.map(t => [t.deviceId, t.ed25519Pub] as const)));
    for (const e of owners) for (const d of e.devices) ownerKey.set(d.deviceId, d.ed25519Pub);
    for (const viewer of viewers) {
      for (const binding of viewer.devices) {
        if (!(await verifyDeviceSignature(binding))) return refuse('DEVICE_SIGNATURE_INVALID');
        const admitter = ownerKey.get(binding.admittedBy?.deviceId);
        const admitted = admitter !== undefined && await verifyEd25519(
          hexToBytes(admitter), hexToBytes(binding.admittedBy.signature), hexToBytes(viewerAdmissionDigest(binding)),
        );
        if (!admitted) return refuse('ADMISSION_INVALID');
      }
    }
    for (const entry of external) {
      const check = await verifyAttestation(entry.importSig, entry.importedBy, { kind: 'import', digest: externalImportDigest(manifest.vaultId, entry) });
      if (check.ok === false) return refuse('IMPORT_SIGNATURE_INVALID', { credential: entry.credential, attestation: check.code });
    }

    const attestationsVerified = redelivery || unverified.length === 0;
    return brandAck({
      ok: true,
      vaultId: manifest.vaultId,
      manifestHash: hash,
      verificationDigest: verificationDigest(manifest),
      template: manifestTemplate(manifest),
      ownRole,
      ...(ownCredential ? { ownCredential } : {}),
      redelivery,
      latest: redelivery ? manifest.version === latest.version : attestationsVerified,
      canonicalKeyOrder: scriptsHaveCanonicalKeyOrder(manifestScripts(manifest)),
      attestationsVerified,
      unverified: Object.freeze(unverified),
      unattested: Object.freeze([...owners, ...backupHolders].filter(e => e.devices.length === 0).map(e => e.credential)),
      externals: Object.freeze(external.map(e => e.credential)),
      lapsedViewers: lapsedAdmissions(manifest),
      bindingVersions: Object.freeze(Object.fromEntries([...marks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))),
    });
  } catch {
    return refuse('INVALID_INPUT');
  }
}

/**
 * The history index after accepting `manifest`, whose check is `ack`: the vault's first revision,
 * or the next one. A redelivery leaves the index as it is. A revision whose changes are not all
 * authorised (`attestationsVerified: false`) is not accepted, and neither is an ack of another
 * manifest. Revision 1 and the latest revisions are kept, up to `MAX_ACCEPTED_REVISIONS`. Throws
 * `GeroVaultError('INVALID_MANIFEST')`.
 */
export function acceptRevision(vault: AcceptedVault | undefined, manifest: VaultManifest, ack: ManifestAck): AcceptedVault {
  const m = normalizeManifest(manifest);
  const hash = manifestHash(m);
  if (!isManifestAck(ack) || ack.vaultId !== m.vaultId || ack.manifestHash !== hash) {
    throw new GeroVaultError('INVALID_MANIFEST', 'INVALID_ACK: the acknowledgement is not this device\'s check of this manifest');
  }
  if (!ack.attestationsVerified) throw new GeroVaultError('INVALID_MANIFEST', 'NOT_ACCEPTED: a change of this revision is not authorised yet');
  if (vault && (vault.vaultId !== m.vaultId || vault.network !== m.network)) throw new GeroVaultError('INVALID_MANIFEST', 'OTHER_VAULT');
  if (ack.redelivery) {
    if (!vault?.revisions.some(r => r.version === m.version && r.manifestHash === hash)) throw new GeroVaultError('INVALID_MANIFEST', 'NOT_IN_HISTORY');
    return vault;
  }
  if (vault ? m.version !== normalizeManifest(vault.latest).version + 1 : m.version !== 1) {
    throw new GeroVaultError('INVALID_MANIFEST', 'VERSION_NOT_NEXT');
  }
  let revisions = [...(vault?.revisions ?? []), Object.freeze({ version: m.version, manifestHash: hash })];
  if (revisions.length > MAX_ACCEPTED_REVISIONS) revisions = [revisions[0], ...revisions.slice(revisions.length - MAX_ACCEPTED_REVISIONS + 1)];
  return Object.freeze({
    network: m.network,
    vaultId: m.vaultId,
    paymentScript: m.paymentScript,
    stakeScript: m.stakeScript,
    revisions: Object.freeze(revisions),
    bindingVersions: ack.bindingVersions,
    latest: m,
  });
}

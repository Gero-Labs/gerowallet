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
 *   binding's owner attestation, each viewer binding's `admittedBy` by an owner device, and each
 *   external entry's `importSig` by the importing owner's device;
 * - the manifest must agree with this device's full accepted history of the vault: the same bytes
 *   at any version already accepted (a redelivery), or the next version extending the latest
 *   accepted revision. A different manifest at an accepted version, or one that does not extend
 *   the latest revision, is a fork: both are refused and every owner alerted;
 * - a binding whose body changed, or a device that comes back after being removed, must carry a
 *   `bindingVersion` above the highest this device ever accepted for that device id, so an old
 *   binding (an old key agreement key) cannot be replayed;
 * - its scripts must not belong to another accepted vault on the same network.
 *
 * Accepting a revision is a separate condition from passing these checks: removing a device,
 * removing a viewer or changing an external label needs the owners' threshold attestations of the
 * revision (GV-22 #1690), which this module cannot check yet. Such a result has
 * `attestationsVerified: false`; the revision is not accepted, the vault stays at its last
 * accepted revision, and no `VAULT_ACK` is sent on it. Funding does not depend on it
 * (`verificationNumber.ts`).
 *
 * An acknowledgement is branded: only this module creates one, so the funding gate never takes a
 * hand-made result. It lives in memory only; after a restart the stored manifest is checked again.
 */
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { brandAck } from './ackBrand';
import { AttestationRefusalCode, verifyAttestation, verifyEd25519 } from './attestation';
import { hexToBytes } from './cbor';
import { GeroVaultError } from './errors';
import { deriveVaultPublicKeys, vaultKeyHashes } from './keys';
import {
  ManifestRevisionRefusal,
  OwnerDeviceBinding,
  VaultManifest,
  bindingDigest,
  checkManifestRevision,
  externalImportDigest,
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
export type UnverifiedChange = 'VIEWER_REMOVED' | 'DEVICE_REMOVED' | 'EXTERNAL_CHANGE';

/** An accepted revision as this device stores it, with the status its check returned. */
export interface AcceptedManifest {
  readonly manifest: VaultManifest;
  readonly attestationsVerified: boolean;
  readonly unverified: readonly UnverifiedChange[];
}

export interface ManifestAckInput {
  readonly manifest: VaultManifest;
  readonly network: VaultNetwork;
  readonly own: OwnParticipant;
  /**
   * Every accepted revision of every vault this device has accepted, on every network: the full
   * history of each vault, not only its latest revision. A revision left out loses the fork and
   * replay checks.
   */
  readonly accepted?: readonly AcceptedManifest[];
  /**
   * This vault's high-water mark of `bindingVersion` per device id, as the device stored it (removed
   * devices included). Combined with what the history shows, the higher of the two counts.
   */
  readonly bindingVersions?: Readonly<Record<string, number>>;
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
  /** The same manifest as one already accepted (its status is the stored one). */
  readonly redelivery: boolean;
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
  /** The high-water mark of `bindingVersion` per device id after this manifest, to store. */
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

function hasDevice(devices: readonly OwnerDeviceBinding[], own: OwnDevice): boolean {
  return devices.some(d => d.ed25519Pub === own?.ed25519Pub && d.x25519Pub === own?.x25519Pub);
}

function allBindings(m: VaultManifest): OwnerDeviceBinding[] {
  return [...m.roles.owners, ...m.roles.backupHolders, ...m.roles.viewers].flatMap(e => e.devices);
}

/** What changed between two revisions that only threshold attestations (GV-22) can authorise. */
function unverifiedChanges(prev: VaultManifest, next: VaultManifest): UnverifiedChange[] {
  const out: UnverifiedChange[] = [];
  const ids = (list: readonly { devices: readonly OwnerDeviceBinding[] }[]) => new Set(list.flatMap(e => e.devices.map(d => d.deviceId)));
  const viewersNow = ids(next.roles.viewers);
  if ([...ids(prev.roles.viewers)].some(id => !viewersNow.has(id))) out.push('VIEWER_REMOVED');
  const boundNow = ids([...next.roles.owners, ...next.roles.backupHolders]);
  if ([...ids([...prev.roles.owners, ...prev.roles.backupHolders])].some(id => !boundNow.has(id))) out.push('DEVICE_REMOVED');
  const labels = (m: VaultManifest) => JSON.stringify(m.roles.external.map(e => [e.credential, e.label]));
  if (labels(prev) !== labels(next)) out.push('EXTERNAL_CHANGE');
  return out;
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
    let accepted: AcceptedManifest[];
    try {
      accepted = (Array.isArray(input.accepted) ? input.accepted : []).map(a => ({
        manifest: normalizeManifest(a?.manifest),
        attestationsVerified: a?.attestationsVerified === true,
        unverified: Array.isArray(a?.unverified) ? a.unverified : [],
      }));
    } catch {
      return refuse('INVALID_INPUT');
    }
    const hash = manifestHash(manifest);

    // The same scripts are one vault: no second vault id for a script of an accepted vault.
    for (const { manifest: other } of accepted) {
      if (other.network === manifest.network && other.vaultId !== manifest.vaultId
        && (other.paymentScript === manifest.paymentScript || other.stakeScript === manifest.stakeScript)) {
        return refuse('SCRIPT_OF_ANOTHER_VAULT');
      }
    }

    // The full history of this vault, by version.
    const history = accepted.filter(a => a.manifest.network === manifest.network && a.manifest.vaultId === manifest.vaultId);
    const byVersion = new Map<number, AcceptedManifest>();
    for (const a of history) {
      const seen = byVersion.get(a.manifest.version);
      if (seen && manifestHash(seen.manifest) !== manifestHash(a.manifest)) return refuse('MANIFEST_FORK', { alert: true });
      byVersion.set(a.manifest.version, a);
    }
    const latest = history.reduce<AcceptedManifest | undefined>((best, a) => (!best || a.manifest.version > best.manifest.version ? a : best), undefined);

    let redelivery: AcceptedManifest | undefined;
    let unverified: UnverifiedChange[] = [];
    const atVersion = byVersion.get(manifest.version);
    if (atVersion) {
      if (manifestHash(atVersion.manifest) !== hash) {
        return refuse(manifest.version === 1 ? 'VAULT_ALREADY_ACCEPTED' : 'MANIFEST_FORK', { alert: true });
      }
      redelivery = atVersion;
    } else if (!latest) {
      if (manifest.version !== 1) return refuse('UNKNOWN_VAULT');
    } else if (manifest.version < latest.manifest.version) {
      return refuse('STALE_REVISION');
    } else if (manifest.version > latest.manifest.version + 1) {
      return refuse('REVISION_GAP');
    } else {
      const link = checkManifestRevision(latest.manifest, manifest);
      if (link.ok === false) {
        return refuse('REVISION_INVALID', { revision: link.code, ...(link.code === 'PREV_HASH_MISMATCH' ? { alert: true as const } : {}) });
      }
      unverified = unverifiedChanges(latest.manifest, manifest);
    }

    // Binding replay: a changed or returning device needs a higher bindingVersion.
    const marks = new Map<string, number>();
    const mark = (id: string, v: number) => marks.set(id, Math.max(marks.get(id) ?? 0, v));
    for (const [id, v] of Object.entries(input.bindingVersions ?? {})) if (Number.isSafeInteger(v)) mark(id, v);
    for (const a of history) for (const b of allBindings(a.manifest)) mark(b.deviceId, b.bindingVersion);
    if (!redelivery) {
      // A binding is the same when its body is: a new attestation or admission of an unchanged body
      // changes nothing a replay could exploit.
      const current = new Map((latest ? allBindings(latest.manifest) : []).map(b => [b.deviceId, bindingDigest(b)]));
      for (const b of allBindings(manifest)) {
        if (current.get(b.deviceId) === bindingDigest(b)) continue;
        if (marks.has(b.deviceId) && b.bindingVersion <= marks.get(b.deviceId)) return refuse('BINDING_REPLAY', b.credential ? { credential: b.credential } : {});
      }
    }
    for (const b of allBindings(manifest)) mark(b.deviceId, b.bindingVersion);

    // The device's own entry.
    const { owners, backupHolders, viewers, external } = manifest.roles;
    let ownRole: 'owner' | 'backupHolder' | 'viewer';
    let ownCredential: Ed25519KeyHashHex | undefined;
    if (own.kind === 'viewer') {
      if (!viewers.some(v => hasDevice(v.devices, own.device))) return refuse('OWN_DEVICE_MISMATCH');
      ownRole = 'viewer';
    } else if (own.kind === 'participant') {
      let mine: VaultPublicKeys;
      try {
        mine = await deriveVaultPublicKeys(own.roleKeys, own.index);
      } catch (e) {
        if (e instanceof GeroVaultError) return refuse('INVALID_INPUT');
        throw e;
      }
      const credential = (await vaultKeyHashes(mine)).payment;
      const asOwner = owners.find(e => e.credential === credential);
      const entry = asOwner ?? backupHolders.find(e => e.credential === credential);
      if (!entry) return refuse('OWN_ENTRY_MISSING', { credential });
      if (entry.vaultKeys.payment !== mine.payment || entry.vaultKeys.stake !== mine.stake) return refuse('OWN_KEYS_MISMATCH', { credential });
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
    }
    const ownerDevice = new Map(owners.flatMap(e => e.devices.map(d => [d.deviceId, d] as const)));
    for (const viewer of viewers) {
      for (const binding of viewer.devices) {
        if (!(await verifyDeviceSignature(binding))) return refuse('DEVICE_SIGNATURE_INVALID');
        const admitter = ownerDevice.get(binding.admittedBy?.deviceId);
        const admitted = admitter && await verifyEd25519(
          hexToBytes(admitter.ed25519Pub), hexToBytes(binding.admittedBy.signature), hexToBytes(viewerAdmissionDigest(binding)),
        );
        if (!admitted) return refuse('ADMISSION_INVALID');
      }
    }
    for (const entry of external) {
      const importer = ownerDevice.get(entry.importerDeviceId);
      const signed = importer && await verifyEd25519(
        hexToBytes(importer.ed25519Pub), hexToBytes(entry.importSig), hexToBytes(externalImportDigest(manifest.vaultId, entry)),
      );
      if (!signed) return refuse('IMPORT_SIGNATURE_INVALID', { credential: entry.credential });
    }

    const attestationsVerified = redelivery ? redelivery.attestationsVerified : unverified.length === 0;
    return brandAck({
      ok: true,
      vaultId: manifest.vaultId,
      manifestHash: hash,
      verificationDigest: verificationDigest(manifest),
      template: manifestTemplate(manifest),
      ownRole,
      ...(ownCredential ? { ownCredential } : {}),
      redelivery: Boolean(redelivery),
      canonicalKeyOrder: scriptsHaveCanonicalKeyOrder(manifestScripts(manifest)),
      attestationsVerified,
      unverified: Object.freeze(redelivery ? [...redelivery.unverified] : unverified),
      unattested: Object.freeze([...owners, ...backupHolders].filter(e => e.devices.length === 0).map(e => e.credential)),
      externals: Object.freeze(external.map(e => e.credential)),
      bindingVersions: Object.freeze(Object.fromEntries([...marks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))),
    });
  } catch {
    return refuse('INVALID_INPUT');
  }
}

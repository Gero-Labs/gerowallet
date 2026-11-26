/**
 * The checks a device makes before it acknowledges a manifest (spec 5.3, GV-60 #1728).
 *
 * `decodeManifest` and `normalizeManifest` already guarantee that the manifest is well formed and
 * that its participants are exactly the keys of the scripts it carries, each in the branch of their
 * role. On top of that, before `VAULT_ACK`:
 *
 * - the device's own entry must hold the vault keys it derives locally at its own index, in the
 *   role it agreed to, and its own binding when it expects one;
 * - every device binding's `deviceSig` and every participant binding's attestation must verify;
 * - the manifest must follow the latest manifest this device accepted for the vault: a first
 *   manifest only for a vault it never accepted (or the same one again), a revision only as the
 *   next version of the latest accepted one, never two different manifests of one version;
 * - its scripts must not belong to another accepted vault on the same network.
 *
 * A revision can change devices, viewers and labels. A participant's new binding carries that
 * participant's own attestation, which is verified here; removing a device or changing viewers or
 * external labels needs the owners' threshold attestations of the revision (GV-22 #1690), which
 * this module cannot check yet. Such a result has `attestationsVerified: false`, and no
 * `VAULT_ACK` may be sent on it.
 */
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { AttestationRefusalCode, verifyAttestation } from './attestation';
import { GeroVaultError } from './errors';
import { deriveVaultPublicKeys, vaultKeyHashes } from './keys';
import {
  ManifestRevisionRefusal,
  OwnerDeviceBinding,
  VaultManifest,
  bindingDigest,
  checkManifestRevision,
  manifestHash,
  manifestScripts,
  manifestTemplate,
  normalizeManifest,
  scriptsHaveCanonicalKeyOrder,
  verifyDeviceSignature,
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

export interface ManifestAckInput {
  readonly manifest: VaultManifest;
  readonly network: VaultNetwork;
  readonly own: OwnParticipant;
  /**
   * The latest accepted manifest of every vault this device has accepted, on every network. A
   * vault left out loses the fork, duplicate and chain checks.
   */
  readonly accepted?: readonly VaultManifest[];
}

/** Revision changes whose authorisation (threshold attestations, GV-22) is not verified here. */
export type UnverifiedChange = 'VIEWER_CHANGE' | 'DEVICE_REMOVED' | 'EXTERNAL_CHANGE';

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
  | 'SCRIPT_OF_ANOTHER_VAULT'
  | 'OWN_ENTRY_MISSING'
  | 'OWN_KEYS_MISMATCH'
  | 'OWN_ROLE_MISMATCH'
  | 'OWN_DEVICE_MISMATCH'
  | 'DEVICE_SIGNATURE_INVALID'
  | 'ATTESTATION_INVALID';

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
  /** The same manifest as the one accepted (a redelivery). */
  readonly redelivery: boolean;
  /** False when the scripts list keys in another order than this wallet writes. */
  readonly canonicalKeyOrder: boolean;
  /** True only when every change this manifest makes is authorised by a verified signature. */
  readonly attestationsVerified: boolean;
  readonly unverified: readonly UnverifiedChange[];
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

/** What changed between two revisions that only threshold attestations (GV-22) can authorise. */
function unverifiedChanges(prev: VaultManifest, next: VaultManifest): UnverifiedChange[] {
  const out: UnverifiedChange[] = [];
  const viewers = (m: VaultManifest) => JSON.stringify(m.roles.viewers.map(v => v.devices.map(d => [d.deviceId, d.x25519Pub, d.label, d.bindingVersion])));
  if (viewers(prev) !== viewers(next)) out.push('VIEWER_CHANGE');
  const bound = (m: VaultManifest) => new Set([...m.roles.owners, ...m.roles.backupHolders].flatMap(e => e.devices.map(d => d.deviceId)));
  const now = bound(next);
  if ([...bound(prev)].some(id => !now.has(id))) out.push('DEVICE_REMOVED');
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
    let accepted: VaultManifest[];
    try {
      accepted = (Array.isArray(input.accepted) ? input.accepted : []).map(normalizeManifest);
    } catch {
      return refuse('INVALID_INPUT');
    }
    const hash = manifestHash(manifest);

    // The same scripts are one vault: no second vault id for a script of an accepted vault.
    for (const other of accepted) {
      if (other.network === manifest.network && other.vaultId !== manifest.vaultId
        && (other.paymentScript === manifest.paymentScript || other.stakeScript === manifest.stakeScript)) {
        return refuse('SCRIPT_OF_ANOTHER_VAULT');
      }
    }

    // The chain: follow the latest accepted manifest of this vault.
    const latest = accepted.find(m => m.network === manifest.network && m.vaultId === manifest.vaultId);
    let redelivery = false;
    let unverified: UnverifiedChange[] = [];
    if (!latest) {
      if (manifest.version !== 1) return refuse('UNKNOWN_VAULT');
    } else if (manifest.version === latest.version) {
      if (manifestHash(latest) !== hash) {
        return refuse(manifest.version === 1 ? 'VAULT_ALREADY_ACCEPTED' : 'MANIFEST_FORK', { alert: true });
      }
      redelivery = true;
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

    // The device's own entry.
    const { owners, backupHolders, viewers } = manifest.roles;
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

    // Every binding: the device's own signature, and the participant's attestation.
    for (const entry of [...owners, ...backupHolders]) {
      for (const binding of entry.devices) {
        if (!(await verifyDeviceSignature(binding))) return refuse('DEVICE_SIGNATURE_INVALID', { credential: entry.credential });
        const check = await verifyAttestation(binding.attestation, entry.credential, { kind: 'binding', digest: bindingDigest(binding) });
        if (check.ok === false) return refuse('ATTESTATION_INVALID', { credential: entry.credential, attestation: check.code });
      }
    }
    for (const viewer of viewers) {
      for (const binding of viewer.devices) {
        if (!(await verifyDeviceSignature(binding))) return refuse('DEVICE_SIGNATURE_INVALID');
      }
    }

    return {
      ok: true,
      vaultId: manifest.vaultId,
      manifestHash: hash,
      verificationDigest: verificationDigest(manifest),
      template: manifestTemplate(manifest),
      ownRole,
      ...(ownCredential ? { ownCredential } : {}),
      redelivery,
      canonicalKeyOrder: scriptsHaveCanonicalKeyOrder(manifestScripts(manifest)),
      attestationsVerified: unverified.length === 0,
      unverified: Object.freeze(unverified),
    };
  } catch {
    return refuse('INVALID_INPUT');
  }
}

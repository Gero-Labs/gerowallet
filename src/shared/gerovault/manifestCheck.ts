/**
 * The key checks a device makes before it acknowledges a manifest (spec 5.3, GV-60 #1728).
 *
 * - The device's own entry matches the keys it derives locally at its own index.
 * - Every other participant's vault keys hash to the key hashes in the scripts. For an external
 *   cosigner, whose manifest entry is a credential only, the device uses the keys it holds for
 *   them (an xpub the external wallet gave, from which it derives their keys, or their vault
 *   keys) and checks them the same way.
 * - The manifest names the scripts' vault: its vault id is the id `vaultId.ts` derives from the
 *   scripts and the network, and a first manifest for a vault this device already accepted is
 *   refused, so a duplicate registration of an accepted vault's scripts never makes a second vault.
 *
 * The scripts are the ones this device holds for the vault: decoded from its registration, or
 * built locally. The manifest carries only their hashes, so the scripts of a dated backup vault
 * (backup threshold, backup slot) must reach the device with them.
 *
 * The per-participant checks reuse `rebuildFromRegistration`: every key hash of both scripts must
 * belong to exactly one participant, each participant's payment key in the payment script and
 * stake key in the stake script, and the template rebuilt from those keys must give the same
 * hashes. On top of that, each role slot must match the participant's place in the scripts.
 */
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { GeroVaultError } from './errors';
import { deriveVaultPublicKeys, vaultKeyHashes } from './keys';
import { ManifestRole, VaultManifest, normalizeManifest } from './manifest';
import { DecodedRegistration, RebuildParticipant, RebuildRefusalCode, rebuildFromRegistration } from './registration';
import { vaultScript } from './scripts';
import { ROLE, RoleKeys, VaultNetwork, VaultPublicKeys, VaultScripts, VaultTemplate } from './types';
import { vaultId } from './vaultId';

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

/** Keys this device holds for an external cosigner: their role keys (scanned) or vault keys. */
export type ExternalCosignerKeys = { readonly roleKeys: RoleKeys } | { readonly vaultKeys: VaultPublicKeys };

export interface ManifestAckInput {
  readonly manifest: VaultManifest;
  readonly scripts: Pick<VaultScripts, 'payment' | 'stake'>;
  readonly network: VaultNetwork;
  readonly own: OwnParticipant;
  /** Keyed by the external entry's credential. Every external cosigner needs an entry here. */
  readonly externalKeys?: Readonly<Record<string, ExternalCosignerKeys>>;
  /** Ids of the vaults this device has accepted. */
  readonly acceptedVaultIds?: readonly string[];
}

export type ManifestAckRefusalCode =
  | 'INVALID_INPUT'
  | 'INVALID_MANIFEST'
  | 'NETWORK_MISMATCH'
  | 'SCRIPT_HASH_MISMATCH'
  | 'VAULT_ID_MISMATCH'
  | 'VAULT_ALREADY_ACCEPTED'
  | 'OWN_ENTRY_MISSING'
  | 'OWN_KEYS_MISMATCH'
  | 'OWN_ROLE_MISMATCH'
  | 'OWN_DEVICE_MISMATCH'
  | 'EXTERNAL_KEYS_REQUIRED'
  | 'EXTERNAL_CREDENTIAL_MISMATCH'
  | 'UNKNOWN_TEMPLATE'
  | 'TEMPLATE_MISMATCH'
  | 'KEY_NOT_IN_SCRIPT'
  | 'ROLE_INDEX_MISMATCH'
  | 'SCRIPT_KEY_UNACCOUNTED'
  | 'DUPLICATE_PARTICIPANT'
  | 'ROLE_MISMATCH'
  | 'THRESHOLD_MISMATCH'
  | 'OUTSIDE_POLICY'
  | 'SCRIPT_MISMATCH';

export type ManifestAckResult =
  | {
      readonly ok: true;
      readonly vaultId: string;
      readonly template: VaultTemplate;
      readonly ownRole: Extract<ManifestRole, 'owner' | 'backupHolder' | 'viewer'>;
    }
  | {
      readonly ok: false;
      readonly code: ManifestAckRefusalCode;
      /** The credential of the participant at fault, where there is one. */
      readonly credential?: Ed25519KeyHashHex;
    };

const FROM_REBUILD: Readonly<Record<RebuildRefusalCode, ManifestAckRefusalCode>> = {
  INVALID_OPTIONS: 'INVALID_INPUT',
  STAKE_SCRIPT_MISSING: 'UNKNOWN_TEMPLATE',
  UNKNOWN_TEMPLATE: 'UNKNOWN_TEMPLATE',
  TEMPLATE_MISMATCH: 'TEMPLATE_MISMATCH',
  FOREIGN_KEY: 'SCRIPT_KEY_UNACCOUNTED',
  PARTICIPANT_NOT_IN_VAULT: 'KEY_NOT_IN_SCRIPT',
  PARTICIPANT_INCOMPLETE: 'KEY_NOT_IN_SCRIPT',
  ROLE_INDEX_MISMATCH: 'ROLE_INDEX_MISMATCH',
  DUPLICATE_PARTICIPANT: 'DUPLICATE_PARTICIPANT',
  OUTSIDE_POLICY: 'OUTSIDE_POLICY',
  INVALID_VAULT: 'SCRIPT_MISMATCH',
  SCRIPT_MISMATCH: 'SCRIPT_MISMATCH',
};

type Refusal = Extract<ManifestAckResult, { ok: false }>;

const refuse = (code: ManifestAckRefusalCode, credential?: Ed25519KeyHashHex): Refusal =>
  credential ? { ok: false, code, credential } : { ok: false, code };

function hasDevice(devices: readonly { ed25519Pub: string; x25519Pub: string }[], own: OwnDevice): boolean {
  return devices.some(d => d.ed25519Pub === own?.ed25519Pub && d.x25519Pub === own?.x25519Pub);
}

/** Whether each script's CBOR and hash are what `scripts.ts` writes for its script, in its role. */
function consistentScripts(scripts: Pick<VaultScripts, 'payment' | 'stake'>): boolean {
  const same = (role: typeof ROLE.PAYMENT | typeof ROLE.STAKE, s: VaultScripts['payment']) => {
    if (!s?.script || s.role !== role) return false;
    const rebuilt = vaultScript(role, s.script);
    return rebuilt.cbor === s.cbor && rebuilt.hash === s.hash;
  };
  return same(ROLE.PAYMENT, scripts?.payment) && same(ROLE.STAKE, scripts?.stake);
}

interface Slot {
  readonly role: 'owner' | 'backupHolder' | 'external';
  readonly credential: Ed25519KeyHashHex;
}

/**
 * The checks before `VAULT_ACK`. Never throws: any failure is a typed refusal, and the manifest
 * must then be refused (spec 5.3).
 */
export async function checkManifestBeforeAck(input: ManifestAckInput): Promise<ManifestAckResult> {
  try {
    let manifest: VaultManifest;
    try {
      manifest = normalizeManifest(input?.manifest);
    } catch {
      return refuse('INVALID_MANIFEST');
    }
    const { scripts, network, own } = input;
    if (!consistentScripts(scripts) || !own) return refuse('INVALID_INPUT');
    if (manifest.network !== network) return refuse('NETWORK_MISMATCH');
    if (manifest.scriptHash !== scripts.payment.hash || manifest.stakeScriptHash !== scripts.stake.hash) {
      return refuse('SCRIPT_HASH_MISMATCH');
    }
    const id = vaultId(scripts, network);
    if (manifest.vaultId !== id) return refuse('VAULT_ID_MISMATCH');
    const accepted = Array.isArray(input.acceptedVaultIds) ? input.acceptedVaultIds.map(v => String(v).toLowerCase()) : [];
    if (manifest.version === 1 && accepted.includes(id)) return refuse('VAULT_ALREADY_ACCEPTED');

    const { owners, backupHolders, viewers, external } = manifest.roles;
    let ownRole: 'owner' | 'backupHolder' | 'viewer';
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
      if (!entry) return refuse('OWN_ENTRY_MISSING', credential);
      if (entry.vaultKeys.payment !== mine.payment || entry.vaultKeys.stake !== mine.stake) return refuse('OWN_KEYS_MISMATCH', credential);
      ownRole = asOwner ? 'owner' : 'backupHolder';
      if (own.role !== undefined && own.role !== ownRole) return refuse('OWN_ROLE_MISMATCH', credential);
      if (own.device !== undefined && !hasDevice(entry.devices, own.device)) return refuse('OWN_DEVICE_MISMATCH', credential);
    } else {
      return refuse('INVALID_INPUT');
    }

    // Every participant with script keys, in one list for the rebuild.
    const slots: Slot[] = [];
    const participants: RebuildParticipant[] = [];
    for (const [list, role] of [[owners, 'owner'], [backupHolders, 'backupHolder']] as const) {
      for (const e of list) {
        slots.push({ role, credential: e.credential });
        participants.push({ kind: 'vaultKeys', keys: e.vaultKeys });
      }
    }
    const held = input.externalKeys ?? {};
    for (const e of external) {
      const keys = Object.prototype.hasOwnProperty.call(held, e.credential) ? held[e.credential] : undefined;
      if (keys && 'roleKeys' in keys && keys.roleKeys) participants.push({ kind: 'external', roleKeys: keys.roleKeys });
      else if (keys && 'vaultKeys' in keys && keys.vaultKeys) participants.push({ kind: 'vaultKeys', keys: keys.vaultKeys });
      else return refuse('EXTERNAL_KEYS_REQUIRED', e.credential);
      slots.push({ role: 'external', credential: e.credential });
    }

    const registration: DecodedRegistration = {
      encryption: 'none',
      scripts: [scripts.payment, scripts.stake],
      payment: scripts.payment,
      stake: scripts.stake,
      participants: {},
    };
    const rebuilt = await rebuildFromRegistration(registration, participants);
    if (rebuilt.ok === false) return refuse(FROM_REBUILD[rebuilt.code] ?? 'SCRIPT_MISMATCH', slots[rebuilt.participant]?.credential);

    // Each role slot must be the participant's place in the scripts.
    const place = (positions: readonly number[], keys: VaultScripts['owners'], kind: 'owner' | 'backupHolder'): Refusal | undefined => {
      for (let k = 0; k < positions.length; k++) {
        const slot = slots[positions[k]];
        if (slot.role === 'external') {
          if (keys[k].payment !== slot.credential) return refuse('EXTERNAL_CREDENTIAL_MISMATCH', slot.credential);
        } else if (slot.role !== kind) {
          return refuse('ROLE_MISMATCH', slot.credential);
        }
      }
      return undefined;
    };
    const misplaced = place(rebuilt.owners, rebuilt.vault.owners, 'owner') ?? place(rebuilt.backups, rebuilt.vault.backups, 'backupHolder');
    if (misplaced) return misplaced;
    if (rebuilt.vault.template.threshold !== manifest.threshold) return refuse('THRESHOLD_MISMATCH');

    return { ok: true, vaultId: id, template: rebuilt.vault.template, ownRole };
  } catch {
    return refuse('INVALID_INPUT');
  }
}

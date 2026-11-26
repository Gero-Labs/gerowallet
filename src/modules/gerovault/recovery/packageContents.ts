/**
 * Between the vault store and the recovery package: the package contents a stored vault exports,
 * and the store candidate a restored package becomes. Pure, and checked again on both sides: the
 * export rebuilds the scripts from these keys, and the store checks the candidate on write.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { bech32 } from 'bech32';
import {
  BECH32_PREFIX,
  decodeManifest,
  parseVaultPublicKeys,
  readLabel,
  type ManifestRevision,
  type PackageParticipant,
  type RecoveryPackage,
  type RecoveryPackageContents,
  type RestoredNativeCandidate,
  type VaultPublicKeys,
} from '@/shared/gerovault';
import { bytesToHex, hexToBytes } from '@/shared/gerovault/cbor';
import type { VaultCandidateInput, VaultParticipantInput, VaultRecord } from '@/modules/gerovault/contracts';
import { vaultFacts } from '@/modules/gerovault/detail/vaultFacts';

const BECH32_LIMIT = 1023;

/**
 * The package contents for one stored vault, exported by this wallet's own participant.
 *
 * The store keeps the accepted manifest revision, not the history before it, so the package carries
 * that one revision. Proposals, the address book and reference scripts are not kept by the slice.
 * Throws a `TypeError` for a record whose scripts do not read as a vault (the store never writes one).
 */
export function recoveryContentsFromRecord(record: VaultRecord, exportedAtMs: number): RecoveryPackageContents {
  const facts = vaultFacts(record);
  if (!facts) throw new TypeError('The vault\'s scripts do not read as a vault template');
  const position = facts.participants.findIndex(p => p.self);
  if (position < 0) throw new TypeError('The vault has no entry for this wallet');
  const participants: PackageParticipant[] = facts.participants.map(p => {
    const keys = parseVaultPublicKeys(p.vaultKeys);
    const label = readLabel(p.label);
    return {
      role: p.role === 'owner' ? 'owner' : 'backup',
      payment: keys.payment,
      stake: keys.stake,
      ...(label !== undefined ? { label } : {}),
    };
  });
  const backup = facts.template.backup;
  const manifests: ManifestRevision[] = record.manifest ? [{ version: record.manifest.version, cbor: record.manifest.cbor }] : [];
  return {
    network: record.network,
    exportedAtMs,
    vault: {
      kind: 'native',
      payment: facts.payment,
      stake: facts.stake,
      ...(backup ? { backup: { threshold: backup.threshold, afterSlot: backup.afterSlot } } : {}),
    },
    self: { position, index: record.ownIndex },
    participants,
    manifests,
    proposals: [],
    addressBook: [],
    referenceScripts: [],
  };
}

/** The hash a script names a raw Ed25519 key by: blake2b-224, lowercase hex; '' for a key that is not hex. */
export function keyHashOf(publicKeyHex: string | undefined): string {
  const bytes = typeof publicKeyHex === 'string' ? hexToBytes(publicKeyHex) : undefined;
  return bytes ? bytesToHex(blake2b(bytes, { dkLen: 28 })) : '';
}

/** A package participant's raw keys as the store takes them. Throws for keys that are not a vault's. */
export function vaultKeysOf(p: Pick<PackageParticipant, 'payment' | 'stake'>): VaultPublicKeys {
  const words = (hex: string | undefined) => {
    const bytes = typeof hex === 'string' ? hexToBytes(hex) : undefined;
    if (!bytes) throw new TypeError('A vault key is 32 bytes of hex');
    return bech32.toWords(bytes);
  };
  return parseVaultPublicKeys({
    payment: bech32.encode(BECH32_PREFIX.PAYMENT_VK, words(p.payment), BECH32_LIMIT),
    stake: bech32.encode(BECH32_PREFIX.STAKE_VK, words(p.stake), BECH32_LIMIT),
  });
}

/**
 * The package's newest manifest revision, when it decodes as this very vault (same id, network and
 * scripts); undefined otherwise. The store checks it again on write.
 */
export function latestManifestFor(pkg: Pick<RecoveryPackage, 'manifests'>, candidate: RestoredNativeCandidate): string | undefined {
  const newest = [...pkg.manifests].sort((a, b) => b.version - a.version)[0];
  if (!newest) return undefined;
  const decoded = decodeManifest(newest.cbor);
  if (decoded.ok !== true) return undefined;
  const m = decoded.manifest;
  const ours = m.vaultId === candidate.vaultId && m.network === candidate.network
    && m.paymentScript === candidate.scripts.payment.cbor && m.stakeScript === candidate.scripts.stake.cbor
    && m.version === newest.version;
  return ours ? decoded.cbor : undefined;
}

/** The store candidate for a restored native vault: origin `restored`, labels kept as the package's claims. */
export function candidateInputFromRestore(candidate: RestoredNativeCandidate, pkg: Pick<RecoveryPackage, 'manifests'>): VaultCandidateInput {
  const participants: VaultParticipantInput[] = candidate.participants.map((p, i) => {
    if (p.role === 'guardian') throw new TypeError('A native vault has no guardians');
    const label = readLabel(p.label);
    return {
      role: p.role === 'owner' ? 'owner' : 'backupHolder',
      vaultKeys: vaultKeysOf(p),
      ...(label !== undefined ? { label } : {}),
      self: i === candidate.self.position,
    };
  });
  const manifest = latestManifestFor(pkg, candidate);
  return {
    vaultId: candidate.vaultId,
    network: candidate.network,
    origin: 'restored',
    paymentScriptCbor: candidate.scripts.payment.cbor,
    stakeScriptCbor: candidate.scripts.stake.cbor,
    participants,
    ownIndex: candidate.self.index,
    ...(manifest !== undefined ? { manifest } : {}),
  };
}

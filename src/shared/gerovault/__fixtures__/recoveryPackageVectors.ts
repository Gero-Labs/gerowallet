/**
 * Recovery package test vectors (GV-14). PROVISIONAL: not frozen until they match the other
 * client's vectors.
 *
 * Nothing here is a real wallet or a real secret. The participants are the published
 * cardano-addresses account key and test cosigners generated from fixed entropy bytes
 * (`vectors.ts`); the passphrase, salt and nonce are fixed test values.
 *
 * - `standard`: preprod, 2 of 3, every participant at vault index 1 (the standard vault of the
 *   vault identifier vectors in `vaultId.spec.ts`), exported by the published account key, every
 *   other section empty. Its whole file is pinned at full Argon2id strength.
 * - `backup`: preprod, owners the published key and cosigner 1 (threshold 2), backup holder
 *   cosigner 2 as an external wallet that supplied its role keys (threshold 1, from slot
 *   200000000), exported by the backup holder, every section filled. Payload pinned.
 * - `plutus`: preview, owners the published key and cosigner 1, guardian cosigner 2 at index 7,
 *   a seed reference, template version 1 and recorded hash and validator. Payload pinned.
 */
import { Cardano } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { bech32 } from 'bech32';
import { BECH32_PREFIX, deriveRoleKeys, deriveVaultPublicKeys } from '../keys';
import { buildVaultFromParticipants } from '../scripts';
import { PackageParticipant, RecoveryPackageContents } from '../recoveryPayload';
import { RoleKeys, VaultScripts } from '../types';
import { publishedAccountKey, testCosignerAccount } from './vectors';

export const RECOVERY_PASSPHRASE = 'GeroVault recovery vector: correct horse battery staple';
export const RECOVERY_SALT = Uint8Array.from({ length: 16 }, (_, i) => i);
export const RECOVERY_NONCE = Uint8Array.from({ length: 24 }, (_, i) => 0x40 + i);
/** 2026-11-26T00:00:00Z */
export const EXPORTED_AT_MS = 1795651200000;
/** 2028-11-26T12:00:00Z, the backup date of the backup vector. */
export const BACKUP_AT_MS = 1858852800000;
export const BACKUP_AFTER_SLOT = 200_000_000;

export async function vectorPeople(): Promise<RoleKeys[]> {
  return Promise.all([publishedAccountKey(), testCosignerAccount(1), testCosignerAccount(2)].map(async a => deriveRoleKeys(await a)));
}

const xvk = (prefix: string, hex: string) => bech32.encode(prefix, bech32.toWords(Buffer.from(hex, 'hex')), 1023);

/** The role keys as an external wallet supplies them (`addr_shared_xvk1...`, `stake_shared_xvk1...`). */
export function externalRoleKeys(keys: RoleKeys): { payment: string; stake: string } {
  return { payment: xvk(BECH32_PREFIX.PAYMENT_XVK, keys.payment.hex), stake: xvk(BECH32_PREFIX.STAKE_XVK, keys.stake.hex) };
}

export async function participantAt(keys: RoleKeys, index: number, role: PackageParticipant['role']): Promise<PackageParticipant> {
  const v = await deriveVaultPublicKeys(keys, index);
  return role === 'guardian' ? { role, payment: v.payment } : { role, payment: v.payment, stake: v.stake };
}

export async function standardVault(people: readonly RoleKeys[]): Promise<VaultScripts> {
  return buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: people.map(roleKeys => ({ roleKeys, index: 1 })) });
}

export async function backupVault(people: readonly RoleKeys[]): Promise<VaultScripts> {
  return buildVaultFromParticipants({
    template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: BACKUP_AFTER_SLOT },
    owners: people.slice(0, 2).map(roleKeys => ({ roleKeys, index: 1 })),
    backups: [{ roleKeys: people[2], index: 1 }],
  });
}

const EMPTY = { manifests: [], proposals: [], addressBook: [], referenceScripts: [] } as const;

export async function standardContents(people: readonly RoleKeys[], exporter = 0): Promise<RecoveryPackageContents> {
  const vault = await standardVault(people);
  return {
    network: 'preprod',
    exportedAtMs: EXPORTED_AT_MS,
    vault: { kind: 'native', payment: vault.payment, stake: vault.stake },
    self: { position: exporter, index: 1 },
    participants: await Promise.all(people.map(p => participantAt(p, 1, 'owner'))),
    ...EMPTY,
  };
}

/** A test enterprise address on preprod, for the address book. */
export const ADDRESS_BOOK_ADDRESS = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
  type: Cardano.CredentialType.KeyHash,
  hash: Hash28ByteBase16('1c'.repeat(28)),
}).toAddress().toBech32();

export async function backupContents(people: readonly RoleKeys[]): Promise<RecoveryPackageContents> {
  const vault = await backupVault(people);
  const [owner0, owner1, holder] = await Promise.all([
    participantAt(people[0], 1, 'owner'),
    participantAt(people[1], 1, 'owner'),
    participantAt(people[2], 1, 'backup'),
  ]);
  return {
    network: 'preprod',
    exportedAtMs: EXPORTED_AT_MS,
    vault: {
      kind: 'native',
      payment: vault.payment,
      stake: vault.stake,
      backup: { threshold: 1, afterSlot: BACKUP_AFTER_SLOT, atMs: BACKUP_AT_MS },
    },
    // The backup holder exports; cosigner 1 is recorded as an external wallet with its role keys.
    self: { position: 2, index: 1 },
    participants: [owner0, { ...owner1, external: externalRoleKeys(people[1]) }, holder],
    manifests: [
      { version: 0, cbor: 'a1006d6765726f2d7661756c742f7631' },
      { version: 1, cbor: 'a2006d6765726f2d7661756c742f76310101' },
    ],
    proposals: [{ id: '5a'.repeat(32), cbor: '8301020c' }],
    addressBook: [{ address: ADDRESS_BOOK_ADDRESS, label: 'Payroll' }],
    referenceScripts: [{ txId: 'be'.repeat(32), index: 0 }],
  };
}

export async function plutusContents(people: readonly RoleKeys[]): Promise<RecoveryPackageContents> {
  return {
    network: 'preview',
    exportedAtMs: EXPORTED_AT_MS,
    vault: {
      kind: 'plutus',
      seed: { txId: '0f'.repeat(32), index: 3 },
      templateVersion: 1,
      scriptHash: Hash28ByteBase16('ab'.repeat(28)),
      validator: '590101000033222220051200120011',
    },
    self: { position: 0, index: 1 },
    participants: [
      await participantAt(people[0], 1, 'guardian').then(p => ({ ...p, role: 'owner' as const })),
      await participantAt(people[1], 1, 'guardian').then(p => ({ ...p, role: 'owner' as const })),
      await participantAt(people[2], 7, 'guardian'),
    ],
    ...EMPTY,
    referenceScripts: [{ txId: '0e'.repeat(32), index: 0 }],
  };
}

/** A key hash for scripts that are not the vault's. */
export const OTHER_KEY_HASH = Ed25519KeyHashHex('42'.repeat(28));

/**
 * Shared types of the GeroVault core library: CIP-1854 role keys, native vault scripts and the
 * CIP-0146 registration codec. Pure data, no Vue, no storage, no network.
 */
import type { Cardano } from '@cardano-sdk/core';
import type { Bip32PublicKeyHex, Ed25519KeyHashHex, Ed25519PublicKeyHex, Hash28ByteBase16 } from '@cardano-sdk/crypto';

/** CIP-1854 roles a vault uses: 0 is payment, 2 is stake. Role 1 is unused for multisig keys. */
export const ROLE = { PAYMENT: 0, STAKE: 2 } as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

export const CIP1854_PURPOSE = 1854;
export const CARDANO_COIN_TYPE = 1815;
/** CIP-0146 fixes the multisig account at 0' for interoperability. */
export const CIP146_ACCOUNT = 0;
/** Soft index domain of CIP-1854: 0 to 2^31 - 1. */
export const MAX_VAULT_INDEX = 0x7fffffff;

/** Cardano networks a vault can live on. */
export type VaultNetwork = 'mainnet' | 'preprod' | 'preview';

declare const accountKeyBrand: unique symbol;
declare const roleKeyBrand: unique symbol;

/**
 * The wallet's own CIP-1854 account-level extended public key (`m/1854'/1815'/0'`).
 * It stays on this device: knowing it reveals every key of every vault the wallet will ever
 * join, so nothing in this library encodes it for sharing. Build it with
 * `multisigAccountPublicKey()`.
 */
export interface MultisigAccountPublicKey {
  readonly [accountKeyBrand]: true;
  readonly level: 'account';
  readonly hex: Bip32PublicKeyHex;
}

/**
 * A role-level extended public key (`m/1854'/1815'/0'/0` or `.../2`). Only `keys.ts` creates
 * one, by deriving it from an account key or by parsing a cosigner's shared key.
 */
export interface RolePublicKey<R extends Role = Role> {
  readonly [roleKeyBrand]: true;
  readonly level: 'role';
  readonly role: R;
  readonly hex: Bip32PublicKeyHex;
}

/** What a cosigner shares with the others: the payment and stake role keys, never the account key. */
export interface SharedRoleKeys {
  readonly payment: RolePublicKey<typeof ROLE.PAYMENT>;
  readonly stake: RolePublicKey<typeof ROLE.STAKE>;
}

/** The bech32 form of `SharedRoleKeys` (CIP-1854 user-facing encoding, CIP-5 prefixes). */
export interface EncodedSharedRoleKeys {
  /** `addr_shared_xvk1...` */
  readonly payment: string;
  /** `stake_shared_xvk1...` */
  readonly stake: string;
}

/** One derived vault key at `m/1854'/1815'/0'/role/index`. */
export interface VaultKey {
  readonly role: Role;
  readonly index: number;
  readonly publicKey: Ed25519PublicKeyHex;
  readonly keyHash: Ed25519KeyHashHex;
}

/** The payment and stake key hashes one participant contributes to a vault at one index. */
export interface ParticipantKeyHashes {
  readonly payment: Ed25519KeyHashHex;
  readonly stake: Ed25519KeyHashHex;
}

/** Standard template (spec 4.1): at least `threshold` of the owners. */
export interface StandardTemplate {
  readonly kind: 'standard';
  readonly threshold: number;
}

/**
 * Dated backup template (spec 4.1, GV-69):
 * `any [ atLeast threshold owners, all [ atLeast backupThreshold backupKeys, after backupAfterSlot ] ]`.
 * The slot is absolute and cannot be moved or cancelled.
 */
export interface BackupTemplate {
  readonly kind: 'backup';
  readonly threshold: number;
  readonly backupThreshold: number;
  /** Absolute slot from which the backup quorum may spend (`RequireTimeAfter`, ledger `invalid_before`). */
  readonly backupAfterSlot: number;
}

export type VaultTemplate = StandardTemplate | BackupTemplate;

/** One instantiated native script with its canonical CBOR and its hash. */
export interface VaultScript {
  readonly role: Role;
  readonly script: Cardano.NativeScript;
  readonly cbor: string;
  readonly hash: Hash28ByteBase16;
}

/**
 * A property of a vault the caller must acknowledge before the builder writes it.
 * `ALL_OWNERS_REQUIRED`: the threshold equals the number of owners and there is no backup path,
 * so losing any one owner key locks the vault for good.
 */
export type VaultWarning = 'ALL_OWNERS_REQUIRED';

/** The instantiated scripts of one vault. */
export interface VaultScripts {
  readonly template: VaultTemplate;
  /** The warnings the caller acknowledged for this vault. */
  readonly warnings: readonly VaultWarning[];
  /** Owner key hashes in the order they appear in the scripts. */
  readonly owners: readonly ParticipantKeyHashes[];
  /** Backup key hashes in script order; empty for the standard template. */
  readonly backups: readonly ParticipantKeyHashes[];
  readonly payment: VaultScript;
  readonly stake: VaultScript;
}

export interface VaultAddresses {
  /** Base address: script payment credential and script stake credential. */
  readonly base: Cardano.PaymentAddress;
  /** Reward address of the stake script. */
  readonly reward: Cardano.RewardAccount;
}

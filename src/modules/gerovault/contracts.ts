/**
 * GeroVault preprod slice: the contracts the create, vault and spend screens code against.
 *
 * The slice is a phase 1 vault (two native scripts, `src/shared/gerovault/scripts.ts`) on preprod,
 * with signatures collected by file. It has three shared parts:
 *
 * 1. The vault store (`VaultStore`): the vaults this wallet holds, in the per-wallet `vaults`
 *    table. Implemented by `vaultStore` in `src/db/vaultStore.ts`.
 * 2. The chain reader (`VaultChainReader`): UTxOs and history of a vault address, and submit.
 *    Implemented over the providers the wallet already uses for Cardano (see the interface).
 * 3. The signing files: the unsigned transaction bundle a proposer hands to each cosigner, and
 *    the witness file each cosigner hands back.
 *
 * Change this file only by agreement: every screen of the slice codes against it.
 */
import type { Cardano } from '@cardano-sdk/core';
import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex, hexToBytes } from '@/shared/gerovault/cbor';
import type { CosignerVerification, EncodedVaultPublicKeys, VaultNetwork, VaultPublicKeys } from '@/shared/gerovault';
import type { TxCborSource } from '@/shared/utils/provenInputs';

// -------------------------------------------------------------------------------------------------
// Networks

/** The networks the slice opens vaults on. Mainnet and preview stay closed until a later change. */
export const SLICE_NETWORKS: readonly VaultNetwork[] = Object.freeze(['preprod']);

/** The vault network of a Cardano wallet's `network` field ('Preprod' and so on), or undefined. */
export function vaultNetworkOf(walletNetwork: unknown): VaultNetwork | undefined {
  if (typeof walletNetwork !== 'string') return undefined;
  const lower = walletNetwork.toLowerCase();
  return lower === 'mainnet' || lower === 'preprod' || lower === 'preview' ? lower : undefined;
}

// -------------------------------------------------------------------------------------------------
// 1. The vault store

/**
 * `candidate`: quarantined. Shown for review, never funded from this wallet, never signed for.
 * `accepted`: the user accepted the vault on this device.
 */
export type VaultStatus = 'candidate' | 'accepted';

/** How the record got here. */
export type VaultOrigin = 'created' | 'imported' | 'restored';

/** Phase 1 roles that hold script keys. */
export type VaultParticipantRole = 'owner' | 'backupHolder';

/** One participant as stored. Everything but `label` is checked against the scripts on write. */
export interface StoredVaultParticipant {
  readonly role: VaultParticipantRole;
  /** Payment vault key hash, 28 bytes of lowercase hex: how scripts, manifests and witness files name a participant. */
  readonly credential: string;
  /** Stake vault key hash, 28 bytes of lowercase hex. */
  readonly stakeKeyHash: string;
  /** The participant's two vault public keys, bech32. `parseVaultPublicKeys` reads them back. */
  readonly vaultKeys: EncodedVaultPublicKeys;
  /** A claim from whoever named the participant, never proof. Show it only through `displayLabel`. */
  readonly label?: string;
  /** This wallet's own entry. Exactly one participant has it. */
  readonly self: boolean;
}

/** The manifest revision this wallet accepted, as `decodeManifest` read it. */
export interface StoredManifest {
  /** Canonical CBOR, lowercase hex. */
  readonly cbor: string;
  /** The tagged manifest hash (`manifestHash`). */
  readonly hash: string;
  readonly version: number;
}

/** One vault of one wallet: a row of the `vaults` table. */
export interface VaultRecord {
  /** Format of this record. */
  readonly recordVersion: 1;
  /** Phase 1 only. */
  readonly kind: 'native';
  /** `vaultId(scripts, network)`, 32 bytes of lowercase hex. The table key. */
  readonly vaultId: string;
  readonly network: VaultNetwork;
  readonly status: VaultStatus;
  readonly origin: VaultOrigin;
  /** A local name for the vault, read rule of `labels.ts`. Show it only through `displayLabel`. */
  readonly name?: string;
  /** The payment script's canonical CBOR, lowercase hex. */
  readonly paymentScriptCbor: string;
  /** The stake script's canonical CBOR, lowercase hex. */
  readonly stakeScriptCbor: string;
  /** Hash of the payment script, from its CBOR. */
  readonly paymentScriptHash: string;
  /** Hash of the stake script, from its CBOR. */
  readonly stakeScriptHash: string;
  /** Every holder of a script key, in no particular order. */
  readonly participants: readonly StoredVaultParticipant[];
  /** This wallet's own CIP-1854 index in this vault: its keys are `m/1854'/1815'/0'/0/i` and `.../2/i`. */
  readonly ownIndex: number;
  /** The accepted manifest revision, or null when there is none yet. */
  readonly manifest: StoredManifest | null;
  /** How this device verified each cosigner. Kept on this device, never sent anywhere. */
  readonly verifications: readonly CosignerVerification[];
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly acceptedAt: number | null;
}

/** A participant as the caller gives it. */
export interface VaultParticipantInput {
  readonly role: VaultParticipantRole;
  /** From `deriveVaultPublicKeys` (this wallet) or `parseVaultPublicKeys` (a cosigner's file). */
  readonly vaultKeys: VaultPublicKeys;
  /** Pass a typed label through `writeLabel` first. */
  readonly label?: string;
  readonly self?: boolean;
}

export interface VaultCandidateInput {
  /** Must equal `vaultId(scripts, network)`; the store recomputes it. */
  readonly vaultId: string;
  readonly network: VaultNetwork;
  readonly origin: VaultOrigin;
  readonly name?: string;
  readonly paymentScriptCbor: string;
  readonly stakeScriptCbor: string;
  readonly participants: readonly VaultParticipantInput[];
  /**
   * The caller derived the `self` participant's keys at this index (`indexAllocation.ts`); the store
   * cannot check that. 1 or above: index 0 is refused while the dApp signing guard cannot see vaults.
   */
  readonly ownIndex: number;
  /** A manifest revision for this vault, canonical CBOR hex. */
  readonly manifest?: string;
  readonly verifications?: readonly CosignerVerification[];
}

export interface VaultAcceptInput {
  /** The manifest revision accepted with the vault, canonical CBOR hex. */
  readonly manifest?: string;
  /** Replaces the stored verification records. */
  readonly verifications?: readonly CosignerVerification[];
}

/** What `update` may change. Scripts, keys, index, network and status never change. */
export interface VaultRecordPatch {
  /** A new name; null removes it. */
  readonly name?: string | null;
  /** Participant labels by credential; null removes one. */
  readonly labels?: Readonly<Record<string, string | null>>;
  /** A manifest revision of this vault, never older than the stored one. */
  readonly manifest?: string;
  /** Replaces the stored verification records. */
  readonly verifications?: readonly CosignerVerification[];
}

export interface VaultListFilter {
  readonly status?: VaultStatus;
  readonly network?: VaultNetwork;
}

/**
 * Codes of `VaultStoreError`.
 * - `STORE_UNAVAILABLE`: the wallet database could not be opened or read. Never treat it as "no vaults".
 * - `INVALID_INPUT`: a field is malformed, or the participants do not match the scripts.
 * - `VAULT_ID_MISMATCH`: the vault id is not the one the scripts and network give.
 * - `VAULT_EXISTS`: this wallet already holds the vault.
 * - `NOT_FOUND`: this wallet does not hold the vault.
 * - `NOT_A_CANDIDATE`: `accept` on a vault already accepted.
 * - `MANIFEST_INVALID`: the manifest does not decode, or describes another vault.
 * - `MANIFEST_ROLLBACK`: the manifest is older than the stored one, or another revision of its version.
 */
export type VaultStoreErrorCode =
  | 'STORE_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'VAULT_ID_MISMATCH'
  | 'VAULT_EXISTS'
  | 'NOT_FOUND'
  | 'NOT_A_CANDIDATE'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_ROLLBACK';

/**
 * Persistence of the vaults one wallet holds (`walletId` is the wallet's id, as
 * `walletStore.loggedWallet.id`). Every call throws a `VaultStoreError`; reads never answer empty
 * when the database cannot be read.
 */
export interface VaultStore {
  /** The wallet's vaults, oldest first. */
  list(walletId: number, filter?: VaultListFilter): Promise<readonly VaultRecord[]>;
  get(walletId: number, vaultId: string): Promise<VaultRecord | undefined>;
  /** Checks the input against the scripts and stores it as a candidate. */
  addCandidate(walletId: number, input: VaultCandidateInput): Promise<VaultRecord>;
  /** Moves a candidate to accepted. Funding and signing gates stay the caller's (`fundingVerified`). */
  accept(walletId: number, vaultId: string, input?: VaultAcceptInput): Promise<VaultRecord>;
  update(walletId: number, vaultId: string, patch: VaultRecordPatch): Promise<VaultRecord>;
}

// -------------------------------------------------------------------------------------------------
// 2. The chain reader

export interface VaultReadOptions {
  readonly signal?: AbortSignal;
}

export interface VaultHistoryOptions extends VaultReadOptions {
  /** 1-based. */
  readonly page?: number;
  /** At most 100. */
  readonly pageSize?: number;
}

/** One transaction that touched a vault address. */
export interface VaultHistoryEntry {
  readonly txHash: string;
  readonly blockHeight: number | null;
  /** Unix seconds, null when the provider did not say. */
  readonly blockTime: number | null;
}

/**
 * Chain access for one vault network. No new provider: an implementation uses the clients the
 * wallet already has for Cardano chain data.
 *
 * - `utxos` and `history`: the Nexus address reads (`/api/addresses/{address}/utxos` and
 *   `/api/addresses/transactions/{address}`, `?network=` from `toNexusNetwork`), through the same
 *   client setup `MidnightApi.getCardanoAssetUtxos` uses (`src/api/midnight-api.ts`). Convert UTxO
 *   rows with `convertNexusUtxos` (`src/services/nexusUtxo.ts`).
 * - `txCbor`: `backendSource(network)` from `src/shared/utils/provenInputs.ts`, the source the
 *   decoders already take. Its answers are untrusted; the decoder keeps only CBOR that hashes to
 *   the id asked for.
 * - `submit`: the background's `MessageTypes.SUBMIT_TX` with `{ txCbor }`, sent from the page with
 *   `Messaging.sendToBackgroundFromOptions` (as `useTransactionSigning` does). It goes through the
 *   submit router, so a wallet's own Submit API setting is honoured. The background also records
 *   the transaction as pending in this wallet's history.
 *
 * Provider answers are never proof: a balance read here is a display, and an input is trusted
 * only once the decoder proved it from its creating transaction.
 */
export interface VaultChainReader {
  readonly network: VaultNetwork;
  /** Unspent outputs at `address` (the vault's base address). */
  utxos(address: string, options?: VaultReadOptions): Promise<Cardano.Utxo[]>;
  /** Transactions that touched `address`, newest first. */
  history(address: string, options?: VaultHistoryOptions): Promise<readonly VaultHistoryEntry[]>;
  /** Creating transactions by id, for `decodeVaultTransaction`'s `inputSources` and for bundles. */
  readonly txCbor: TxCborSource;
  /** Submits a fully witnessed transaction (hex CBOR). Resolves with its id. */
  submit(txCbor: string): Promise<string>;
}

// -------------------------------------------------------------------------------------------------
// 3. The signing files

/** `type` of an unsigned transaction bundle. */
export const UNSIGNED_BUNDLE_TYPE = 'gero-vault/v1|unsigned-tx';
/** `type` of a witness file. */
export const WITNESS_FILE_TYPE = 'gero-vault/v1|witnesses';
export const SIGNING_FILE_VERSION = 1;
/** Suggested file names end with these. Both files are UTF-8 JSON. */
export const UNSIGNED_BUNDLE_EXTENSION = '.gvtx.json';
export const WITNESS_FILE_EXTENSION = '.gvsig.json';
/** Tag of `signingBundleHash`. */
export const SIGNING_BUNDLE_HASH_TAG = 'gero-vault/v1|signing-bundle|';

/** An input as the transaction body names it. */
export interface BundleInputRef {
  /** 32 bytes of lowercase hex. */
  readonly txId: string;
  readonly index: number;
}

/**
 * What the proposer hands to each cosigner. It carries no secret and no witness.
 *
 * The cosigner's device must not take any of it on trust: it recomputes `txId` from `bodyCbor`,
 * checks `vaultId` and `network` against its own vault record, and decodes the body with
 * `decodeVaultTransaction`, which proves each input from `sourceTransactions` (a creating
 * transaction counts only when its body hashes to the input's id). To decode, wrap the body in a
 * transaction with an empty witness set.
 */
export interface UnsignedTxBundle {
  readonly type: typeof UNSIGNED_BUNDLE_TYPE;
  readonly version: typeof SIGNING_FILE_VERSION;
  readonly network: VaultNetwork;
  readonly vaultId: string;
  /** blake2b-256 of `bodyCbor`, lowercase hex: the transaction id every witness signs. */
  readonly txId: string;
  /** The transaction body exactly as built and signed, lowercase hex. */
  readonly bodyCbor: string;
  /** Every input the body names (spent, collateral and reference), in body order. */
  readonly inputs: readonly BundleInputRef[];
  /** The creating transaction of each input, by transaction id, lowercase hex CBOR. */
  readonly sourceTransactions: Readonly<Record<string, string>>;
  /** Milliseconds since the epoch. For display only. */
  readonly createdAt: number;
}

/** One vkey witness: a 32-byte Ed25519 public key and its 64-byte signature over `txId`, hex. */
export interface VaultVkeyWitness {
  readonly vkey: string;
  readonly signature: string;
}

/**
 * What a cosigner hands back. It may hold two witnesses: the payment key (spending) and the stake
 * key (withdrawals and certificates).
 *
 * The importer accepts it only when `bundleHash` is its own bundle's, every `vkey` is a key of
 * this vault's scripts belonging to the participant `signerKeyHash` names, and every signature
 * verifies over `txId`. The final transaction is the body, the collected vkey witnesses and both
 * native scripts from the vault record.
 */
export interface VaultWitnessFile {
  readonly type: typeof WITNESS_FILE_TYPE;
  readonly version: typeof SIGNING_FILE_VERSION;
  readonly network: VaultNetwork;
  readonly vaultId: string;
  readonly txId: string;
  /** `signingBundleHash(vaultId, bodyCbor)` of the bundle that was signed. */
  readonly bundleHash: string;
  /** The signer's credential: their payment vault key hash, 28 bytes of lowercase hex. */
  readonly signerKeyHash: string;
  readonly vkeyWitnesses: readonly VaultVkeyWitness[];
  /** Milliseconds since the epoch. For display only. */
  readonly createdAt: number;
}

/**
 * `blake2b-256( UTF-8(SIGNING_BUNDLE_HASH_TAG) || vaultId (32 bytes) || bodyCbor )`, lowercase
 * hex: ties a witness file to one vault and one body. The network is inside the vault id.
 */
export function signingBundleHash(vaultId: string, bodyCbor: string): string {
  const id = /^[0-9a-f]{64}$/.test(vaultId) ? hexToBytes(vaultId) : undefined;
  const body = /^(?:[0-9a-f]{2})+$/.test(bodyCbor) ? hexToBytes(bodyCbor) : undefined;
  if (!id || !body) throw new TypeError('A vault id is 32 bytes and a body is CBOR, both lowercase hex');
  const tag = new TextEncoder().encode(SIGNING_BUNDLE_HASH_TAG);
  const preimage = new Uint8Array(tag.length + id.length + body.length);
  preimage.set(tag, 0);
  preimage.set(id, tag.length);
  preimage.set(body, tag.length + id.length);
  return bytesToHex(blake2b(preimage, { dkLen: 32 }));
}

/**
 * Transfers of NFTs that are not token accounts, hand-encoded like the token transfers so the
 * bytes a user signs stay reviewable; the worker simulates the exact message before anyone signs.
 *
 * Compressed NFT, Bubblegum `transfer` (V1 trees only; the program refuses a V2 tree), from
 * mpl-bubblegum's generated `transfer`:
 *   data: [163, 52, 200, 231, 140, 3, 69, 186] root[32] dataHash[32] creatorHash[32] nonce u64 index u32
 *   accounts: treeConfig, leafOwner (signer), leafDelegate, newLeafOwner, merkleTree (w),
 *     logWrapper (SPL Noop), compressionProgram (SPL Account Compression), systemProgram,
 *     then the proof nodes (read-only), the canopy's already left off by Nexus.
 *
 * Metaplex Core `TransferV1`, from mpl-core's generated `transferV1`:
 *   data: [14][compressionProof: None]
 *   accounts: asset (w), collection, payer (w, signer), authority (signer), newOwner,
 *     systemProgram, logWrapper; an absent optional account is the Core program id (read-only).
 */
import { solanaAddressToBytes } from './solanaKeyManager';
import { base58Decode } from './solanaBase58';
import { COMPUTE_BUDGET_PROGRAM_ID, LAMPORTS_PER_SIGNATURE, SYSTEM_PROGRAM_ID, compactU16 } from './solanaTransaction';
import { findProgramAddress } from './solanaTokenTransfer';
import type { SolanaCompressedTransferInputs } from './solanaAssets';

export const BUBBLEGUM_PROGRAM_ID = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';
export const SPL_NOOP_PROGRAM_ID = 'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV';
export const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = 'cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK';
export const MPL_CORE_PROGRAM_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';

const BUBBLEGUM_TRANSFER = Uint8Array.of(163, 52, 200, 231, 140, 3, 69, 186);
const CORE_TRANSFER_V1 = 14;
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;

/**
 * Compute limits, billed on the limit: Bubblegum verifies the proof and rewrites the tree path;
 * Core moves one account. The worker simulates, so a transfer that needs more is refused.
 */
export const COMPRESSED_TRANSFER_COMPUTE_UNITS = 200_000;
export const CORE_TRANSFER_COMPUTE_UNITS = 60_000;

/** A Bubblegum tree's config account (the tree authority). */
export function treeConfigAddress(tree: string): string {
  return findProgramAddress([solanaAddressToBytes(tree)], BUBBLEGUM_PROGRAM_ID);
}

export function estimateAssetTransferFee(kind: 'compressed' | 'core', computeUnitPriceMicroLamports: bigint): bigint {
  const units = BigInt(kind === 'compressed' ? COMPRESSED_TRANSFER_COMPUTE_UNITS : CORE_TRANSFER_COMPUTE_UNITS);
  const priority = computeUnitPriceMicroLamports > 0n ? (computeUnitPriceMicroLamports * units + 999_999n) / 1_000_000n : 0n;
  return LAMPORTS_PER_SIGNATURE + priority;
}

interface Common {
  /** The owner: signer and fee payer. */
  from: string;
  recipient: string;
  recentBlockhash: string;
  computeUnitPriceMicroLamports?: bigint;
}

/** The serialized legacy message of a compressed NFT transfer. */
export function buildCompressedTransferMessage(params: Common & { leaf: SolanaCompressedTransferInputs }): Uint8Array {
  const { leaf } = params;
  if (leaf.treeVersion !== 1) throw new Error('Only V1 Bubblegum trees take this transfer');
  if (params.from === params.recipient) throw new Error('Sender and recipient are the same');
  const treeConfig = treeConfigAddress(leaf.tree);
  const delegate = leaf.delegate === params.from ? null : leaf.delegate;
  const price = params.computeUnitPriceMicroLamports ?? 0n;
  const withBudget = price > 0n;

  const readonly = [
    treeConfig, ...(delegate ? [delegate] : []), params.recipient, ...leaf.proof,
    SPL_NOOP_PROGRAM_ID, SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, SYSTEM_PROGRAM_ID, BUBBLEGUM_PROGRAM_ID,
    ...(withBudget ? [COMPUTE_BUDGET_PROGRAM_ID] : []),
  ];
  const accounts = [params.from, leaf.tree, ...readonly];
  if (new Set(accounts).size !== accounts.length) throw new Error('An account appears twice in the transfer');
  const at = (address: string) => accounts.indexOf(address);

  const instructions: Uint8Array[] = budget(at, withBudget, price, COMPRESSED_TRANSFER_COMPUTE_UNITS);
  instructions.push(instruction(at(BUBBLEGUM_PROGRAM_ID), [
    at(treeConfig), at(params.from), at(delegate ?? params.from), at(params.recipient), at(leaf.tree),
    at(SPL_NOOP_PROGRAM_ID), at(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID), at(SYSTEM_PROGRAM_ID),
    ...leaf.proof.map(at),
  ], concat(
    BUBBLEGUM_TRANSFER,
    hash32(leaf.root), hash32(leaf.dataHash), hash32(leaf.creatorHash), u64le(leaf.nonce), u32le(leaf.index),
  )));
  return message(accounts, 1, readonly.length, params.recentBlockhash, instructions);
}

/** The serialized legacy message of a Metaplex Core asset transfer. */
export function buildCoreTransferMessage(params: Common & { asset: string; collection: string | null }): Uint8Array {
  if (params.from === params.recipient) throw new Error('Sender and recipient are the same');
  const price = params.computeUnitPriceMicroLamports ?? 0n;
  const withBudget = price > 0n;
  const readonly = [
    ...(params.collection ? [params.collection] : []), params.recipient, MPL_CORE_PROGRAM_ID,
    ...(withBudget ? [COMPUTE_BUDGET_PROGRAM_ID] : []),
  ];
  const accounts = [params.from, params.asset, ...readonly];
  if (new Set(accounts).size !== accounts.length) throw new Error('An account appears twice in the transfer');
  const at = (address: string) => accounts.indexOf(address);
  const none = MPL_CORE_PROGRAM_ID;

  const instructions: Uint8Array[] = budget(at, withBudget, price, CORE_TRANSFER_COMPUTE_UNITS);
  instructions.push(instruction(at(MPL_CORE_PROGRAM_ID), [
    at(params.asset), at(params.collection ?? none), at(params.from), at(params.from), at(params.recipient), at(none), at(none),
  ], Uint8Array.of(CORE_TRANSFER_V1, 0)));
  return message(accounts, 1, readonly.length, params.recentBlockhash, instructions);
}

function budget(at: (a: string) => number, withBudget: boolean, price: bigint, units: number): Uint8Array[] {
  if (!withBudget) return [];
  const program = at(COMPUTE_BUDGET_PROGRAM_ID);
  return [
    instruction(program, [], concat(Uint8Array.of(SET_COMPUTE_UNIT_LIMIT), u32le(units))),
    instruction(program, [], concat(Uint8Array.of(SET_COMPUTE_UNIT_PRICE), u64le(price))),
  ];
}

function message(accounts: string[], signers: number, readonlyUnsigned: number, recentBlockhash: string, instructions: Uint8Array[]): Uint8Array {
  const blockhash = base58Decode(recentBlockhash);
  if (blockhash.length !== 32) throw new Error('A recent blockhash is 32 bytes');
  return concat(
    Uint8Array.of(signers, 0, readonlyUnsigned),
    compactU16(accounts.length),
    ...accounts.map(solanaAddressToBytes),
    blockhash,
    compactU16(instructions.length),
    ...instructions,
  );
}

function hash32(value: string): Uint8Array {
  const bytes = base58Decode(value);
  if (bytes.length !== 32) throw new Error('A hash is 32 bytes');
  return bytes;
}

function instruction(programIndex: number, accountIndexes: number[], data: Uint8Array): Uint8Array {
  if (programIndex < 0 || accountIndexes.some((i) => i < 0)) throw new Error('Unknown account in instruction');
  return concat(Uint8Array.of(programIndex), compactU16(accountIndexes.length), Uint8Array.from(accountIndexes), compactU16(data.length), data);
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

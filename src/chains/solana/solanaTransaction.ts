/**
 * Native SOL transfers: a legacy Solana transaction message, signed with ed25519.
 *
 * Hand-encoded rather than pulling in @solana/kit: a SystemProgram transfer plus the
 * two ComputeBudget instructions is a fixed, small layout, and keeping it here means the
 * bytes a user signs are fully reviewable. Layout reference:
 * https://solana.com/docs/core/transactions (legacy message format).
 */
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { base58Decode, base58Encode } from './solanaBase58';
import { solanaAddressToBytes } from './solanaKeyManager';

if (!ed25519.hashes.sha512) {
  ed25519.hashes.sha512 = sha512;
}

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

/** Base fee per signature (lamports). Fixed by the protocol since launch. */
export const LAMPORTS_PER_SIGNATURE = 5000n;
/** Compute units a SOL transfer with the two budget instructions actually uses, with headroom. */
export const SOL_TRANSFER_COMPUTE_UNITS = 600;
/** Hard cap on a serialized transaction (one IPv6 packet minus headers). */
export const MAX_TRANSACTION_BYTES = 1232;

const SYSTEM_TRANSFER = 2; // SystemInstruction::Transfer
const SET_COMPUTE_UNIT_LIMIT = 2; // ComputeBudgetInstruction::SetComputeUnitLimit
const SET_COMPUTE_UNIT_PRICE = 3; // ComputeBudgetInstruction::SetComputeUnitPrice

export interface SolTransferParams {
  from: string;
  to: string;
  lamports: bigint;
  /** Base58 recent blockhash from Nexus `chain/tip`. A transaction expires ~150 blocks after it. */
  recentBlockhash: string;
  /** Priority fee in micro-lamports per compute unit. 0 or absent = no ComputeBudget instructions. */
  computeUnitPriceMicroLamports?: bigint;
  computeUnitLimit?: number;
}

/** Network fee the transfer pays, in lamports: base fee plus priority fee (rounded up). */
export function estimateSolTransferFee(computeUnitPriceMicroLamports = 0n, computeUnitLimit = SOL_TRANSFER_COMPUTE_UNITS): bigint {
  const priority = computeUnitPriceMicroLamports > 0n
    ? (computeUnitPriceMicroLamports * BigInt(computeUnitLimit) + 999_999n) / 1_000_000n
    : 0n;
  return LAMPORTS_PER_SIGNATURE + priority;
}

/** Serialized legacy message for a SOL transfer (what the sender signs). */
export function buildSolTransferMessage(params: SolTransferParams): Uint8Array {
  const from = solanaAddressToBytes(params.from);
  const to = solanaAddressToBytes(params.to);
  const blockhash = base58Decode(params.recentBlockhash);
  if (blockhash.length !== 32) throw new Error('A recent blockhash is 32 bytes');
  if (params.lamports <= 0n) throw new Error('Transfer amount must be positive');
  if (equalBytes(from, to)) throw new Error('Sender and recipient are the same address');

  const price = params.computeUnitPriceMicroLamports ?? 0n;
  const withBudget = price > 0n;
  const limit = params.computeUnitLimit ?? SOL_TRANSFER_COMPUTE_UNITS;

  // Accounts: writable signers, writable non-signers, read-only non-signers (programs).
  const accounts: Uint8Array[] = [from, to, solanaAddressToBytes(SYSTEM_PROGRAM_ID)];
  if (withBudget) accounts.push(solanaAddressToBytes(COMPUTE_BUDGET_PROGRAM_ID));
  const systemIndex = 2;
  const budgetIndex = 3;

  const instructions: Uint8Array[] = [];
  if (withBudget) {
    instructions.push(instruction(budgetIndex, [], concat(Uint8Array.of(SET_COMPUTE_UNIT_LIMIT), u32le(limit))));
    instructions.push(instruction(budgetIndex, [], concat(Uint8Array.of(SET_COMPUTE_UNIT_PRICE), u64le(price))));
  }
  instructions.push(instruction(systemIndex, [0, 1], concat(u32le(SYSTEM_TRANSFER), u64le(params.lamports))));

  const header = Uint8Array.of(1, 0, withBudget ? 2 : 1);
  return concat(
    header,
    compactU16(accounts.length),
    ...accounts,
    blockhash,
    compactU16(instructions.length),
    ...instructions,
  );
}

/** Signs a single-signer message. Returns the signature and the serialized transaction. */
export function signSolanaMessage(message: Uint8Array, secretKey: Uint8Array): { signature: string; transaction: Uint8Array } {
  const signature = ed25519.sign(message, secretKey);
  const transaction = concat(compactU16(1), signature, message);
  if (transaction.length > MAX_TRANSACTION_BYTES) throw new Error('Transaction too large');
  return { signature: base58Encode(signature), transaction };
}

/** Builds and signs a SOL transfer. `secretKey` is the sender's 32-byte ed25519 seed. */
export function buildSignedSolTransfer(params: SolTransferParams, secretKey: Uint8Array): { signature: string; base64: string } {
  const publicKey = ed25519.getPublicKey(secretKey);
  if (base58Encode(publicKey) !== params.from) {
    throw new Error('Signing key does not match the sender address');
  }
  const { signature, transaction } = signSolanaMessage(buildSolTransferMessage(params), secretKey);
  return { signature, base64: bytesToBase64(transaction) };
}

/** Solana's compact-u16 (shortvec) length prefix. */
export function compactU16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error('compact-u16 out of range');
  const out: number[] = [];
  let rest = value;
  for (;;) {
    let byte = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(byte);
      return Uint8Array.from(out);
    }
    byte |= 0x80;
    out.push(byte);
  }
}

function instruction(programIndex: number, accountIndexes: number[], data: Uint8Array): Uint8Array {
  return concat(
    Uint8Array.of(programIndex),
    compactU16(accountIndexes.length),
    Uint8Array.from(accountIndexes),
    compactU16(data.length),
    data,
  );
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

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

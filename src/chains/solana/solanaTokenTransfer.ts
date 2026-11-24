/**
 * SPL token transfers (Token and Token-2022): the associated token account (ATA) address, and
 * the legacy message Gero's Send signs. Hand-encoded like the SOL transfer
 * (solanaTransaction.ts), so the bytes a user signs stay reviewable:
 *
 *   [SetComputeUnitLimit, SetComputeUnitPrice]   (only with a priority price)
 *   [CreateIdempotent]                           (only when the recipient has no token account)
 *   TransferChecked(amount, decimals)
 *
 * TransferChecked names the mint and its decimals, so the token program refuses the transfer
 * if either is not what the sender meant. CreateIdempotent succeeds as a no-op when the account
 * appeared in the meantime. Layouts: the SPL Token and Associated Token Account programs.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { base58Decode, base58Encode } from './solanaBase58';
import { isOnCurveSolanaAddress, solanaAddressToBytes } from './solanaKeyManager';
import { COMPUTE_BUDGET_PROGRAM_ID, LAMPORTS_PER_SIGNATURE, SYSTEM_PROGRAM_ID, compactU16 } from './solanaTransaction';

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/** The two token programs a Send may use. */
export const TOKEN_PROGRAMS: readonly string[] = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];

/**
 * Compute unit limits the message asks for. The fee is billed on the limit, so they are close
 * to what the programs use (Token-2022 with extensions included) with headroom; the worker
 * simulates the exact message, so a transfer that needs more is refused, never sent.
 */
export const TOKEN_TRANSFER_COMPUTE_UNITS = 40_000;
export const TOKEN_TRANSFER_WITH_ACCOUNT_COMPUTE_UNITS = 100_000;

const TRANSFER_CHECKED = 12; // TokenInstruction::TransferChecked
const CREATE_IDEMPOTENT = 1; // AssociatedTokenAccountInstruction::CreateIdempotent
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;
const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

/**
 * `findProgramAddress`: the first bump from 255 down whose hash is off the ed25519 curve.
 * Returns the base58 address.
 */
export function findProgramAddress(seeds: Uint8Array[], programId: string): string {
  const program = solanaAddressToBytes(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const address = base58Encode(sha256(concat(...seeds, Uint8Array.of(bump), program, PDA_MARKER)));
    if (!isOnCurveSolanaAddress(address)) return address;
  }
  throw new Error('No program address for these seeds');
}

/** The associated token account of `owner` for `mint` under `tokenProgram`. */
export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string): string {
  if (!TOKEN_PROGRAMS.includes(tokenProgram)) throw new Error('Not a token program');
  return findProgramAddress(
    [solanaAddressToBytes(owner), solanaAddressToBytes(tokenProgram), solanaAddressToBytes(mint)],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

export interface TokenTransferParams {
  /** The sender's wallet: fee payer, token authority and (for a new account) its payer. */
  from: string;
  /** The sender's token account the tokens leave. */
  source: string;
  /** The token account that receives them. */
  destination: string;
  mint: string;
  tokenProgram: string;
  /** Raw units. */
  amount: bigint;
  decimals: number;
  recentBlockhash: string;
  /** Opens `destination` as `recipient`'s associated token account first (CreateIdempotent). */
  createDestinationFor?: string;
  /** Micro-lamports per compute unit; 0 or absent = no ComputeBudget instructions. */
  computeUnitPriceMicroLamports?: bigint;
}

/** The compute unit limit a token transfer asks for. */
export function tokenTransferComputeUnits(createsAccount: boolean): number {
  return createsAccount ? TOKEN_TRANSFER_WITH_ACCOUNT_COMPUTE_UNITS : TOKEN_TRANSFER_COMPUTE_UNITS;
}

/** The network fee of a token transfer in lamports (base plus priority on the limit, rounded up). */
export function estimateTokenTransferFee(computeUnitPriceMicroLamports: bigint, createsAccount: boolean): bigint {
  const units = BigInt(tokenTransferComputeUnits(createsAccount));
  const priority = computeUnitPriceMicroLamports > 0n ? (computeUnitPriceMicroLamports * units + 999_999n) / 1_000_000n : 0n;
  return LAMPORTS_PER_SIGNATURE + priority;
}

/** The serialized legacy message of a token transfer (what the sender signs). */
export function buildTokenTransferMessage(params: TokenTransferParams): Uint8Array {
  if (!TOKEN_PROGRAMS.includes(params.tokenProgram)) throw new Error('Not a token program');
  if (params.amount <= 0n || params.amount > (1n << 64n) - 1n) throw new Error('Transfer amount out of range');
  if (!Number.isInteger(params.decimals) || params.decimals < 0 || params.decimals > 255) throw new Error('Invalid decimals');
  const blockhash = base58Decode(params.recentBlockhash);
  if (blockhash.length !== 32) throw new Error('A recent blockhash is 32 bytes');
  if (params.source === params.destination) throw new Error('Source and destination are the same account');

  const price = params.computeUnitPriceMicroLamports ?? 0n;
  const withBudget = price > 0n;
  const recipient = params.createDestinationFor;

  // Writable signer; writable non-signers; read-only non-signers (accounts, then programs).
  const accounts: string[] = [params.from, params.source, params.destination, params.mint];
  if (recipient) accounts.push(recipient, SYSTEM_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  accounts.push(params.tokenProgram);
  if (withBudget) accounts.push(COMPUTE_BUDGET_PROGRAM_ID);
  if (new Set(accounts).size !== accounts.length) throw new Error('An account appears twice in the transfer');
  const at = (address: string) => accounts.indexOf(address);

  const instructions: Uint8Array[] = [];
  if (withBudget) {
    const budget = at(COMPUTE_BUDGET_PROGRAM_ID);
    instructions.push(instruction(budget, [], concat(Uint8Array.of(SET_COMPUTE_UNIT_LIMIT), u32le(tokenTransferComputeUnits(!!recipient)))));
    instructions.push(instruction(budget, [], concat(Uint8Array.of(SET_COMPUTE_UNIT_PRICE), u64le(price))));
  }
  if (recipient) {
    // payer, associated account, owner, mint, system program, token program.
    instructions.push(instruction(at(ASSOCIATED_TOKEN_PROGRAM_ID), [
      at(params.from), at(params.destination), at(recipient), at(params.mint), at(SYSTEM_PROGRAM_ID), at(params.tokenProgram),
    ], Uint8Array.of(CREATE_IDEMPOTENT)));
  }
  // source, mint, destination, authority.
  instructions.push(instruction(at(params.tokenProgram), [
    at(params.source), at(params.mint), at(params.destination), at(params.from),
  ], concat(Uint8Array.of(TRANSFER_CHECKED), u64le(params.amount), Uint8Array.of(params.decimals))));

  const readonlyUnsigned = accounts.length - 3;
  return concat(
    Uint8Array.of(1, 0, readonlyUnsigned),
    compactU16(accounts.length),
    ...accounts.map(solanaAddressToBytes),
    blockhash,
    compactU16(instructions.length),
    ...instructions,
  );
}

/** A single-signer transaction around `message` with `signature` (all zero for a simulation). */
export function singleSignerTransaction(message: Uint8Array, signature: Uint8Array = new Uint8Array(64)): Uint8Array {
  if (signature.length !== 64) throw new Error('A signature is 64 bytes');
  return concat(compactU16(1), signature, message);
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

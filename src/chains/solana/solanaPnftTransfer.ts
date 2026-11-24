/**
 * Programmable NFT (pNFT) transfers: Metaplex Token Metadata `TransferV1`. A pNFT's token account
 * is frozen by Token Metadata, so a plain SPL transfer cannot move it; Token Metadata thaws,
 * transfers and re-freezes it, checking the NFT's rule set (when it has one) on the way.
 *
 * Layout, from mpl-token-metadata's generated `transferV1` and the program's transfer processor:
 *   data: [49 Transfer][0 V1][amount u64 = 1][authorization_data: None]
 *   accounts (in order): token w, tokenOwner, destinationToken w, destinationOwner, mint,
 *     metadata w, edition, tokenRecord w, destinationTokenRecord w, authority (signer),
 *     payer (signer, w), system program, sysvar instructions, SPL Token, Associated Token,
 *     authorization rules program, authorization rules.
 * An optional account that is absent (the rule set and its program, for an NFT without one) is
 * passed as the Token Metadata program id, the program's own "none" placeholder.
 *
 * The program creates the recipient's token account and token record when missing (the payer
 * pays their rent) and closes the sender's token record (its rent back to the payer). Hand-encoded
 * like the SPL transfer; the worker simulates the exact message before anyone signs.
 */
import { solanaAddressToBytes } from './solanaKeyManager';
import { base58Decode } from './solanaBase58';
import { COMPUTE_BUDGET_PROGRAM_ID, LAMPORTS_PER_SIGNATURE, SYSTEM_PROGRAM_ID, compactU16 } from './solanaTransaction';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, findProgramAddress } from './solanaTokenTransfer';

export const TOKEN_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
export const AUTHORIZATION_RULES_PROGRAM_ID = 'auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg';
export const SYSVAR_INSTRUCTIONS_ID = 'Sysvar1nstructions1111111111111111111111111';

/**
 * The compute limit a pNFT transfer asks for: Token Metadata thaws, transfers and re-freezes,
 * may create two accounts and evaluates the rule set. The fee is billed on the limit; the worker
 * simulates, so a transfer that needs more is refused, never sent.
 */
export const PNFT_TRANSFER_COMPUTE_UNITS = 400_000;

const TRANSFER = 49;
const TRANSFER_V1 = 0;
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;
const enc = new TextEncoder();

const metadataSeeds = (mint: string) => [enc.encode('metadata'), solanaAddressToBytes(TOKEN_METADATA_PROGRAM_ID), solanaAddressToBytes(mint)];

export function metadataAddress(mint: string): string {
  return findProgramAddress(metadataSeeds(mint), TOKEN_METADATA_PROGRAM_ID);
}

/** The master edition (or, for a print, its edition): the same seeds for both. */
export function editionAddress(mint: string): string {
  return findProgramAddress([...metadataSeeds(mint), enc.encode('edition')], TOKEN_METADATA_PROGRAM_ID);
}

/** The token record of `tokenAccount` for `mint`. */
export function tokenRecordAddress(mint: string, tokenAccount: string): string {
  return findProgramAddress([...metadataSeeds(mint), enc.encode('token_record'), solanaAddressToBytes(tokenAccount)], TOKEN_METADATA_PROGRAM_ID);
}

export interface PnftTransferParams {
  /** The sender: token owner, authority and fee payer. */
  from: string;
  /** The sender's associated token account. */
  source: string;
  /** The recipient's associated token account (created by the program when missing). */
  destination: string;
  recipient: string;
  mint: string;
  /** The NFT's authorization rule set, when it has one. */
  ruleSet?: string | null;
  recentBlockhash: string;
  computeUnitPriceMicroLamports?: bigint;
}

/** The network fee of a pNFT transfer in lamports (base plus priority on the limit, rounded up). */
export function estimatePnftTransferFee(computeUnitPriceMicroLamports: bigint): bigint {
  const priority = computeUnitPriceMicroLamports > 0n
    ? (computeUnitPriceMicroLamports * BigInt(PNFT_TRANSFER_COMPUTE_UNITS) + 999_999n) / 1_000_000n
    : 0n;
  return LAMPORTS_PER_SIGNATURE + priority;
}

/** The serialized legacy message of a pNFT transfer (what the sender signs). */
export function buildPnftTransferMessage(params: PnftTransferParams): Uint8Array {
  const blockhash = base58Decode(params.recentBlockhash);
  if (blockhash.length !== 32) throw new Error('A recent blockhash is 32 bytes');
  if (params.from === params.recipient) throw new Error('Sender and recipient are the same');
  if (params.source === params.destination) throw new Error('Source and destination are the same account');
  const metadata = metadataAddress(params.mint);
  const edition = editionAddress(params.mint);
  const ownerRecord = tokenRecordAddress(params.mint, params.source);
  const destinationRecord = tokenRecordAddress(params.mint, params.destination);
  const ruleSet = params.ruleSet ?? null;
  const price = params.computeUnitPriceMicroLamports ?? 0n;
  const withBudget = price > 0n;

  // Writable signer; writable non-signers; read-only non-signers (accounts, then programs).
  const writable = [params.source, params.destination, metadata, ownerRecord, destinationRecord];
  const readonly = [
    params.recipient, params.mint, edition, SYSVAR_INSTRUCTIONS_ID, ...(ruleSet ? [ruleSet] : []),
    SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    ...(ruleSet ? [AUTHORIZATION_RULES_PROGRAM_ID] : []), TOKEN_METADATA_PROGRAM_ID,
    ...(withBudget ? [COMPUTE_BUDGET_PROGRAM_ID] : []),
  ];
  const accounts = [params.from, ...writable, ...readonly];
  if (new Set(accounts).size !== accounts.length) throw new Error('An account appears twice in the transfer');
  const at = (address: string) => {
    const i = accounts.indexOf(address);
    if (i < 0) throw new Error('Unknown account in instruction');
    return i;
  };

  const instructions: Uint8Array[] = [];
  if (withBudget) {
    const budget = at(COMPUTE_BUDGET_PROGRAM_ID);
    instructions.push(instruction(budget, [], concat(Uint8Array.of(SET_COMPUTE_UNIT_LIMIT), u32le(PNFT_TRANSFER_COMPUTE_UNITS))));
    instructions.push(instruction(budget, [], concat(Uint8Array.of(SET_COMPUTE_UNIT_PRICE), u64le(price))));
  }
  const none = TOKEN_METADATA_PROGRAM_ID;
  instructions.push(instruction(at(TOKEN_METADATA_PROGRAM_ID), [
    at(params.source), at(params.from), at(params.destination), at(params.recipient), at(params.mint),
    at(metadata), at(edition), at(ownerRecord), at(destinationRecord), at(params.from), at(params.from),
    at(SYSTEM_PROGRAM_ID), at(SYSVAR_INSTRUCTIONS_ID), at(TOKEN_PROGRAM_ID), at(ASSOCIATED_TOKEN_PROGRAM_ID),
    at(ruleSet ? AUTHORIZATION_RULES_PROGRAM_ID : none), at(ruleSet ?? none),
  ], concat(Uint8Array.of(TRANSFER, TRANSFER_V1), u64le(1n), Uint8Array.of(0))));

  return concat(
    Uint8Array.of(1, 0, readonly.length),
    compactU16(accounts.length),
    ...accounts.map(solanaAddressToBytes),
    blockhash,
    compactU16(instructions.length),
    ...instructions,
  );
}

function instruction(programIndex: number, accountIndexes: number[], data: Uint8Array): Uint8Array {
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

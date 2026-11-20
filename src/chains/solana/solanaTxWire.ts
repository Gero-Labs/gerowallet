// A dApp's Solana transaction in wire format, decoded strictly so the worker knows exactly what
// it is asked to sign. Legacy and v0 messages only: anything else (another version, trailing
// bytes, an index past the account list) is refused rather than half-read.
//
// Wire format: shortvec(signature count) + 64-byte signatures + message. The message is an
// optional version prefix (0x80 | version), the header (required signatures, read-only signed,
// read-only unsigned), shortvec + 32-byte static keys, the 32-byte recent blockhash, shortvec +
// instructions (program index, shortvec + account indexes, shortvec + data) and, for v0,
// shortvec + address table lookups (table key, shortvec + writable indexes, shortvec + read-only).
import { base58Encode } from './solanaBase58';

/** Solana's packet limit: a serialized transaction never exceeds it. */
export const SOLANA_MAX_TRANSACTION_BYTES = 1232;

const PUBKEY = 32;
const SIGNATURE = 64;

export interface SolanaCompiledInstruction {
  programIdIndex: number;
  accountIndexes: number[];
  data: Uint8Array;
}

export interface SolanaLookup {
  table: string;
  writableIndexes: number[];
  readonlyIndexes: number[];
}

export interface SolanaWireMessage {
  version: 'legacy' | 0;
  numRequiredSignatures: number;
  numReadonlySigned: number;
  numReadonlyUnsigned: number;
  staticKeys: string[];
  recentBlockhash: string;
  instructions: SolanaCompiledInstruction[];
  lookups: SolanaLookup[];
}

export interface SolanaWireTransaction {
  signatures: Uint8Array[];
  /** The exact message bytes the signatures cover. */
  messageBytes: Uint8Array;
  /** Where the message starts in the transaction bytes. */
  messageOffset: number;
  message: SolanaWireMessage;
}

export class SolanaWireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SolanaWireError';
  }
}

class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.at >= this.bytes.length) throw new SolanaWireError('Transaction ends early');
    return this.bytes[this.at++];
  }

  take(n: number): Uint8Array {
    if (this.at + n > this.bytes.length) throw new SolanaWireError('Transaction ends early');
    const out = this.bytes.slice(this.at, this.at + n);
    this.at += n;
    return out;
  }

  shortvec(): number {
    let value = 0;
    for (let i = 0; i < 3; i++) {
      const byte = this.byte();
      value |= (byte & 0x7f) << (7 * i);
      if ((byte & 0x80) === 0) {
        // The canonical encoding only: no redundant continuation bytes.
        if (i > 0 && byte === 0) throw new SolanaWireError('Non-canonical length');
        return value;
      }
    }
    throw new SolanaWireError('Length too long');
  }

  indexes(): number[] {
    const n = this.shortvec();
    return Array.from(this.take(n));
  }
}

/** Decodes a whole wire transaction. Throws SolanaWireError for anything not a legacy or v0 transaction. */
export function decodeSolanaTransaction(bytes: Uint8Array): SolanaWireTransaction {
  if (bytes.length > SOLANA_MAX_TRANSACTION_BYTES) throw new SolanaWireError('Transaction too large');
  const r = new Reader(bytes);
  const count = r.shortvec();
  if (count < 1) throw new SolanaWireError('No signature slots');
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < count; i++) signatures.push(r.take(SIGNATURE));
  const messageOffset = r.at;
  const message = readMessage(r);
  if (r.at !== bytes.length) throw new SolanaWireError('Bytes after the message');
  if (message.numRequiredSignatures !== count) {
    throw new SolanaWireError('Signature count does not match the message');
  }
  return { signatures, messageBytes: bytes.slice(messageOffset), messageOffset, message };
}

function readMessage(r: Reader): SolanaWireMessage {
  let version: 'legacy' | 0 = 'legacy';
  const first = r.bytes[r.at];
  if (first !== undefined && (first & 0x80)) {
    if ((first & 0x7f) !== 0) throw new SolanaWireError('Unsupported transaction version');
    version = 0;
    r.at += 1;
  }
  const numRequiredSignatures = r.byte();
  const numReadonlySigned = r.byte();
  const numReadonlyUnsigned = r.byte();
  const keyCount = r.shortvec();
  const staticKeys: string[] = [];
  for (let i = 0; i < keyCount; i++) staticKeys.push(base58Encode(r.take(PUBKEY)));
  if (numRequiredSignatures < 1 || numRequiredSignatures > keyCount) throw new SolanaWireError('Bad header');
  if (numReadonlySigned >= numRequiredSignatures) throw new SolanaWireError('Bad header: the fee payer is read-only');
  if (numReadonlyUnsigned > keyCount - numRequiredSignatures) throw new SolanaWireError('Bad header');
  if (new Set(staticKeys).size !== staticKeys.length) throw new SolanaWireError('Duplicate account key');
  const recentBlockhash = base58Encode(r.take(PUBKEY));
  const instructionCount = r.shortvec();
  const instructions: SolanaCompiledInstruction[] = [];
  for (let i = 0; i < instructionCount; i++) {
    const programIdIndex = r.byte();
    const accountIndexes = r.indexes();
    const data = r.take(r.shortvec());
    instructions.push({ programIdIndex, accountIndexes, data });
  }
  const lookups: SolanaLookup[] = [];
  if (version === 0) {
    const lookupCount = r.shortvec();
    for (let i = 0; i < lookupCount; i++) {
      const table = base58Encode(r.take(PUBKEY));
      lookups.push({ table, writableIndexes: r.indexes(), readonlyIndexes: r.indexes() });
    }
  }
  const message: SolanaWireMessage = {
    version, numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned, staticKeys, recentBlockhash, instructions, lookups,
  };
  const total = staticKeys.length + lookups.reduce((n, l) => n + l.writableIndexes.length + l.readonlyIndexes.length, 0);
  for (const ix of instructions) {
    // A program is never loaded from a lookup table.
    if (ix.programIdIndex >= staticKeys.length) throw new SolanaWireError('Program index out of range');
    if (ix.accountIndexes.some((index) => index >= total)) throw new SolanaWireError('Account index out of range');
  }
  return message;
}

/** One account of the message, after lookup tables are resolved, with its role. */
export interface SolanaResolvedKey {
  address: string;
  signer: boolean;
  writable: boolean;
  /** From a lookup table rather than the message itself. */
  fromLookup: boolean;
}

/**
 * The message's accounts in the runtime's order: static keys, then each table's writable
 * entries, then each table's read-only entries. `tables` maps a lookup table to its addresses
 * (as Nexus read them); a table or index it lacks throws.
 */
export function resolveSolanaKeys(message: SolanaWireMessage, tables: ReadonlyMap<string, readonly string[]>): SolanaResolvedKey[] {
  const { numRequiredSignatures: sig, numReadonlySigned, numReadonlyUnsigned, staticKeys } = message;
  const keys: SolanaResolvedKey[] = staticKeys.map((address, i) => ({
    address,
    signer: i < sig,
    writable: i < sig ? i < sig - numReadonlySigned : i < staticKeys.length - numReadonlyUnsigned,
    fromLookup: false,
  }));
  const fromTable = (lookup: SolanaLookup, index: number) => {
    const table = tables.get(lookup.table);
    if (!table) throw new SolanaWireError('Lookup table not available');
    const address = table[index];
    if (address === undefined) throw new SolanaWireError('Lookup index out of range');
    return address;
  };
  for (const lookup of message.lookups) {
    for (const index of lookup.writableIndexes) keys.push({ address: fromTable(lookup, index), signer: false, writable: true, fromLookup: true });
  }
  for (const lookup of message.lookups) {
    for (const index of lookup.readonlyIndexes) keys.push({ address: fromTable(lookup, index), signer: false, writable: false, fromLookup: true });
  }
  return keys;
}

/** The transaction with `signature` placed in signature slot `index`; every other byte unchanged. */
export function withSolanaSignature(bytes: Uint8Array, tx: SolanaWireTransaction, index: number, signature: Uint8Array): Uint8Array {
  if (signature.length !== SIGNATURE) throw new SolanaWireError('Bad signature length');
  if (index < 0 || index >= tx.signatures.length) throw new SolanaWireError('No such signature slot');
  const out = new Uint8Array(bytes);
  // The signature slots start right after the count prefix, one 64-byte slot each.
  const slotsStart = tx.messageOffset - tx.signatures.length * SIGNATURE;
  out.set(signature, slotsStart + index * SIGNATURE);
  return out;
}

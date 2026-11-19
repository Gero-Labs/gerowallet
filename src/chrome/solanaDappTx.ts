// A dApp's Solana transaction in the worker (Wallet Standard solana:signTransaction and
// solana:signAndSendTransaction). The worker decodes it itself, resolves its lookup tables and
// simulates it through Nexus, and builds the preview the side panel shows. It never changes the
// transaction (no blockhash, fee or instruction is swapped in): the user signs the bytes the
// dApp sent and the preview describes.
//
// Signing is bound to the preview: preparing grants a one-shot allowance for that exact message
// (solanaTxAllowance), the panel's SIGN_SOLANA_TRANSACTION consumes it, and the worker checks
// the signed result changed nothing but the wallet's own signature slot.
import { sha256 } from '@noble/hashes/sha2.js';
import { base58Decode } from '@/chains/solana/solanaBase58';
import {
  SolanaWireError,
  decodeSolanaTransaction,
  resolveSolanaKeys,
  type SolanaWireTransaction,
} from '@/chains/solana/solanaTxWire';
import { analyzeSolanaInstructions } from '@/chains/solana/solanaTxInstructions';
import { buildSolanaTxPreview, solanaAccountsToWatch, type SolanaTxPreview } from '@/chains/solana/solanaTxPreview';
import { lookupTableAddresses, type SolanaRemoteAccount, type SolanaRemoteSimulation } from '@/chains/solana/solanaNexusAccounts';
import { verifySolanaSignature } from '@/chains/solana/solanaTransaction';

export type SolanaDappTxRefusal = 'MALFORMED' | 'NOT_SIGNER' | 'LOOKUP_UNAVAILABLE';

export class SolanaDappTxError extends Error {
  constructor(readonly reason: SolanaDappTxRefusal, message: string) {
    super(message);
    this.name = 'SolanaDappTxError';
  }
}

export interface SolanaDappTxApi {
  getAccounts(addresses: string[]): Promise<SolanaRemoteAccount[]>;
  simulate(transactionBase64: string, accounts: string[]): Promise<SolanaRemoteSimulation>;
}

export interface PreparedSolanaTx {
  bytes: Uint8Array;
  tx: SolanaWireTransaction;
  /** The wallet's signature slot. */
  signerIndex: number;
  preview: SolanaTxPreview;
  /** Identifies the exact message (sha256, hex): what the allowance is granted for. */
  messageKey: string;
}

export function solanaMessageKey(messageBytes: Uint8Array): string {
  return Array.from(sha256(messageBytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Decodes, checks the wallet must sign it, resolves lookup tables, simulates and previews. */
export async function prepareSolanaDappTransaction(bytes: Uint8Array, wallet: string, api: SolanaDappTxApi): Promise<PreparedSolanaTx> {
  let tx: SolanaWireTransaction;
  try {
    tx = decodeSolanaTransaction(bytes);
  } catch (e) {
    throw new SolanaDappTxError('MALFORMED', e instanceof SolanaWireError ? e.message : 'Not a Solana transaction');
  }
  const signerIndex = tx.message.staticKeys.indexOf(wallet);
  if (signerIndex < 0 || signerIndex >= tx.message.numRequiredSignatures) {
    throw new SolanaDappTxError('NOT_SIGNER', 'This transaction does not need the connected account’s signature');
  }

  const tableKeys = [...new Set(tx.message.lookups.map((l) => l.table))];
  const tables = new Map<string, string[]>();
  if (tableKeys.length) {
    let accounts: SolanaRemoteAccount[];
    try {
      accounts = await api.getAccounts(tableKeys);
    } catch {
      throw new SolanaDappTxError('LOOKUP_UNAVAILABLE', 'Could not read the transaction’s address lookup tables');
    }
    accounts.forEach((account, i) => {
      const addresses = lookupTableAddresses(account);
      if (!addresses) throw new SolanaDappTxError('LOOKUP_UNAVAILABLE', 'An address lookup table is missing or invalid');
      tables.set(tableKeys[i], addresses);
    });
  }
  let keys;
  try {
    keys = resolveSolanaKeys(tx.message, tables);
  } catch (e) {
    throw new SolanaDappTxError('MALFORMED', e instanceof Error ? e.message : 'Unreadable accounts');
  }

  const analysis = analyzeSolanaInstructions(tx.message, keys, wallet);
  const watched = solanaAccountsToWatch(keys, wallet);
  let simulation: SolanaRemoteSimulation | null = null;
  try {
    simulation = await api.simulate(bytesToBase64(bytes), watched.accounts);
  } catch {
    simulation = null; // the preview says the simulation could not run
  }
  const preview = buildSolanaTxPreview({ wallet, analysis, instructionCount: tx.message.instructions.length, watched, simulation });
  return { bytes, tx, signerIndex, preview, messageKey: solanaMessageKey(tx.messageBytes) };
}

/**
 * Whether `signed` is `prepared`'s transaction with only the wallet's slot filled, by a valid
 * signature of the exact message: same message bytes, every other slot unchanged.
 */
export function isSignedByWalletOnly(prepared: Pick<PreparedSolanaTx, 'tx' | 'signerIndex'>, signed: Uint8Array, wallet: string): boolean {
  let back: SolanaWireTransaction;
  try {
    back = decodeSolanaTransaction(signed);
  } catch {
    return false;
  }
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(back.messageBytes, prepared.tx.messageBytes) || back.signatures.length !== prepared.tx.signatures.length) return false;
  for (let i = 0; i < back.signatures.length; i++) {
    if (i !== prepared.signerIndex && !same(back.signatures[i], prepared.tx.signatures[i])) return false;
  }
  return verifySolanaSignature(back.signatures[prepared.signerIndex], back.messageBytes, base58Decode(wallet));
}

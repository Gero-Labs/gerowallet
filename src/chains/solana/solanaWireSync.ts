/**
 * Gero Sync (`/ws/sync`) Solana messages → wallet data.
 *
 * Contract: gero-sync `docs/solana-wire.md`. Solana-only fields are absent when the server
 * doesn't know the value: an absent balance is "unknown", never 0.
 */
import { parseRawAmount } from './solanaAmount';

export interface SolanaWireTx {
  tx_hash: string;
  block_height?: number;
  absolute_slot?: number;
  tx_timestamp?: number;
  pending?: boolean;
  solana_success?: boolean;
  solana_fee?: number;
}

export interface SolanaWireToken {
  mint: string;
  owner?: string;
  token_account?: string | null;
  amount: string;
  decimals: number;
  program_id?: string | null;
}

export interface SolanaWireMessage {
  type: 'SYNC' | 'CATCH_UP_COMPLETE' | 'SYNC_CHECK_OK' | 'FORCE_RESYNC' | string;
  chain?: string;
  block?: { height?: number; slot?: number; hash?: string | null; time?: number };
  transactions?: SolanaWireTx[];
  solana_lamports?: string;
  solana_tokens?: SolanaWireToken[];
  solana_slot?: number;
  solana_history_truncated?: boolean;
}

/** One Solana transaction as the wallet keeps it. */
export interface SolanaTransaction {
  signature: string;
  slot: number;
  /** Unix seconds; 0 when unknown. */
  blockTime: number;
  /** false = failed on chain (it still paid its fee). */
  success: boolean;
  /** Lamports; undefined when unknown. */
  fee?: number;
}

export interface SolanaTokenBalance {
  mint: string;
  /** Raw units. */
  amount: bigint;
  decimals: number;
  tokenAccount?: string;
  programId?: string;
}

/** What a message says about the wallet. Unknown fields stay undefined. */
export interface SolanaSyncUpdate {
  transactions: SolanaTransaction[];
  lamports?: bigint;
  tokens?: SolanaTokenBalance[];
  /** Cursor to persist as `lastSyncedBlock` (newest delivered slot); undefined if nothing was delivered. */
  cursorSlot?: number;
  /** Chain tip for display. */
  tipSlot?: number;
  /** Older history above the cursor exists that was not sent: page it from Nexus. */
  historyTruncated: boolean;
}

export function convertSolanaTransactions(txs: SolanaWireTx[] | undefined): SolanaTransaction[] {
  if (!Array.isArray(txs)) return [];
  return txs
    .filter((tx) => typeof tx?.tx_hash === 'string' && tx.tx_hash.length > 0)
    .map((tx) => ({
      signature: tx.tx_hash,
      slot: Number(tx.absolute_slot ?? tx.block_height ?? 0),
      blockTime: Number(tx.tx_timestamp ?? 0),
      success: tx.solana_success !== false,
      fee: typeof tx.solana_fee === 'number' ? tx.solana_fee : undefined,
    }));
}

export function convertSolanaTokens(tokens: SolanaWireToken[] | undefined): SolanaTokenBalance[] | undefined {
  if (!Array.isArray(tokens)) return undefined;
  return tokens.map((t) => ({
    mint: t.mint,
    amount: parseRawAmount(t.amount),
    decimals: t.decimals,
    tokenAccount: t.token_account ?? undefined,
    programId: t.program_id ?? undefined,
  }));
}

export function parseSolanaSyncMessage(msg: SolanaWireMessage): SolanaSyncUpdate {
  const transactions = convertSolanaTransactions(msg.transactions);
  // The cursor is the newest slot this message delivered. CATCH_UP_COMPLETE / SYNC_CHECK_OK
  // carry the tip in `block`, which is for display only (the server's cursor did not move).
  const cursorSlot = msg.type === 'SYNC' && transactions.length > 0
    ? Number(msg.block?.slot ?? msg.block?.height ?? Math.max(...transactions.map((t) => t.slot)))
    : undefined;
  return {
    transactions,
    lamports: msg.solana_lamports !== undefined ? parseRawAmount(msg.solana_lamports) : undefined,
    tokens: convertSolanaTokens(msg.solana_tokens),
    cursorSlot,
    tipSlot: msg.solana_slot ?? msg.block?.slot ?? undefined,
    historyTruncated: msg.solana_history_truncated === true,
  };
}

/** Merges new transactions into held ones: deduped by signature, newest first. A newer copy wins. */
export function mergeSolanaTransactions(held: SolanaTransaction[], incoming: SolanaTransaction[]): SolanaTransaction[] {
  const bySignature = new Map<string, SolanaTransaction>();
  for (const tx of held) bySignature.set(tx.signature, tx);
  for (const tx of incoming) bySignature.set(tx.signature, { ...bySignature.get(tx.signature), ...tx });
  return [...bySignature.values()].sort((a, b) => b.slot - a.slot || a.signature.localeCompare(b.signature));
}

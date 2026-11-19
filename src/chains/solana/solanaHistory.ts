// The Solana history the Transactions page lists: what Gero Sync delivered, plus older
// pages read from Nexus (GET /api/sol/addresses/{address}/txs, newest first, `before` a
// signature). Nexus rows are untrusted: a row that is not a well-formed signature with a
// slot is dropped, never shown half.
import type { SolanaTransaction } from './solanaWireSync';

/** Rows asked of Nexus per "Load older". */
export const SOLANA_HISTORY_PAGE = 50;

/**
 * A history row. Nexus lists only landed transactions, so its rows are `confirmed` even
 * without a block time (old ones may have none); a Gero Sync row with no time is confirming.
 */
export type SolanaHistoryRow = SolanaTransaction & { confirmed?: true };

/** Landed on chain: it has a block time, or Nexus listed it. */
export function isConfirmedSolanaTx(tx: SolanaHistoryRow): boolean {
  return tx.blockTime > 0 || tx.confirmed === true;
}

// A signature is 64 bytes: 87 or 88 base58 characters (solanaExplorer.ts accepts the same).
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Nexus signature rows as history rows; malformed ones are dropped. */
export function solanaHistoryFromNexus(rows: unknown): SolanaHistoryRow[] {
  if (!Array.isArray(rows)) return [];
  const out: SolanaHistoryRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { signature, slot, blockTime, success, fee } = row as Record<string, unknown>;
    if (typeof signature !== 'string' || !SIGNATURE.test(signature) || !finiteNonNegative(slot)) continue;
    out.push({
      signature,
      slot,
      blockTime: finiteNonNegative(blockTime) ? blockTime : 0,
      success: success !== false,
      confirmed: true,
      ...(finiteNonNegative(fee) ? { fee } : {}),
    });
  }
  return out;
}

/** One list, newest first, each signature once (the first list wins: pass Gero Sync's first). */
export function mergeSolanaHistory(...lists: ReadonlyArray<readonly SolanaHistoryRow[]>): SolanaHistoryRow[] {
  const seen = new Map<string, SolanaHistoryRow>();
  for (const list of lists) {
    for (const tx of list) if (!seen.has(tx.signature)) seen.set(tx.signature, tx);
  }
  return [...seen.values()].sort((a, b) => b.slot - a.slot || a.signature.localeCompare(b.signature));
}

/** Rows whose signature contains the query (ignoring case); all rows for a blank query. */
export function searchSolanaHistory(rows: readonly SolanaHistoryRow[], query: string | null | undefined): SolanaHistoryRow[] {
  const q = (query ?? '').trim().toLowerCase();
  return q ? rows.filter((tx) => tx.signature.toLowerCase().includes(q)) : [...rows];
}

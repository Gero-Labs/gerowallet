import type { Cardano } from '@cardano-sdk/core';

/**
 * How long a submitted transaction's inputs count as spent while it waits for a
 * block. Nexus builds with a 7,200-slot (two-hour) validity window, so a
 * transaction that has not landed by then never will, and its inputs are
 * spendable again. Ten minutes over that, for clock skew.
 */
export const PENDING_SPEND_WINDOW_MS = 130 * 60 * 1000;

/**
 * The fields of a wallet transaction record this reads. walletBg.submitTx stores a
 * submitted transaction with `pending: true`, its submission time in seconds and
 * the deserialized body; TransactionsLoader passes them to walletStore unchanged.
 */
export interface PendingTxRecord {
  pending?: boolean;
  tx_timestamp?: number;
  body?: { inputs?: ReadonlyArray<{ txId?: unknown; index?: unknown } | null> };
}

/** `txId#index` of every input of a pending transaction submitted within the window. */
export function pendingSpentRefs(
  transactions: ReadonlyArray<PendingTxRecord | null> | null | undefined,
  nowMs: number,
): Set<string> {
  const refs = new Set<string>();
  for (const tx of transactions ?? []) {
    if (!tx?.pending) continue;
    const submittedMs = Number(tx.tx_timestamp) * 1000;
    if (!Number.isFinite(submittedMs) || nowMs - submittedMs > PENDING_SPEND_WINDOW_MS) continue;
    for (const input of tx.body?.inputs ?? []) {
      if (input?.txId == null || input.index == null) continue;
      refs.add(`${String(input.txId)}#${Number(input.index)}`);
    }
  }
  return refs;
}

/**
 * The wallet's UTxOs less those a pending transaction already spends. gero-sync drops
 * a spent UTxO only once its transaction is in a block, so until then a second send
 * would pick inputs the node refuses. Returns `utxos` itself when nothing is pending.
 */
export function withoutPendingSpends(
  utxos: Cardano.Utxo[],
  transactions: ReadonlyArray<PendingTxRecord | null> | null | undefined,
  nowMs: number = Date.now(),
): Cardano.Utxo[] {
  const spent = pendingSpentRefs(transactions, nowMs);
  if (spent.size === 0) return utxos;
  return utxos.filter(([txIn]) => !spent.has(`${txIn.txId}#${txIn.index}`));
}

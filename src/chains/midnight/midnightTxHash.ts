/**
 * A Midnight transaction has two hashes, and only one of them ever comes back.
 *
 * Submitting wraps the ledger tx in a Substrate extrinsic
 * (`midnight.sendMnTransaction(bytes)`), and the node answers with the hash of
 * that wrapper — the `0x…` value Nexus returns as `txHash`. The indexer, and so
 * gero-sync and every confirmed history row, identifies the same transaction
 * by the LEDGER hash (`Transaction.transactionHash()` in the SDK — the value the
 * official wallet SDK also uses to look its own transactions up). Nothing
 * downstream ever reports the extrinsic hash again, so a history row keyed on
 * it is orphaned for good: a pending row that never confirms next to the
 * confirmed row for the same send.
 *
 * Dependency-free on purpose: imported by the background service worker, the
 * stores and browser-context components alike.
 */

/**
 * Canonical form for keying and comparing tx hashes: lowercase, no `0x`. The
 * indexer hands hashes out bare; the node and the sidecar prefix theirs.
 */
export function normalizeMidnightTxHash(hash: string): string {
  const h = (hash || '').toLowerCase();
  return h.startsWith('0x') ? h.slice(2) : h;
}

/**
 * The ledger hash of a finalized (proven + bound) SDK transaction, normalized,
 * or `undefined` when the object cannot produce one. Best-effort and never
 * throws: this enriches a history row, and must not fail a proof that
 * succeeded. Mirrors the sidecar's `finalizedTxHashOrUndefined`.
 */
export function finalizedLedgerTxHash(tx: unknown): string | undefined {
  try {
    const candidate = tx as { transactionHash?: () => unknown };
    if (typeof candidate?.transactionHash !== 'function') return undefined;
    const hash = candidate.transactionHash();
    if (typeof hash !== 'string') return undefined;
    const normalized = normalizeMidnightTxHash(hash);
    return normalized.length > 0 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The hash to key a just-submitted transaction's history row (and anything
 * else that must match that row later, like the fee-sponsor attribution) on:
 * the ledger hash when either the sidecar or the wallet's own prover produced
 * one, else the extrinsic hash — which still tags the row, it just never
 * reconciles (the pre-fix behaviour, kept for a Nexus that predates
 * `ledgerTxHash`). Normalized to the confirmed row's format so the row reads
 * the same before and after confirmation.
 */
export function historyHashForSubmittedTx(result: { txHash: string; ledgerTxHash?: string }): string {
  return normalizeMidnightTxHash(result.ledgerTxHash || result.txHash);
}

/**
 * Identity of a history row: normalized hash + token. One indexer tx that
 * moves several colors yields one row per color sharing a hash, so the hash
 * alone is not a key; the optimistic pending row and the confirmed row that
 * later replaces it share exactly this key (see `midnightStore.applyTransaction`).
 */
export function midnightTxRowKey(tx: { hash: string; token: string }): string {
  return `${normalizeMidnightTxHash(tx.hash)}::${tx.token}`;
}

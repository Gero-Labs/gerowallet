import type { Cardano } from '@cardano-sdk/core';
import { InputLimitError, lovelaceOf, NEXUS_MAX_INPUTS, selectInputCandidates } from '@/api/nexusInputSelection';

/** What a swap takes besides the ADA it sells: batcher fee, deposit, aggregator and network fees. */
export const SWAP_ADA_MARGIN = 15_000_000n;

const lovelaceIn = (list: Cardano.Utxo[]) => list.reduce((sum, utxo) => sum + lovelaceOf(utxo), 0n);

/**
 * True when selling `amountIn` of `unit` needs the wallet merged first. The aggregator selects
 * inputs largest first with no cap, so a sale the largest NEXUS_MAX_INPUTS UTxOs cannot cover
 * comes back as a transaction too large for any node; when the whole wallet does hold it,
 * merging the wallet into itself (usePaymentSweep.consolidate) lets the swap go. A token the
 * wallet spreads over more UTxOs than that is not helped by merging ADA, so it is not reported.
 */
export function swapNeedsMerge(utxos: Cardano.Utxo[], unit: string, amountIn: bigint): boolean {
  if (utxos.length <= NEXUS_MAX_INPUTS || amountIn <= 0n) return false;
  const sellingAda = unit === 'lovelace';
  const needed = (sellingAda ? amountIn : 0n) + SWAP_ADA_MARGIN;
  let candidates: Cardano.Utxo[];
  try {
    candidates = selectInputCandidates(utxos, sellingAda ? {} : { requiredAssets: new Map([[unit, amountIn]]) }).utxos;
  } catch (error) {
    if (error instanceof InputLimitError) return false;
    throw error;
  }
  return lovelaceIn(candidates) < needed && lovelaceIn(utxos) >= needed;
}

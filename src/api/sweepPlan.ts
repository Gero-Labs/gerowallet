import type { Cardano } from '@cardano-sdk/core';
import { forEachAsset, lovelaceOf, NEXUS_MAX_INPUTS, refOf } from './nexusInputSelection';

/**
 * How Max reaches a wallet holding more UTxOs than one Nexus request may carry:
 * merge batches of them into one output each at the wallet's own address, then
 * pay from the merged outputs and the rest in a single transaction.
 */
export interface MergePlan {
  /** ADA-only UTxOs, smallest lovelace first; each batch becomes one merge transaction. */
  batches: Cardano.Utxo[][];
  /** What the payment spends directly: every token holder and the largest ADA-only UTxOs. */
  direct: Cardano.Utxo[];
}

/** A sweep's merges as the signer takes them. */
export interface SweepPrerequisites {
  /** The merges as Nexus built them (CBOR hex), in submission order: signed and submitted byte for byte. */
  cbors: string[];
  /** Their outputs at the wallet's own address, which the payment spends. */
  outputs: Cardano.Utxo[];
}

/**
 * Thrown when the merges sent with a payment are not exactly the ones it spends: one
 * whose output the payment does not spend, or the same merge twice.
 */
export class SweepChainError extends Error {
  constructor() {
    super('The payment does not spend the output of every merge sent with it');
    this.name = 'SweepChainError';
  }
}

function holdsAssets(utxo: Cardano.Utxo): boolean {
  let held = false;
  forEachAsset(utxo[1], () => { held = true; });
  return held;
}

/** Smallest lovelace first; ties by reference, so a plan never depends on the wallet's listing order. */
function bySmallest(a: Cardano.Utxo, b: Cardano.Utxo): number {
  const la = lovelaceOf(a);
  const lb = lovelaceOf(b);
  if (la !== lb) return la < lb ? -1 : 1;
  return refOf(a) < refOf(b) ? -1 : refOf(a) > refOf(b) ? 1 : 0;
}

/**
 * Plan the merges that bring a wallet under the request limit. Null when it already
 * fits, or when its token holders leave too few ADA-only UTxOs to merge.
 *
 * A merge of b UTxOs takes b - 1 off the count. With T UTxOs, k merges leave
 * T - merged + k for the payment, which must be at most `limit`, so
 * k = ceil((T - limit) / (limit - 1)) and merged = T - limit + k. The merged UTxOs
 * are spread evenly over the k batches (each between 2 and `limit`), and the
 * payment spends exactly `limit` inputs.
 */
export function planMerges(utxos: Cardano.Utxo[], limit: number = NEXUS_MAX_INPUTS): MergePlan | null {
  const total = utxos.length;
  if (total <= limit || limit < 2) return null;
  const holders = utxos.filter(holdsAssets);
  const adaOnly = utxos.filter((utxo) => !holdsAssets(utxo)).sort(bySmallest);
  const merges = Math.ceil((total - limit) / (limit - 1));
  const merged = total - limit + merges;
  if (merged > adaOnly.length) return null;

  const batches: Cardano.Utxo[][] = [];
  let start = 0;
  for (let i = 0; i < merges; i++) {
    const size = Math.floor(merged / merges) + (i < merged % merges ? 1 : 0);
    batches.push(adaOnly.slice(start, start + size));
    start += size;
  }
  return { batches, direct: [...holders, ...adaOnly.slice(start)] };
}

/** A built merge's outputs at the wallet's own address, as UTxOs the payment spends before the merge is in a block. */
export function ownOutputsAsUtxos(tx: Cardano.Tx, ownAddress: string): Cardano.Utxo[] {
  return tx.body.outputs.flatMap((txOut, index) => (String(txOut.address) === ownAddress
    ? [[{ txId: tx.id, index, address: txOut.address }, txOut] as Cardano.Utxo]
    : []));
}

/**
 * The merges a payment is sent with, in order, each with its id taken from the bytes
 * the signer will sign (`idOf`). The payment must spend an output of every one, and no
 * merge may appear twice: the approval covers the payment's bytes, and through its
 * inputs exactly these merges. Throws SweepChainError otherwise.
 */
export function chainedPrerequisites(
  payment: Cardano.Tx,
  mergeCbors: string[],
  idOf: (cbor: string) => string,
): { id: string; cbor: string }[] {
  const spent = new Set(payment.body.inputs.map((input) => String(input.txId)));
  const merges = mergeCbors.map((cbor) => ({ id: idOf(cbor), cbor }));
  if (new Set(merges.map((merge) => merge.id)).size !== merges.length) throw new SweepChainError();
  for (const merge of merges) {
    if (!spent.has(merge.id)) throw new SweepChainError();
  }
  return merges;
}

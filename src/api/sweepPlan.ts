import type { Cardano } from '@cardano-sdk/core';
import { forEachAsset, lovelaceOf, NEXUS_MAX_INPUTS, refOf, type InputSelection } from './nexusInputSelection';

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

/** Thrown when the merges sent with a payment do not hang together (see chainedPrerequisites). */
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

/**
 * True when a build Nexus refused, `shortfall` lovelace short, was offered only part of the
 * wallet (`selection` stopped at the request limit) and the UTxOs left out of it hold at least
 * that much: the wallet has the amount, spread over more UTxOs than one request carries.
 */
export function shortOnlyByLimit(shortfall: bigint | undefined, selection: InputSelection | null | undefined, available: Cardano.Utxo[]): boolean {
  if (!selection?.truncated || shortfall === undefined) return false;
  const total = (list: Cardano.Utxo[]) => list.reduce((sum, utxo) => sum + lovelaceOf(utxo), BigInt(0));
  return total(available) - total(selection.utxos) >= shortfall;
}

/** A built merge's outputs at the wallet's own address, as UTxOs the payment spends before the merge is in a block. */
export function ownOutputsAsUtxos(tx: Cardano.Tx, ownAddress: string): Cardano.Utxo[] {
  return tx.body.outputs.flatMap((txOut, index) => (String(txOut.address) === ownAddress
    ? [[{ txId: tx.id, index, address: txOut.address }, txOut] as Cardano.Utxo]
    : []));
}

/** What the signer needs to know about a merge, read from the bytes it signs. */
export interface DecodedMerge {
  id: string;
  outputAddresses: string[];
}

/**
 * The merges a payment is sent with, as the signer takes them, in order. Everything is
 * read from the bytes that get signed (`decode`), and the set must hang together: every
 * merge has an output and pays only `ownAddresses`, no merge repeats, the payment spends
 * every merge, and every listed output is one a merge has (its index below that merge's
 * output count) and is spent by the payment, one at least per merge. Throws
 * SweepChainError otherwise.
 */
export function chainedPrerequisites(
  payment: Cardano.Tx,
  prerequisites: SweepPrerequisites,
  decode: (cbor: string) => DecodedMerge,
  ownAddresses: ReadonlySet<string>,
): { id: string; cbor: string }[] {
  const spentRefs = new Set(payment.body.inputs.map((input) => `${input.txId}#${input.index}`));
  const spentTxs = new Set(payment.body.inputs.map((input) => String(input.txId)));
  /** Each merge's output count, by id: a listed output must be one the merge has. */
  const outputCounts = new Map<string, number>();
  const merges = prerequisites.cbors.map((cbor) => {
    const { id, outputAddresses } = decode(cbor);
    if (outputAddresses.length === 0 || !spentTxs.has(id) || !outputAddresses.every((address) => ownAddresses.has(address))) {
      throw new SweepChainError();
    }
    outputCounts.set(id, outputAddresses.length);
    return { id, cbor };
  });
  if (outputCounts.size !== merges.length) throw new SweepChainError();
  const withOutput = new Set<string>();
  for (const [txIn] of prerequisites.outputs) {
    const id = String(txIn.txId);
    if (txIn.index >= (outputCounts.get(id) ?? 0) || !spentRefs.has(`${id}#${txIn.index}`)) throw new SweepChainError();
    withOutput.add(id);
  }
  if (withOutput.size !== outputCounts.size) throw new SweepChainError();
  return merges;
}

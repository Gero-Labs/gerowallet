import { outputRef, provenTxOutput, type OutputRef, type ProvenOutputFailure, type TxCborSource } from '@/shared/utils/provenInputs';
import { fromHex, readArray, readBytes, readSet, readUint, toHex, type Bytes } from './cbor';
import type { DecodeContext } from './context';
import { decodeOutput, type OutputView } from './outputs';
import { FieldRefusal } from './refusals';

/**
 * Input references (body keys 0, 13 and 18) and their proof.
 *
 * The body names an input by `txId#index` only. What it spends (address and value) is read from
 * the transaction that created it, and only once that transaction's body hashes to `txId`
 * (`provenTxOutput`, shared with the dApp signing checks): whoever served the bytes, nothing else
 * hashes to that id. The bytes come from the caller's sources, so this module does no I/O. A
 * reference no source proves is `input_unresolved`, with why in the detail.
 */

export interface InputRef {
  txId: string;
  index: number;
  /** Where the body names it, e.g. `body.0[1]`. */
  path: string;
}

export interface ProvenInputView {
  txId: string;
  index: number;
  /** The output it spends or references, read from its creating transaction. */
  output: OutputView;
}

/** A set of `[transaction_id, index]`. */
export function decodeInputSet(item: Bytes, path: string): InputRef[] {
  const refs = readSet(item, path).map((element, i) => {
    const at = `${path}[${i}]`;
    const parts = readArray(element, at);
    if (parts.length !== 2) throw new FieldRefusal('field_malformed', at, 'input_length');
    const index = readUint(parts[1], at);
    if (index > 0xffffn) throw new FieldRefusal('field_malformed', at, 'input_index');
    return { txId: toHex(readBytes(parts[0], at, 32)), index: Number(index), path: at };
  });
  if (new Set(refs.map(outputRef)).size !== refs.length) throw new FieldRefusal('field_malformed', path, 'duplicate_element');
  return refs;
}

/** Why a reference stayed unproven: no source served its transaction, or what they served. */
type Unproven = 'not_served' | 'source_failed' | ProvenOutputFailure;

/**
 * The output each reference names, proven against its transaction id. Sources are asked in
 * order for what is still missing; a source that throws is skipped. References that stay
 * unproven, and proven outputs this decoder refuses to render (a Byron address, say), are
 * recorded in `ctx.refusals` and left out of the map.
 */
export async function proveInputs(
  refs: readonly InputRef[],
  sources: readonly TxCborSource[],
  ctx: DecodeContext,
): Promise<Map<OutputRef, OutputView>> {
  const proven = new Map<OutputRef, OutputView>();
  const why = new Map<OutputRef, Unproven>();
  const settled = new Set<OutputRef>();
  for (const source of sources) {
    const missing = refs.filter((ref) => !settled.has(outputRef(ref)));
    if (missing.length === 0) break;
    let served: Map<string, string>;
    try {
      served = await source([...new Set(missing.map((ref) => ref.txId))]);
    } catch {
      for (const ref of missing) if (!why.has(outputRef(ref))) why.set(outputRef(ref), 'source_failed');
      continue;
    }
    for (const ref of missing) {
      const key = outputRef(ref);
      const cbor = served.get(ref.txId);
      if (typeof cbor !== 'string') {
        if (!why.has(key)) why.set(key, 'not_served');
        continue;
      }
      const result = provenTxOutput(cbor, ref.txId, ref.index);
      if (!result.output) {
        why.set(key, result.failure);
        continue;
      }
      settled.add(key);
      const output = ctx.refusals.guard(ref.path, () => decodeOutput(fromHex(result.output.toCbor()), ref.path, ctx.networkId));
      if (output) proven.set(key, output);
    }
  }
  for (const ref of refs) {
    const key = outputRef(ref);
    if (!settled.has(key)) ctx.refusals.add('input_unresolved', ref.path, why.get(key) ?? 'not_served');
  }
  return proven;
}

/** The proven view of each reference, in body order. Only call once every reference is proven. */
export function provenViews(refs: readonly InputRef[], proven: ReadonlyMap<OutputRef, OutputView>): ProvenInputView[] {
  return refs.map((ref) => {
    const output = proven.get(outputRef(ref));
    if (!output) throw new Error(`Unproven input ${outputRef(ref)}`);
    return { txId: ref.txId, index: ref.index, output };
  });
}

/**
 * The Plutus part of a DUST operation's witness set, rebuilt the same way on every device: the
 * redeemers (fixed data and budgets, indexed from the body), their exact CBOR, and the script data
 * hash over them (Conway: `blake2b-256(redeemers || language views)`, no datums, since the
 * registration datum is inline).
 *
 * The hash is computed over the very bytes the witness set carries. Redeemers are written in the
 * list form `[[tag, index, data, ex_units], ...]`, which Conway still reads and which the
 * experiment's registration and deregistration used on preprod. The SDK's witness set would write
 * the Conway map form instead, so assembly sets these bytes on it as they are.
 *
 * Pure, no network: the background imports it.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { blake2b } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { hexToBytes } from '@/shared/gerovault/cbor';

/** Redeemer purposes a DUST operation uses. */
export type OperationRedeemerPurpose = 'spend' | 'mint';

export interface OperationRedeemer {
  readonly purpose: OperationRedeemerPurpose;
  /** The input's position among the sorted inputs (spend), or the policy's among the sorted policies (mint). */
  readonly index: number;
  /** The redeemer data, CBOR hex. */
  readonly dataCbor: string;
  readonly exUnits: Readonly<Cardano.ExUnits>;
}

const TAG: Readonly<Record<OperationRedeemerPurpose, number>> = { spend: 0, mint: 1 };

/** Redeemers in the order the witness set writes them: by tag, then index. */
function ordered(redeemers: readonly OperationRedeemer[]): OperationRedeemer[] {
  return [...redeemers].sort((a, b) => TAG[a.purpose] - TAG[b.purpose] || a.index - b.index);
}

/** The redeemers field of the witness set (key 5), in the list form, CBOR hex. */
export function redeemersCbor(redeemers: readonly OperationRedeemer[]): string {
  const writer = new Serialization.CborWriter();
  const list = ordered(redeemers);
  writer.writeStartArray(list.length);
  for (const redeemer of list) {
    writer.writeStartArray(4);
    writer.writeInt(TAG[redeemer.purpose]);
    writer.writeInt(redeemer.index);
    writer.writeEncodedValue(hexToBytes(redeemer.dataCbor) ?? new Uint8Array());
    writer.writeStartArray(2);
    writer.writeInt(redeemer.exUnits.memory);
    writer.writeInt(redeemer.exUnits.steps);
  }
  return writer.encodeAsHex();
}

/** The language views of Plutus V3 alone, for a cost model given as the protocol parameters hold it. */
export function plutusV3LanguageViews(costModel: readonly number[]): string {
  const models = new Serialization.Costmdls();
  models.insert(new Serialization.CostModel(Cardano.PlutusLanguageVersion.V3, [...costModel]));
  return models.languageViewsEncoding();
}

/** `blake2b-256(redeemers || language views)`: the script data hash of a transaction with no datums. */
export function scriptDataHashOf(redeemersFieldCbor: string, costModel: readonly number[]): string {
  return blake2b.hash(HexBlob(`${redeemersFieldCbor}${plutusV3LanguageViews(costModel)}`), 32).toString();
}

/** The Plutus V3 cost model of the protocol parameters, or undefined when they hold none. */
export function plutusV3CostModel(costModels: Cardano.CostModels | null | undefined): number[] | undefined {
  const model = costModels instanceof Map ? costModels.get(Cardano.PlutusLanguageVersion.V3) : undefined;
  return Array.isArray(model) && model.length > 0 && model.every(n => Number.isSafeInteger(n)) ? [...model] : undefined;
}

/** The position of an input among a body's inputs in the ledger's order (transaction id, then index). */
export function sortedInputIndex(inputs: readonly { readonly txId: string; readonly index: number }[], txId: string, index: number): number {
  const sorted = [...inputs].sort((a, b) => (a.txId < b.txId ? -1 : a.txId > b.txId ? 1 : a.index - b.index));
  return sorted.findIndex(input => input.txId === txId && input.index === index);
}

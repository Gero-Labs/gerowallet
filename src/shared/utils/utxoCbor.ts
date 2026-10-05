import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { toScriptReference } from './scriptReference';

/**
 * The inline datum as the wallet keeps it in `TxOut.datum`: its original CBOR, nothing else.
 *
 * The obvious alternatives all lose the bytes:
 * - Core PlutusData from `PlutusData.fromCbor(cbor).toCore()`: a list's `cbor` is the SDK's
 *   own re-encoding, and an integer or bytes datum has nowhere to keep one. Inline datums
 *   are not all in the SDK's encoding (definite-length lists, for one), and re-encoding
 *   changes their bytes and their hash.
 * - The walletStore JSON (every broadcast, every persisted write) turns bigints into strings,
 *   Maps into objects and Uint8Arrays into index maps, none of which `fromCore` reads back.
 * - A bare hex string is what `Datum.fromCore` takes for a datum HASH.
 *
 * `{ cbor }` survives JSON and structured clone, and `PlutusData.fromCore` still reads it (it
 * rebuilds from `cbor` when there is one). The wallet's own serializers go through
 * `inlineDatumPlutusData` instead of relying on that.
 */
export function inlineDatumFromCbor(cbor: HexBlob): Cardano.PlutusData {
  // Parse now: a datum that cannot be read fails this one UTxO, not every later getUtxos.
  Serialization.PlutusData.fromCbor(cbor);
  return { cbor } as unknown as Cardano.PlutusData;
}

/**
 * The original CBOR of an inline datum, in any shape one has had in `TxOut.datum`:
 * - `{ cbor }`, as the wallet stores it (or a Core PlutusData carrying its cbor);
 * - `{ bytes, value | json }`, a Nexus row's datum, stored as-is by earlier versions;
 * - bare hex, gero-sync's datum for an output it takes from a block, also stored as-is.
 *
 * Undefined when there is none, or for a Core value without bytes (bigint, Uint8Array).
 */
export function inlineDatumCbor(datum: unknown): HexBlob | undefined {
  if (typeof datum === 'string') return datum ? HexBlob(datum) : undefined;
  if (datum && typeof datum === 'object') {
    const { cbor, bytes } = datum as { cbor?: unknown; bytes?: unknown };
    if (typeof cbor === 'string' && cbor) return HexBlob(cbor);
    if (typeof bytes === 'string' && bytes) return HexBlob(bytes);
  }
  return undefined;
}

/** A stored inline datum as SDK PlutusData, over its original bytes whenever they are known. */
export function inlineDatumPlutusData(datum: Cardano.PlutusData): Serialization.PlutusData {
  const cbor = inlineDatumCbor(datum);
  return cbor ? Serialization.PlutusData.fromCbor(cbor) : Serialization.PlutusData.fromCore(datum);
}

/** Coins and assets as `fromCore` needs them, rebuilt if they went through the walletStore JSON. */
function coreValue(value: Cardano.Value): Cardano.Value {
  if (!value.assets || value.assets instanceof Map) {
    return { coins: BigInt(value.coins), assets: value.assets || undefined };
  }
  const assets = new Map<Cardano.AssetId, bigint>();
  for (const [assetId, quantity] of Object.entries(value.assets)) {
    assets.set(assetId as Cardano.AssetId, BigInt(quantity as string | number | bigint));
  }
  return { coins: BigInt(value.coins), assets };
}

/**
 * A wallet UTxO as a CIP-30 TransactionUnspentOutput, whether it is live or came back
 * through the walletStore JSON.
 *
 * The datum is set here rather than by `TransactionOutput.fromCore`, which applies `datum`
 * and then `datumHash`: an inline datum stored beside its hash (as Nexus sends it, and as
 * earlier versions kept it) would come out as a datum-HASH output. On chain an output
 * holds one or the other, so an inline datum wins.
 *
 * The reference script goes through `toScriptReference` here as well as at ingestion,
 * because UTxOs stored by earlier versions still hold Nexus's raw script object, or
 * gero-sync's hex string, until the next push replaces them.
 */
export function toTransactionUnspentOutput([txIn, txOut]: Cardano.Utxo): Serialization.TransactionUnspentOutput {
  const output = Serialization.TransactionOutput.fromCore({
    address: txOut.address,
    value: coreValue(txOut.value),
    scriptReference: toScriptReference(txOut.scriptReference),
  });
  if (txOut.datum != null) {
    output.setDatum(Serialization.Datum.newInlineData(inlineDatumPlutusData(txOut.datum)));
  } else if (txOut.datumHash) {
    output.setDatum(Serialization.Datum.newDataHash(txOut.datumHash));
  }
  return new Serialization.TransactionUnspentOutput(
    Serialization.TransactionInput.fromCore({ txId: txIn.txId, index: txIn.index }),
    output,
  );
}

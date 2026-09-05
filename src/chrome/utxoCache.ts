import { Cardano } from '@cardano-sdk/core';

/**
 * The per-wallet `utxos` table: the UTxO set the wallet is rebuilt from on login and
 * after an MV3 worker restart, before gero-sync has pushed anything.
 *
 * Both halves of the CIP-113 partition are stored, tagged. The spendable half alone is
 * not enough: the locked lovelace is inside the stake-level `controlled_amount`, so a
 * restore that cannot see the programmable half reports the locked ADA as spendable
 * until the first live push lands.
 */

/** Which half of the CIP-113 partition a row was in when it was written. */
export type CachedUtxoPartition = 'spendable' | 'programmable';

/** Row shape in the `utxos` table. Values are structured-clone safe (no BigInt, no Map). */
export interface CachedUtxoRow {
  txId: string;
  index: number;
  address: string;
  coins: string | number;
  assets?: { unit: string; quantity: string | number }[];
  datumHash?: Cardano.DatumHash | null;
  datum?: Cardano.PlutusData | null;
  scriptReference?: Cardano.Script | null;
  /** Absent on rows written before the programmable half was persisted. */
  partition?: CachedUtxoPartition;
}

export function serializeUtxoRows(utxos: Cardano.Utxo[], partition: CachedUtxoPartition): CachedUtxoRow[] {
  return utxos.map(([txIn, txOut]) => ({
    txId: txIn.txId,
    index: txIn.index,
    address: txOut.address,
    coins: txOut.value.coins.toString(),
    assets: txOut.value.assets
      ? Array.from(txOut.value.assets.entries()).map(([unit, quantity]) => ({ unit, quantity: quantity.toString() }))
      : [],
    datumHash: txOut.datumHash || null,
    datum: txOut.datum || null,
    scriptReference: txOut.scriptReference || null,
    partition,
  }));
}

/**
 * Rebuild the cached UTxOs.
 *
 * Both halves come back in one list: the partition is re-derived by
 * classifyUtxoAddress on the way in, exactly as it is for a live push, so the cache
 * never carries an opinion that the classifier would now disagree with (a deployment
 * added to or removed from the network config takes effect here too).
 *
 * `partitionKnown` says whether these rows account for the programmable half. A cache
 * written before the tag existed does not: aggregating from it would report zero locked
 * lovelace and clear the refusal index that loadProgrammableRefs() just restored.
 */
export function readCachedUtxoRows(rows: CachedUtxoRow[]): { utxos: Cardano.Utxo[]; partitionKnown: boolean } {
  const utxos: Cardano.Utxo[] = rows.map((row) => {
    const assets = new Map<Cardano.AssetId, bigint>();
    if (row.assets) {
      for (const a of row.assets) {
        assets.set(Cardano.AssetId(a.unit), BigInt(a.quantity));
      }
    }
    return [
      {
        txId: Cardano.TransactionId(row.txId),
        index: row.index,
        address: row.address as Cardano.PaymentAddress,
      },
      {
        address: row.address as Cardano.PaymentAddress,
        value: { coins: BigInt(row.coins), assets: assets.size > 0 ? assets : undefined },
        datumHash: row.datumHash || undefined,
        datum: row.datum || undefined,
        scriptReference: row.scriptReference || undefined,
      },
    ] as Cardano.Utxo;
  });

  return { utxos, partitionKnown: rows.some((row) => row.partition != null) };
}

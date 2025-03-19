import { Cardano, Serialization } from '@cardano-sdk/core';

export function toUTxO(utxo: any): Serialization.TransactionUnspentOutput {
  const tokenMap = utxo.asset_list.reduce((map: Map<Cardano.AssetId, bigint>, asset: any) => {
    const assetId: Cardano.AssetId = Cardano.AssetId.fromParts(asset.policy_id, asset.asset_name);
    const current: bigint = map.get(assetId) ?? 0n;
    map.set(assetId, current + BigInt(asset.quantity));
    return map;
  }, new Map<Cardano.AssetId, bigint>());

  return Serialization.TransactionUnspentOutput.fromCore([
    {
      txId: Cardano.TransactionId.fromHexBlob(utxo.tx_hash),
      index: utxo.tx_index
    },
    {
      address: Cardano.PaymentAddress(utxo.payment_addr.bech32),
      value: {
        coins: BigInt(utxo.value),
        assets: tokenMap,
      },
      datumHash: utxo.datum_hash,
      datum: utxo.inline_datum,
      scriptReference: utxo.reference_script
    }
  ]);
}

export function toValue(assets: any[], lovelace: string): Serialization.Value {
  const tokenMap = assets.reduce((map, asset) => {
    const assetId: Cardano.AssetId = Cardano.AssetId.fromParts(asset.policy_id, asset.asset_name);
    const current = map.get(assetId) ?? 0n;
    map.set(assetId, current + BigInt(asset.quantity));
    return map;
  }, new Map<Cardano.AssetId, bigint>());
  return new Serialization.Value(BigInt(lovelace), tokenMap)
}

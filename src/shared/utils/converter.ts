import {
  Address,
  BaseAddress,
  MultiAsset, TransactionHash,
  TransactionInput,
  TransactionUnspentOutput,
  TransactionOutput, Assets, AssetName, BigNum, ScriptHash, Value,
} from '@emurgo/cardano-serialization-lib-browser';

export const toAddress = bech32 => Address.from_bech32(bech32);

export const toBaseAddress = bech32 => BaseAddress.from_address(toAddress(bech32));

export function toUTxO(output, address): TransactionUnspentOutput {
  return TransactionUnspentOutput.new(
    TransactionInput.new(
      TransactionHash.from_bytes(Buffer.from(output.tx_hash || output.txHash, 'hex')),
      output.output_index ?? output.txId
    ),
    TransactionOutput.new(
      Address.from_bytes(Buffer.from(address, 'hex')),
      toValue(output.asset_list, output.value)
    )
  );
}

export function toValue(assets, lovelace) {
  const multiAsset = MultiAsset.new();
  const policies: any[] = [...new Set(assets.map((asset) => asset.policy_id))];
  policies.forEach((policy) => {
    const policyAssets = assets.filter((asset) => asset.policy_id === policy);
    const assetsValue = Assets.new();
    policyAssets.forEach((asset) => {
      assetsValue.insert(
        AssetName.new(Buffer.from(asset.asset_name, 'hex')), BigNum.from_str(asset.quantity)
      );
    });
    multiAsset.insert(
      ScriptHash.from_bytes(Buffer.from(policy, 'hex')),
      assetsValue
    );
  });
  const value = Value.new(BigNum.from_str(lovelace));
  if (assets.length > 1 || !lovelace) value.set_multiasset(multiAsset);
  return value;
}

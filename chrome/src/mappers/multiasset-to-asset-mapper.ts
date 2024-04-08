import { MultiAsset, } from "@emurgo/cardano-serialization-lib-browser";
import { autoInjectable, singleton } from "tsyringe";
import { AssetWithQuantity } from "../models/asset-quantity";

@singleton()
@autoInjectable()
export class MultiAssetToAssetMapper {
  public getAssetsFromMultiAsset(multiAsset: MultiAsset): AssetWithQuantity[] {
    if (!multiAsset) return [];

    const result = [];
    const hashes = multiAsset.keys();

    for (let i = 0; i < hashes.len(); i++) {
      const policyId = hashes.get(i);
      const assetsForPolicy = multiAsset.get(policyId);
      // eslint-disable-next-line
      if (assetsForPolicy == null) continue

      const policies = assetsForPolicy.keys();

      for (let j = 0; j < policies.len(); j++) {
        const assetName = policies.get(j);
        const amount = assetsForPolicy.get(assetName);
        // eslint-disable-next-line
        if (amount == null) continue

        const parsedQuantity = amount.to_str();
        const parsedName = Buffer.from(assetName.name()).toString('hex');
        const parsedPolicyId = Buffer.from(policyId.to_bytes()).toString('hex');
        const parsedAssetId = `${parsedPolicyId}${parsedName}`;

        result.push(new AssetWithQuantity(parsedName, parsedQuantity, parsedAssetId, parsedPolicyId));
      }
    }
    return result;
  };
}

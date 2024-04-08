import { AsyncLoader } from './AsyncLoader';

export function assetsToValue(assets) {
    const multiAsset = AsyncLoader.Serialization.MultiAsset.new();
    const lovelace = assets.find((asset) => asset.unit === 'lovelace');
    const setOfAssets = new Set(
        assets.filter((asset) => asset.unit !== 'lovelace').map((asset) => asset.unit.slice(0, 56)),
    );

    const policies = Array.from(setOfAssets.values());

    policies.forEach((policy) => {
        const policyAssets = assets.filter((asset) => asset.unit.slice(0, 56) === policy);
        const assetsValue = AsyncLoader.Serialization.Assets.new();
        policyAssets.forEach((asset) => {
            assetsValue.insert(
                AsyncLoader.Serialization.AssetName.new(Buffer.from(asset.unit.slice(56), 'hex')),
                AsyncLoader.Serialization.BigNum.from_str(asset.quantity),
            );
        });

        multiAsset.insert(
            AsyncLoader.Serialization.ScriptHash.from_bytes(Buffer.from(policy.toString(), 'hex')),
            assetsValue,
        );
    });
    const value = AsyncLoader.Serialization.Value.new(
        AsyncLoader.Serialization.BigNum.from_str(lovelace ? lovelace.quantity : '0'),
    );

    if (assets.length > 1 || !lovelace) value.set_multiasset(multiAsset);

    return value;
}

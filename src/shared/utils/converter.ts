import {
  Address,
  AssetName,
  Assets,
  BaseAddress,
  BigInt,
  BigNum,
  ByronAddress,
  ConstrPlutusData,
  MultiAsset,
  PlutusData,
  PlutusList,
  PlutusMap,
  ScriptHash,
  TransactionHash,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  Value,
} from '@emurgo/cardano-serialization-lib-browser';
import { blake2b } from 'blakejs';
import { bech32 } from 'bech32';

export const toAddress = bech32 => Address.from_bech32(bech32);

export const toBaseAddress = bech32 => BaseAddress.from_address(toAddress(bech32));

export function toUTxO(output): TransactionUnspentOutput {
  if (output.tx_hash === '167e232bc0fa82e96b992d13df9336a543c2b3e8c5cc234aa55f3a32af195037') {
    console.log(output.tx_hash)
  }
  return TransactionUnspentOutput.new(
    TransactionInput.new(TransactionHash.from_bytes(Buffer.from(output.tx_hash, 'hex')), output.tx_index),
    TransactionOutput.new(Address.from_bech32(output.payment_addr.bech32), toValue(output.asset_list, output.value)
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
      assetsValue.insert(AssetName.new(Buffer.from(asset.asset_name, 'hex')), BigNum.from_str(asset.quantity));
    });
    multiAsset.insert(ScriptHash.from_bytes(Buffer.from(policy, 'hex')), assetsValue);
  });
  const value = Value.new(BigNum.from_str(lovelace));
  if (assets.length > 0 || !lovelace) value.set_multiasset(multiAsset);
  return value;
}

export function jsonToPlutusData(jsonObj): PlutusData {
  function parsePlutusData(data) {
    if ('bytes' in data) {
      return PlutusData.new_bytes(Buffer.from(data.bytes, 'hex'));
    } else if (data.int !== undefined) {
      return PlutusData.new_integer(BigInt.from_str(data.int.toString()));
    } else if (data.list) {
      const plutusList = PlutusList.new();
      data.list.forEach(item => {
        plutusList.add(parsePlutusData(item));
      });
      return PlutusData.new_list(plutusList);
    } else if (data.map) {
      const plutusMap = PlutusMap.new();
      data.map.forEach(item => {
        const key = parsePlutusData(item.k);
        const value = parsePlutusData(item.v);
        plutusMap.insert(key, value);
      });
      return PlutusData.new_map(plutusMap);
    } else if (data.constructor !== undefined && data.fields) {
      const constrFields = PlutusList.new();
      data.fields.forEach(field => {
        constrFields.add(parsePlutusData(field));
      });
      return PlutusData.new_constr_plutus_data(
        ConstrPlutusData.new(
          BigNum.from_str(data.constructor.toString()),
          constrFields
        )
      );
    } else {
      throw new Error('Unsupported PlutusData format');
    }
  }

  return parsePlutusData(jsonObj);
}

export function normalizeToAddress(addr: string): Address {
  // in Shelley, addresses can be base16, bech32 or base58
  // this function, we try parsing in all encodings possible

  // 1) Try converting from base58
  if (ByronAddress.is_valid(addr)) {
    return ByronAddress.from_base58(addr).to_address();
  }

  // 2) If already base16, simply return
  try {
    return Address.from_bytes(Buffer.from(addr, 'hex'));
  } catch (_e) {} // eslint-disable-line no-empty

  // 3) Try converting from base32
  try {
    return Address.from_bech32(addr);
  } catch (_e) {} // eslint-disable-line no-empty

  return undefined;
}

export const assetsToValue = (assets) => {
  const multiAsset = MultiAsset.new();
  const lovelace = assets.find((asset) => asset.unit === 'lovelace');
  const policies: any[] = [
    ...new Set(
      assets
        .filter((asset) => asset.unit !== 'lovelace')
        .map((asset) => asset.unit.slice(0, 56))
    ),
  ];
  policies.forEach((policy) => {
    const policyAssets = assets.filter(
      (asset) => asset.unit.slice(0, 56) === policy
    );
    const assetsValue = Assets.new();
    policyAssets.forEach((asset) => {
      assetsValue.insert(
        AssetName.new(Buffer.from(asset.unit.slice(56), 'hex')),
        BigNum.from_str(asset.quantity)
      );
    });
    multiAsset.insert(
      ScriptHash.from_bytes(Buffer.from(policy, 'hex')),
      assetsValue
    );
  });
  const value = Value.new(BigNum.from_str(lovelace ? lovelace.quantity : '0'));
  if (assets.length > 1 || !lovelace) value.set_multiasset(multiAsset);
  return value;
};

export function getColor(value) {
  if (value > 100) {
    value = 100
  }
  value = value / 100
  //value from 0 to 1
  const hue = ((1 - value) * 120).toString(10);
  return ["hsl(", hue, ",57.26%,54.12%)"].join("");
}

export function getArtists(artists) {
  if (artists !== undefined && Array.isArray(artists)) {
    return artists.join(', ');
  }
  return artists;
}

export function formatTime(secs: number): string {
  const minutes = Math.floor(secs / 60) || 0;
  const seconds = (secs - minutes * 60) || 0;
  return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
}

export function unitToFingerprint(unit) {
  const policyIdBytes = Buffer.from(unit.slice(0,56), 'hex');
  const assetNameBytes = Buffer.from(unit.slice(56), 'hex');
  const combined = Buffer.concat([policyIdBytes, assetNameBytes]);
  // Perform Blake2b-160 hash on the combined bytes
  const hash = blake2b(combined, null, 20);
  // Encode the result as Bech32
  const words = bech32.toWords(hash);
  return bech32.encode('asset', words)
}

export function stringToHex(input: string) {
  let hexString = '';
  for (let i = 0; i < input.length; i++) {
    hexString += input.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hexString;
}

export function hexToString(hex) {
  let output = '';
  for (let i = 0; i < hex.length; i += 2) {
    output += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return output;
}

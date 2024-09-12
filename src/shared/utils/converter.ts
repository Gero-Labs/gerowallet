import {
  Address,
  AssetName,
  Assets,
  BaseAddress,
  BigInt,
  BigNum,
  ByronAddress,
  ConstrPlutusData,
  Credential,
  EnterpriseAddress, MultiAsset,
  PlutusData,
  PlutusList,
  PlutusMap, PlutusMapValues, PointerAddress, RewardAddress,
  ScriptHash,
  TransactionHash,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  Value,
} from '@emurgo/cardano-serialization-lib-browser';
import { blake2b } from 'blakejs';
import { bech32 } from 'bech32';
import {
  AlgorithmId,
  BigNum as BigNum2,
  Int as Int2,
  CBORValue, COSEKey,
  COSESign1Builder,
  HeaderMap,
  Headers, KeyType,
  Label,
  ProtectedHeaderMap, COSESign1,
} from '@emurgo/cardano-message-signing-browser';

export const toAddress = bech32 => Address.from_bech32(bech32);

export const toBaseAddress = bech32 => BaseAddress.from_address(toAddress(bech32));

export function toUTxO(output): TransactionUnspentOutput {
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
        const values = PlutusMapValues.new();
        values.add(value)
        plutusMap.insert(key, values);
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

export function bytesToIp(bytes) {
  if (!bytes) return null;
  if (bytes.length === 4) {
    return {ipv4: bytes.join('.')};
  } else if (bytes.length === 16) {
    let ipv6 = '';
    for (let i = 0; i < bytes.length; i += 2) {
      ipv6 += bytes[i].toString(16) + bytes[i + 1].toString(16) + ':';
    }
    ipv6 = ipv6.slice(0, -1);
    return {ipv6};
  }
  return null;
}

export const toHexArray = (hex2: string): Uint8Array => Uint8Array.from(toHexBuffer(hex2));
export const toHexBuffer = (hex2: string): Buffer => Buffer.from(byteaToHex(hex2), "hex")
export const byteaToHex = (bytea: string): string => bytea.startsWith("\\x") ? bytea.substring(2) : bytea;
export const toHexString = (arr: Uint8Array): string => arr ? Buffer.from(arr).toString("hex") : "";
export function hdPathToArray(path: string): number[] {
  // Remove the 'm/' part of the path and split by '/'
  const parts = path.replace('m/', '').split('/');

  // Convert each part to an integer, handling hardened indices
  return parts.map(part => {
    if (part.endsWith("'")) {
      // If the part ends with an apostrophe, it's a hardened index
      return parseInt(part.slice(0, -1), 10) + 0x80000000; // Add the hardened flag
    } else {
      // Otherwise, it's a normal index
      return parseInt(part, 10);
    }
  });
}

export function stakeCredential(address: string): Credential {
  const keyAddress: Address = Address.from_bech32(address);
  try {
    return BaseAddress.from_address(keyAddress)
      .stake_cred();
  } catch (e) {
    // I want application to not crush, but don't care about the message
  }
  return undefined;
}

export function toStakeKeyHash(address: string) {
  const credential: Credential = stakeCredential(address)
  if (credential) {
    return credential.to_keyhash();
  }
  return undefined;
}

export function paymentCredentials(address: string) {
  const keyAddress: Address = Address.from_bech32(address);
  try {
    return BaseAddress.from_address(keyAddress)
      .payment_cred()
  } catch (e) {
    // I want application to not crush, but don't care about the message
  }
  try {
    return EnterpriseAddress.from_address(keyAddress)
      .payment_cred()
  } catch (e) {
    // I want application to not crush, but don't care about the message
  }
  try {
    return PointerAddress.from_address(keyAddress)
      .payment_cred()
  } catch (e) {
    // I want application to not crush, but don't care about the message
  }
  try {
    RewardAddress.from_address(keyAddress)
      .payment_cred()
  } catch (e) {
    // I want application to not crush, but don't care about the message
  }
  return undefined;
}

export function addressCredentials(address: string) {
  return { payment: paymentCredentials(address), stake: stakeCredential(address) }
}

export const createSignDataBuilder = (addressBytes: Uint8Array, payload2: string, hashed: boolean) => {
  console.log('createSignDataBuilder')
  const free: any[] = [];
  const protectedHeaders: HeaderMap = HeaderMap.new();
  free.push(protectedHeaders);
  const labelAlgoid: Label = Label.from_algorithm_id(AlgorithmId.EdDSA);
  free.push(labelAlgoid);
  const labelAddress: Label = Label.new_text("address");
  free.push(labelAddress);
  const valueAddress: CBORValue = CBORValue.new_bytes(addressBytes);
  free.push(valueAddress);
  protectedHeaders.set_algorithm_id(labelAlgoid);
  protectedHeaders.set_header(labelAddress, valueAddress);
  const protectedSerialized: ProtectedHeaderMap = ProtectedHeaderMap.new(protectedHeaders);
  free.push(protectedSerialized);
  const unprotectedHeaders: HeaderMap = HeaderMap.new();
  free.push(unprotectedHeaders);
  const headers: Headers = Headers.new(protectedSerialized, unprotectedHeaders);
  free.push(headers);
  console.log('protectedHeaders', protectedHeaders.to_bytes());
  console.log('unprotectedHeaders', unprotectedHeaders.to_bytes());
  console.log('headers', headers.to_bytes())
  console.log('payload', toHexBuffer(payload2))
  const builder2:COSESign1Builder = COSESign1Builder.new(headers, toHexBuffer(payload2), false);
  if (hashed) {
    builder2.hash_payload();
  }
  freeCSLObjects(free);
  return builder2;
};

export const createCOSEKeyHex = (pubKeyBytes) => {
  const free = [];
  const okpKey = Label.from_key_type(KeyType.OKP);
  free.push(okpKey);
  const key3 = COSEKey.new(okpKey);
  free.push(key3);
  const algId = Label.from_algorithm_id(AlgorithmId.EdDSA);
  free.push(algId);
  const big1 = BigNum2.from_str("1");
  free.push(big1);
  const big2 = BigNum2.from_str("2");
  free.push(big2);
  const neg1 = Int2.new_negative(big1);
  free.push(neg1);
  const neg22 = Int2.new_negative(big2);
  free.push(neg22);
  const labelNeg1 = Label.new_int(neg1);
  free.push(labelNeg1);
  const labelNeg2 = Label.new_int(neg22);
  free.push(labelNeg2);
  const int6 = Int2.new_i32(6);
  free.push(int6);
  const cborInt6 = CBORValue.new_int(int6);
  free.push(cborInt6);
  const cborPubKey = CBORValue.new_bytes(pubKeyBytes);
  free.push(cborPubKey);
  key3.set_algorithm_id(algId);
  key3.set_header(labelNeg1, cborInt6);
  key3.set_header(labelNeg2, cborPubKey);
  const keyHex = toHexString(key3.to_bytes());
  freeCSLObjects(free);
  return keyHex;
};

export function verifyData(data: { key: string; signature: string }, address2: string, payload2: string) {
  const coseSign1_verify = COSESign1.from_bytes(toHexBuffer(data.signature));
  const signedSigStruc_verify = coseSign1_verify.signed_data();
  const isSame = toHexString(signedSigStruc_verify.payload()) === payload2;
  console.log(payload2)
  console.warn("verifyData: isSame:", isSame);
  return isSame;
}

export const safeFreeCSLObject = (obj2) => {
  if (obj2 && obj2.free) {
    if (obj2.__wbg_ptr > 0) {
      obj2.free();
    }
  }
};

const freeCSLObjects = (free) => {
  let _a, _b;
  for (let k2 = free.length - 1; k2 >= 0; k2--) {
    try {
      (_b = (_a = free[k2]) == null ? void 0 : _a.free) == null ? void 0 : _b.call(_a);
      // eslint-disable-next-line no-empty
    } catch (e) {
    }
  }
  free.length = 0;
};
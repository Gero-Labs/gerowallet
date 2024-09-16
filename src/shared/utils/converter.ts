import {
  Address,
  AssetName,
  Assets, AuxiliaryData, AuxiliaryDataHash,
  BaseAddress,
  BigInt,
  BigNum,
  ByronAddress,
  ConstrPlutusData,
  Credential, decode_metadatum_to_json_str, Ed25519KeyHashes,
  EnterpriseAddress, GeneralTransactionMetadata, hash_plutus_data, MetadataJsonSchema, MetadataList, Mint, MultiAsset,
  PlutusData, PlutusDatumSchema,
  PlutusList,
  PlutusMap, PlutusMapValues, PointerAddress, RewardAddress,
  ScriptHash, TransactionHash,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  Value,
} from '@emurgo/cardano-serialization-lib-browser';
import { blake2b, blake2bHex } from 'blakejs';
import { bech32 } from 'bech32';
import {
  AlgorithmId,
  BigNum as BigNum2,
  Int as Int2,
  CBORValue,
  COSESign1Builder,
  Headers,
  HeaderMap,
  Label,
  ProtectedHeaderMap, KeyType, COSEKey, COSESign1,
} from '@emurgo/cardano-message-signing-browser';

import {
  AddressType,
  CIP36VoteRegistrationFormat, RequiredSigner, TransactionSigningMode,
  TxAuxiliaryDataType,
  TxOutputDestinationType, TxRequiredSignerType,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { Buffer } from 'buffer';
import { decode } from 'cborg';

const _inMemoryCacheAddressCredentials = new Map();
const cacheAddressCredentials = (addrHexOrBech32, addressCredentials) => {
  _inMemoryCacheAddressCredentials.set(addrHexOrBech32, addressCredentials);
  return addressCredentials;
};

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
  const free: any[] = [];
  const protectedHeaders = HeaderMap.new();
  free.push(protectedHeaders);
  const labelAlgoid = Label.from_algorithm_id(AlgorithmId.EdDSA);
  free.push(labelAlgoid);
  const labelAddress = Label.new_text("address");
  free.push(labelAddress);
  const valueAddress = CBORValue.new_bytes(addressBytes);
  free.push(valueAddress);
  protectedHeaders.set_algorithm_id(labelAlgoid);
  protectedHeaders.set_header(labelAddress, valueAddress);
  const protectedSerialized = ProtectedHeaderMap.new(protectedHeaders);
  free.push(protectedSerialized);
  const unprotectedHeaders = HeaderMap.new();
  free.push(unprotectedHeaders);
  const headers = Headers.new(protectedSerialized, unprotectedHeaders);
  free.push(headers);
  const builder2 = COSESign1Builder.new(headers, toHexBuffer(payload2), false);
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
    } catch (e) {
      //
    }
  }
  free.length = 0;
};

const _getPlutusHVB = (data) => {
  let pData = null;
  const free = [];
  try {
    pData = PlutusData.from_json(JSON.stringify(data), PlutusDatumSchema.DetailedSchema);
    free.push(pData);
  } catch (err2) {
    //
  }
  if (!pData) {
    try {
      pData = PlutusData.from_json(JSON.stringify(data), PlutusDatumSchema.BasicConversions);
      free.push(pData);
    } catch (err2) {
      //
    }
  }
  if (!pData) {
    try {
      pData = PlutusData.from_bytes(toHexArray(data));
      free.push(pData);
    } catch (err2) {
      //
    }
  }
  if (pData) {
    const cslDataHash = hash_plutus_data(data);
    free.push(cslDataHash);
    const datum = {
      hash: cslDataHash.to_hex(),
      bytes: pData.to_hex(),
      value: getPlutusDataJSONFromCSL(pData)
    };
    freeCSLObjects(free);
    return datum;
  }
  return null;
};

export const getPlutusHVB = (data) => {
  if (!data) {
    return {
      hash: "",
      bytes: "",
      value: null
    };
  }
  if (typeof data === "string") {
    const datum = _getPlutusHVB(data);
    if (datum) {
      return datum;
    }
  } else if (typeof data === "object") {
    if (Object.prototype.hasOwnProperty.call(data, "DataHash")) {
      return {
        hash: data.DataHash,
        bytes: "",
        value: null
      };
    } else if (Object.prototype.hasOwnProperty.call(data, "Data")) {
      const datum = _getPlutusHVB(data.Data);
      if (datum) {
        return datum;
      }
    } else {
      const datum = _getPlutusHVB(data);
      if (datum) {
        return datum;
      }
    }
  }
  return {
    hash: "",
    bytes: "",
    value: null
  };
};

export const isSameArray = (a1, a2) => {
  return a1.length === a2.length && a1.every((v2, i2) => v2 === a2[i2]);
};

export const hasConwaySetTag = (tx2) => {
  if (typeof tx2 === "string") {
    tx2 = getDecodedCbor(tx2);
  }
  const decodedTx = tx2;
  const decodedTxBody = getDecodedTxBody(decodedTx);
  for (const item of decodedTxBody) {
    const key3 = item[0];
    const value2 = item[1];
    if (key3 === 0) {
      return !Array.isArray(value2);
    }
  }
  return false;
};

const getDecodedCbor = (tx2) => {
  try {
    return !tx2 ? null : decode(toHexBuffer(tx2));
  } catch (e) {
    console.error("getDecodedCbor", e);
  }
  return null;
};

const getDecodedTxBody = (tx2) => tx2.value["0"];

export const isCatalystVotingRegistrationMetadata = (metadata: AuxiliaryData) => {
  const _metadata = metadata == null ? void 0 : metadata.metadata();
  if (_metadata) {
    const keys = _metadata.keys();
    for (let i2 = 0; i2 < keys.len(); i2++) {
      const label2 = keys.get(i2);
      if (label2.to_str() === "61284") {
        label2.free();
        keys.free();
        _metadata.free();
        return true;
      }
      label2.free();
    }
    keys.free();
    _metadata.free();
  }
  return false;
};

export function generateLedgerMetadataFromHash(metadataHash: AuxiliaryDataHash) {
  return {
    type: TxAuxiliaryDataType.ARBITRARY_HASH,
    params: {
      hashHex: metadataHash
    }
  };
}

const getCatalystRegistrationMetadata = (metadata) => {
  const metaList = MetadataList.from_bytes(metadata.to_bytes());
  const generalTxMeta = GeneralTransactionMetadata.from_bytes(metaList.get(0).to_bytes());
  safeFreeCSLObject(metaList);
  return generalTxMeta;
};

export function generateLedgerMetadata(accountData, metadata: AuxiliaryData) {
  if (isCatalystVotingRegistrationMetadata(metadata)) {
    const metadatum = getCatalystRegistrationMetadata(metadata).get(BigNum.from_str("61284"));
    const catalyst_meta = JSON.parse(decode_metadatum_to_json_str(metadatum, MetadataJsonSchema.BasicConversions));
    const votingPublicKey = catalyst_meta["1"];
    const nonce2 = catalyst_meta["4"];
    const rewardAddr = Address.from_hex(catalyst_meta["3"].replace(/^0x/, ""));
    const rewardAddrBech32 = rewardAddr.to_bech32();
    safeFreeCSLObject(rewardAddr);
    const cred = getAddressCredentials(rewardAddrBech32);
    const paymentCred = getOwnedCred([accountData.keys], cred.paymentCred);
    const stakeCred = getOwnedCred([accountData.keys], cred.stakeCred, "stake");
    if (!paymentCred || !stakeCred) {
      throw new Error("Error: generateLedgerMetadata: reward address credentials not found");
    }
    const stakingKeyPath = hdPathToArray(stakeCred.path);
    return {
      type: TxAuxiliaryDataType.CIP36_REGISTRATION,
      params: {
        format: CIP36VoteRegistrationFormat.CIP_15,
        voteKeyHex: votingPublicKey.replace(/^0x/, ""),
        // voteKeyPath: BIP32Path;
        // delegations: Array<CIP36VoteDelegation>;
        stakingPath: stakingKeyPath,
        paymentDestination: {
          type: TxOutputDestinationType.DEVICE_OWNED,
          params: generateLedgerOwnedAddress(accountData, paymentCred, stakeCred)
        },
        nonce: nonce2
        // votingPurpose: bigint_like;
      }
    };
  } else {
    return {
      type: TxAuxiliaryDataType.ARBITRARY_HASH,
      params: {
        hashHex: blake2bHex(Buffer.from(metadata.to_bytes()), void 0, 32)
      }
    };
  }
}

export function generateLedgerMintBundle(mintList2) {
  const assetGroup = [];
  const sortedMintList = [...mintList2].sort((a2, b2) => a2[0].localeCompare(b2[0], "en-US"));
  for (const mint of sortedMintList) {
    const assetList = [];
    const sortedAssetList = Object.entries(mint[1]).sort((a2, b2) => {
      return a2[0].length === b2[0].length ? a2[0].localeCompare(b2[0], "en-US") : a2[0].length - b2[0].length;
    });
    for (const asset of sortedAssetList) {
      assetList.push({
        assetNameHex: asset[0],
        amount: asset[1]
      });
    }
    assetGroup.push({
      policyIdHex: mint[0],
      tokens: assetList
    });
  }
  return assetGroup;
}

export function generateRequiredSigners(keys: any, requiredSigners: Ed25519KeyHashes): RequiredSigner[] {
  const requiredSignerList: RequiredSigner[] = [];
  for (let i = 0; i < requiredSigners.len(); i++) {
    const signerHex = requiredSigners.get(i).to_hex()
    if (signerHex === keys.payment.hash.to_hex()) {
      requiredSignerList.push({
        type: TxRequiredSignerType.PATH,
        path: hdPathToArray(keys.payment.path)
      });
    } else {
      requiredSignerList.push({
        type: TxRequiredSignerType.HASH,
        hashHex: signerHex,
      });
    }
  }
  return requiredSignerList;
}

export const generateLedgerOwnedAddress = (accountData, paymentCred, stakeCred) => {
  const _paymentCred = typeof paymentCred === "string" ? getOwnedCred([accountData.keys], paymentCred) : paymentCred;
  const _stakeCred = typeof stakeCred === "string" ? getOwnedCred([accountData.keys], stakeCred, "stake") : stakeCred;
  if (_paymentCred && _stakeCred) {
    return {
      type: AddressType.BASE_PAYMENT_KEY_STAKE_KEY,
      params: {
        spendingPath: hdPathToArray(_paymentCred.path),
        stakingPath: hdPathToArray(_stakeCred.path)
      }
    };
  } else if (_paymentCred && !stakeCred) {
    return {
      type: AddressType.ENTERPRISE_KEY,
      params: {
        spendingPath: hdPathToArray(_paymentCred.path)
      }
    };
  } else if (_stakeCred && !paymentCred) {
    return {
      type: AddressType.REWARD_KEY,
      params: {
        stakingPath: hdPathToArray(_stakeCred.path)
      }
    };
  }
  throw new Error(`generateLedgerOwnedAddress: couldn't find cred for: paymentCred=${paymentCred}, stakeCred=${stakeCred}`);
}

export const getOwnedCred = (credList, cred, type2?) => {
  if (!cred || !credList) return null;
  let key3;
  for (const creds of credList) {
    switch (type2) {
      case "payment":
        key3 = creds.payment.find((item) => item.cred === cred);
        if (key3) return key3;
        break;
      case "change":
        key3 = creds.change.find((item) => item.cred === cred);
        if (key3) return key3;
        break;
      case "stake":
        key3 = creds.stake.find((item) => item.cred === cred);
        if (key3) return key3;
        break;
      case "script":
        key3 = creds.script.find((item) => item.cred === cred);
        if (key3) return key3;
        break;
      case "drep":
        key3 = creds.drep.find((item) => item.cred === cred);
        if (key3) return key3;
        break;
      case "cc_cold":
        key3 = creds.cc_cold.find((item) => item.cred === cred);
        if (key3) return key3;
        break;
      case "cc_hot":
        key3 = creds.cc_hot.find((item) => item.cred === cred);
        if (key3) return key3;
        break;
      default:
        key3 = creds.payment.find((item) => item.cred === cred);
        if (key3) return key3;
        key3 = creds.change.find((item) => item.cred === cred);
        if (key3) return key3;
        key3 = creds.stake.find((item) => item.cred === cred);
        if (key3) return key3;
        key3 = creds.script.find((item) => item.cred === cred);
        if (key3) return key3;
        key3 = creds.drep.find((item) => item.cred === cred);
        if (key3) return key3;
        key3 = creds.cc_cold.find((item) => item.cred === cred);
        if (key3) return key3;
        key3 = creds.cc_hot.find((item) => item.cred === cred);
        if (key3) return key3;
    }
  }
  return null;
};

const getAddressBytes = (addrHexOrBech32) => {
  const free = [];
  const addr = getCSLAddressOrNull(addrHexOrBech32, free);
  if (addr) {
    const bytes2 = addr.to_bytes();
    freeCSLObjects(free);
    return bytes2;
  }
  return null;
};

const getCredFromCredentials = (cred) => {
  let stakeCred = toHexString(cred.to_bytes());
  if (stakeCred.length > 56) {
    stakeCred = stakeCred.substr(-56);
  }
  safeFreeCSLObject(cred);
  return stakeCred;
};

export const getAddressCredentials = (addrHexOrBech32, cslAddr = null, getBytes = false) => {
  if (addrHexOrBech32) {
    if (_inMemoryCacheAddressCredentials.has(addrHexOrBech32)) {
      const cred = _inMemoryCacheAddressCredentials.get(addrHexOrBech32);
      if (getBytes && !cred.addressBytes) {
        cred.addressBytes = getAddressBytes(addrHexOrBech32);
      }
      return cred;
    }
  }
  if (!addrHexOrBech32 && !cslAddr) {
    return { paymentCred: null, stakeCred: null, stakePointer: null, addressBytes: null, isByron: false };
  }
  if (addrHexOrBech32 && !cslAddr) {
    cslAddr = getCSLAddressOrNull(addrHexOrBech32);
  }
  if (!cslAddr) {
    return { paymentCred: null, stakeCred: null, stakePointer: null, addressBytes: null, isByron: false };
  }
  let paymentCred = null;
  let stakeCred = null;
  let addressBytes = null;
  let stakePointer = null;
  let isByron = false;
  const baseAddr = BaseAddress.from_address(cslAddr);
  if (baseAddr) {
    paymentCred = getCredFromCredentials(baseAddr.payment_cred());
    stakeCred = getCredFromCredentials(baseAddr.stake_cred());
    if (getBytes) {
      cslAddr = baseAddr.to_address();
      addressBytes = cslAddr.to_bytes();
    }
    safeFreeCSLObject(baseAddr);
  } else {
    const enterpriseAddr = EnterpriseAddress.from_address(cslAddr);
    if (enterpriseAddr) {
      paymentCred = getCredFromCredentials(enterpriseAddr.payment_cred());
      if (getBytes) {
        cslAddr = enterpriseAddr.to_address();
        addressBytes = cslAddr.to_bytes();
      }
      safeFreeCSLObject(enterpriseAddr);
    } else {
      const byronAddr = ByronAddress.from_address(cslAddr);
      if (byronAddr) {
        isByron = true;
        if (getBytes) {
          cslAddr = byronAddr.to_address();
          addressBytes = cslAddr.to_bytes();
        }
        safeFreeCSLObject(byronAddr);
      } else {
        const pointerAddr = PointerAddress.from_address(cslAddr);
        if (pointerAddr) {
          paymentCred = getCredFromCredentials(pointerAddr.payment_cred());
          const pointer = pointerAddr.stake_pointer();
          stakePointer = {
            slot: pointer.slot(),
            txIndex: pointer.tx_index(),
            certIndex: pointer.cert_index()
          };
          if (getBytes) {
            cslAddr = pointerAddr.to_address();
            addressBytes = cslAddr.to_bytes();
          }
          safeFreeCSLObject(pointerAddr);
        } else {
          const stakeAddr = RewardAddress.from_address(cslAddr);
          if (stakeAddr) {
            stakeCred = getCredFromCredentials(stakeAddr.payment_cred());
            if (getBytes) {
              cslAddr = stakeAddr.to_address();
              addressBytes = cslAddr.to_bytes();
            }
            safeFreeCSLObject(stakeAddr);
          }
        }
      }
    }
  }
  safeFreeCSLObject(cslAddr);
  const res = { paymentCred, stakeCred, stakePointer, addressBytes, isByron };
  if (addrHexOrBech32) {
    cacheAddressCredentials(addrHexOrBech32, res);
  }
  return res;
};

const getCSLAddressOrNull = (addr, free?) => {
  const cslAddress = parseAddress$1(addr);
  if (cslAddress) {
    free == null ? void 0 : free.push(cslAddress);
  }
  return cslAddress;
};

const parseAddress$1 = (addr) => {
  try {
    return Address.from_bech32(addr);
  } catch (e) {
    //
  }
  try {
    return Address.from_bytes(toHexBuffer(addr));
  } catch (e) {
    //
  }
  if (ByronAddress.is_valid(addr)) {
    return ByronAddress.from_base58(addr).to_address();
  }
  return null;
};

const getPlutusDataJSONFromCSL = (cslPlutusData) => {
  if (!cslPlutusData) {
    return null;
  }
  let _json;
  try {
    _json = cslPlutusData.to_json(PlutusDatumSchema.DetailedSchema);
  } catch (err2) {
    //
  }
  if (!_json) {
    try {
      _json = cslPlutusData.to_json(PlutusDatumSchema.BasicConversions);
    } catch (err2) {
      //
    }
  }
  if (_json) {
    _json = _json ? JSON.parse(_json) : null;
  }
  return _json ?? null;
};

export const isScriptStakeAddress = (addrBech32) => {
  let type2 = null;
  try {
    type2 = getAddressType(addrBech32);
  } catch (error3) {
    console.warn("Could not determine address type.", error3);
    return false;
  }
  switch (type2) {
    case 2:
    case 3:
    case 15:
      return true;
  }
  return false;
};

function getAddressType(addrBech32) {
  const addrBytes = getAddressBytes(addrBech32);
  if (!addrBytes) {
    throw new Error('Could not parse address "' + addrBech32 + '".');
  }
  return (addrBytes[0] & 240) >> 4;
}

export const getRewardAddressFromCred = (stakeCred, networkId2) => {
  const network2 = getNetworkId$1(networkId2);
  const cslStakeCred = getCSLCredential(stakeCred);
  const cslRewardAddr = RewardAddress.new(network2, cslStakeCred);
  const cslAddr = cslRewardAddr.to_address();
  const addr = cslAddr.to_bech32(void 0);
  safeFreeCSLObject(cslAddr);
  safeFreeCSLObject(cslRewardAddr);
  safeFreeCSLObject(cslStakeCred);
  return addr;
};

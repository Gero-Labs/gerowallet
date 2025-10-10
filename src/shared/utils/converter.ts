import {
  Address,
  AssetName,
  Assets,
  AuxiliaryData,
  BaseAddress,
  BigNum,
  Bip32PublicKey,
  ByronAddress,
  Ed25519KeyHash,
  Ed25519Signature,
  EnterpriseAddress, hash_plutus_data, make_vkey_witness,
  MultiAsset,
  NativeScript,
  NativeScripts,
  PlutusData,
  PlutusDatumSchema,
  PointerAddress, PrivateKey,
  PublicKey,
  RewardAddress,
  ScriptAll,
  ScriptAny,
  ScriptHash, ScriptNOfK, ScriptPubkey, TransactionHash,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  TransactionWitnessSet,
  Value,
  Vkey,
  Vkeywitness,
  Vkeywitnesses,
} from '@emurgo/cardano-serialization-lib-browser';
import {
  AlgorithmId,
  BigNum as BigNum2,
  Int as Int2,
  CBORValue,
  COSESign1Builder,
  Headers,
  HeaderMap,
  Label,
  ProtectedHeaderMap, KeyType, COSEKey, Int, CurveType,
} from '@emurgo/cardano-message-signing-browser';
import { Buffer } from 'buffer';
import { Bip32PrivateKey, Ed25519PublicKeyHex, Ed25519PrivateKey } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { Cardano, Serialization } from '@cardano-sdk/core';

const _inMemoryCacheAddressCredentials = new Map();
const cacheAddressCredentials = (addrHexOrBech32, addressCredentials) => {
  _inMemoryCacheAddressCredentials.set(addrHexOrBech32, addressCredentials);
  return addressCredentials;
};

export function toUTxO(utxo): TransactionUnspentOutput {
  return TransactionUnspentOutput.new(
    TransactionInput.new(TransactionHash.from_hex(utxo.tx_hash), utxo.tx_index),
    TransactionOutput.new(Address.from_bech32(utxo.payment_addr.bech32), toValue(utxo.asset_list, utxo.value))
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

export function stringToHex(input: string) {
  let hexString = '';
  for (let i = 0; i < input.length; i++) {
    hexString += input.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hexString;
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
export const CoseLabel = {
  address: Label.new_text('address'),
  crv: Label.new_int(Int.new_i32(-1)),
  x: Label.new_int(Int.new_i32(-2))
};

const createSigStructureHeaders = (addressBytes: Uint8Array) => {
  const protectedHeaders = HeaderMap.new();
  protectedHeaders.set_key_id(addressBytes);
  protectedHeaders.set_header(CoseLabel.address, CBORValue.new_bytes(addressBytes));
  protectedHeaders.set_algorithm_id(Label.from_algorithm_id(AlgorithmId.EdDSA));
  return protectedHeaders;
};

export const createSignDataBuilder = (addressBytes: Uint8Array, payload: string) => {
  return COSESign1Builder.new(
    Headers.new(ProtectedHeaderMap.new(createSigStructureHeaders(addressBytes)), HeaderMap.new()),
    Buffer.from(payload, 'hex'),
    false
  );
};

export const createCoseKey = (addressBytes: Uint8Array, publicKey: Ed25519PublicKeyHex) => {
  const coseKey = COSEKey.new(Label.from_key_type(KeyType.OKP));
  coseKey.set_key_id(addressBytes);
  coseKey.set_algorithm_id(Label.from_algorithm_id(AlgorithmId.EdDSA));
  coseKey.set_header(CoseLabel.crv, CBORValue.from_label(Label.from_curve_type(CurveType.Ed25519)));
  coseKey.set_header(CoseLabel.x, CBORValue.new_bytes(Buffer.from(publicKey, 'hex')));
  return coseKey;
};

export const buildAndSignData = (builder: COSESign1Builder, signingData: Uint8Array, accountKey: Ed25519PrivateKey | undefined) => {
  const signedData = accountKey ? accountKey.sign(HexBlob.fromBytes(signingData)).bytes() : signingData;
  const coseSign1 = builder.build(signedData);
  const signatureHex = toHexString(coseSign1.to_bytes());
  safeFreeCSLObject(builder);
  safeFreeCSLObject(coseSign1);
  return signatureHex;
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

export const hasConwaySetTag = (tx2: Cardano.Tx) => {
  const tx: Serialization.Transaction = Serialization.Transaction.fromCore(tx2);
  return tx.body().hasTaggedSets()
};

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

export function parseAddress(address: string): Address {
  try {
    return Address.from_bech32(address)
  } catch (error) {
    //
  }
  try {
    return ByronAddress.from_base58(address).to_address();
  } catch (error) {
    //
  }
  return undefined;
}

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

export const isScriptStakeAddress = (addrBech32: string): boolean => {
  const address: Cardano.Address = Cardano.Address.fromString(addrBech32);
  switch(address.getType()) {
    case Cardano.AddressType.BasePaymentKeyStakeScript:
    case Cardano.AddressType.BasePaymentScriptStakeScript:
    case Cardano.AddressType.RewardScript:
      return true;
    default:
      return false;
  }
};

export const assembleWitnesses = (accountData2, signedTxData) => {
  const witnesses = TransactionWitnessSet.new();
  const vkeyWitnesses = witnesses.vkeys() ?? Vkeywitnesses.new();
  for (const witness of signedTxData.witnesses) {
    const pubKey = createPubKey(accountData2.account.pub, witness.path.slice(3));
    vkeyWitnesses.add(getVkeyWitness(pubKey, witness.witnessSignatureHex));
  }
  witnesses.set_vkeys(vkeyWitnesses);
  const witnessSetHex = witnesses.to_hex();
  safeFreeCSLObject(vkeyWitnesses);
  safeFreeCSLObject(witnesses);
  return witnessSetHex;
};

const createPubKey = (accPubBech32, path3) => {
  const cslPubKey = derivePubKey(accPubBech32, path3);
  const pubKeyBech32 = cslPubKey.to_bech32();
  safeFreeCSLObject(cslPubKey);
  return pubKeyBech32;
};

const getCSLBip32PublicKey = (bech322, free?) => {
  const cslBip32PublicKey = Bip32PublicKey.from_bech32(bech322);
  free == null ? void 0 : free.push(cslBip32PublicKey);
  return cslBip32PublicKey;
};

const derivePubKey = (pubBech32, path3) => cslDerivePubKey(getCSLBip32PublicKey(pubBech32), path3);

const cslDerivePubKey = (key3, path3) => {
  const _keyInit = key3;
  let _key = key3;
  for (let p2 = 0; p2 < path3.length; p2++) {
    _key = _key.derive(path3[p2]);
    if (key3 !== _keyInit) {
      safeFreeCSLObject(key3);
    }
    key3 = _key;
  }
  if (key3 !== _keyInit) {
    safeFreeCSLObject(_keyInit);
  }
  return _key;
};

const getVkeyWitness = (pub2, witnessSignatureHex: string, raw2 = false, hex2 = false) => {
  let pubRaw;
  let pubBip32;
  if (raw2) {
    pubRaw = hex2 ? PublicKey.from_hex(pub2) : PublicKey.from_bech32(pub2);
  } else {
    pubBip32 = hex2 ? Bip32PublicKey.from_hex(pub2) : Bip32PublicKey.from_bech32(pub2);
    pubRaw = pubBip32.to_raw_key();
  }
  const vkey = Vkey.new(pubRaw);
  const signature = Ed25519Signature.from_hex(witnessSignatureHex);
  const vkeyWitness = Vkeywitness.new(vkey, signature);
  safeFreeCSLObject(pubRaw);
  safeFreeCSLObject(pubBip32);
  safeFreeCSLObject(vkey);
  safeFreeCSLObject(signature);
  return vkeyWitness;
};

export const addVkeys = (cslTxHash, cslWitnessSet, credList, prvRootKeyBech32: Bip32PrivateKey): TransactionWitnessSet => {
  const cslVkeys = cslWitnessSet.vkeys() ?? Vkeywitnesses.new();
  const cslVkeysOwned = Vkeywitnesses.new();
  credList.forEach(cred => {
    const hdArray = hdPathToArray(cred.path)
    const prvKeyRaw = prvRootKeyBech32.derive([hdArray[0], hdArray[1], hdArray[2], hdArray[3], hdArray[4]]).toRawKey()
    const vkeyWitness = make_vkey_witness(cslTxHash, PrivateKey.from_hex(prvKeyRaw.hex()));
    const vkeyWitnessSig = vkeyWitness.signature();
    const vkeyWitnessSig32 = vkeyWitnessSig.to_bech32();
    let keyIncluded = false;
    for (let i2 = 0; i2 < cslVkeys.len(); i2++) {
      const _wit = cslVkeys.get(i2);
      const _witSig = _wit.signature();
      keyIncluded = vkeyWitnessSig32 === _witSig.to_bech32();
      safeFreeCSLObject(_witSig);
      safeFreeCSLObject(_wit);
      if (keyIncluded) {
        break;
      }
    }
    if (!keyIncluded) {
      cslVkeys.add(vkeyWitness);
      cslVkeysOwned.add(vkeyWitness);
    }
    safeFreeCSLObject(vkeyWitnessSig);
    safeFreeCSLObject(vkeyWitness);
    safeFreeCSLObject(prvKeyRaw);
  })
  cslWitnessSet.set_vkeys(cslVkeys);
  const cslWitnessSetOwned = TransactionWitnessSet.new();
  cslWitnessSetOwned.set_vkeys(cslVkeysOwned);
  safeFreeCSLObject(cslVkeys);
  return cslWitnessSetOwned;
};

export const jsonToNativeScript = (json) => {
  if (json.type === "sig") {
    // Single signature case
    const keyHashHex = json.keyHash;
    const keyHashBytes = toHexArray(keyHashHex);// Buffer.from(keyHashHex, 'hex');
    const ed25519KeyHash = Ed25519KeyHash.from_bytes(keyHashBytes);
    return NativeScript.new_script_pubkey(ScriptPubkey.new(ed25519KeyHash));
  } else if (json.type === "all") {
    // ALL case - all scripts must be satisfied
    const scripts = NativeScripts.new();
    for (const scriptJson of json.scripts) {
      scripts.add(jsonToNativeScript(scriptJson));
    }
    return NativeScript.new_script_all(ScriptAll.new(scripts));
  } else if (json.type === "any") {
    // ANY case - any one script must be satisfied
    const scripts = NativeScripts.new();
    for (const scriptJson of json.scripts) {
      scripts.add(jsonToNativeScript(scriptJson));
    }
    return NativeScript.new_script_any(ScriptAny.new(scripts));
  } else if (json.type === "atLeast") {
    // N-of-K case - at least N scripts must be satisfied
    const scripts = NativeScripts.new();
    for (const scriptJson of json.scripts) {
      scripts.add(jsonToNativeScript(scriptJson));
    }
    return NativeScript.new_script_n_of_k(ScriptNOfK.new(json.required, scripts));
  } else {
    throw new Error("Unknown script type: " + json.type);
  }
};

/**
 * Creates legacy UTXO structure from Cardano JS SDK transaction format
 * This is needed for TransactionDetails component compatibility and transaction calculations
 * @param tx - Transaction with Cardano JS SDK body structure
 * @param utxos - Current wallet UTXOs for input resolution
 * @returns Legacy UTXO structure with inputs and outputs
 */
export function createUtxoStructure(tx: any, utxos: Cardano.Utxo[]): any {
  const inputs: any[] = [];
  const outputs: any[] = [];

  // Convert inputs from Cardano JS SDK format to legacy format
  // For inputs, we need to find the actual UTXO values from our UTXO set
  if (tx.body?.inputs) {
    tx.body.inputs.forEach((input: any) => {
      // Try to find the corresponding UTXO from provided UTXOs
      const utxo = utxos.find((utxo: any) =>
        utxo[0].txId === input.txId && utxo[0].index === input.index
      );

      let address = '';
      let amount: any[] = [];

      if (utxo) {
        // Use the actual UTXO data
        address = utxo[1].address;
        amount = [{
          unit: 'lovelace',
          quantity: Number(utxo[1].value.coins)
        }];

        if (utxo[1].value.assets && utxo[1].value.assets.size > 0) {
          utxo[1].value.assets.forEach((quantity: bigint, assetId: string) => {
            amount.push({
              unit: assetId,
              quantity: Number(quantity)
            });
          });
        }
      }

      inputs.push({
        tx_hash: input.txId,
        output_index: input.index,
        address: address,
        amount: amount
      });
    });
  }

  // Convert outputs from Cardano JS SDK format to legacy format
  if (tx.body?.outputs) {
    tx.body.outputs.forEach((output: any, index: number) => {
      const amount: any[] = [{
        unit: 'lovelace',
        quantity: Number(output.value.coins)
      }];

      // Convert assets map to array format
      if (output.value.assets && output.value.assets.size > 0) {
        output.value.assets.forEach((quantity: bigint, assetId: string) => {
          amount.push({
            unit: assetId,
            quantity: Number(quantity)
          });
        });
      }

      outputs.push({
        output_index: index,
        address: output.address,
        amount: amount
      });
    });
  }

  return {
    inputs,
    outputs
  };
}

/**
 * Converts transactions to database schema format
 * Handles various transaction formats including Cardano JS SDK and legacy formats
 * @param txs - Array of transactions to convert
 * @param utxos - Current wallet UTXOs for input resolution
 * @returns Array of converted transactions ready for database storage
 */
export function convertTransactionsForStorage(txs: any[], utxos: Cardano.Utxo[]): any[] {
  return txs.map(tx => {
    // Check if this is already a properly formatted transaction with utxo data
    if (tx.id && tx.utxo) {
      return tx;
    }

    // If transaction has id and Cardano JS SDK structure but no utxo, create utxo structure
    if (tx.id && tx.body && !tx.utxo) {
      return {
        ...tx,
        utxo: createUtxoStructure(tx, utxos)
      };
    }

    // Check if this is a transaction from sync with deserialized body
    if (tx.body && tx.cbor) {
      // Transaction is already deserialized from sync process
      // Just need to ensure it has the id field
      const txId = tx.tx_hash || tx.id;
      return {
        ...tx,
        id: txId
      };
    }

    // Check if this is a raw transaction with CBOR that needs full conversion
    if (tx.cbor && !tx.body) {
      try {
        // Use the already imported Serialization from the top of the file
        // Deserialize the transaction
        const txDeserialized = Serialization.TxCBOR.deserialize(Serialization.TxCBOR(tx.cbor));
        const txId = tx.tx_hash || Serialization.Transaction.fromCore(txDeserialized).getId();

        // Return the transaction in the expected database format
        return {
          id: txId,
          tx_hash: txId,
          block_hash: tx.block_hash || '',
          block_height: tx.block_height || 0,
          absolute_slot: tx.absolute_slot || 0,
          tx_timestamp: tx.tx_timestamp || Math.floor(Date.now() / 1000),
          tx_size: tx.tx_size || 0,
          epoch_no: tx.epoch_no || 0,
          cbor: tx.cbor,
          body: txDeserialized.body,
          witness: txDeserialized.witness,
          auxiliaryData: txDeserialized.auxiliaryData,
          isValid: txDeserialized.isValid !== false,
          pending: false,
          // Include UTXO data if available from sync
          utxo: tx.utxo
        };
      } catch (e) {
        console.error('Error deserializing transaction CBOR:', e);
        // Fallback: ensure it at least has an id
        const fallbackId = tx.tx_hash || tx.hash || 'fallback_' + Date.now();
        return { ...tx, id: fallbackId };
      }
    }

    // Legacy format - just ensure it has an id
    const txId = tx.tx_hash || tx.hash || 'unknown_' + Date.now();
    return { ...tx, id: txId };
  });
}

import {
  AlgorithmId,
  CBORValue,
  COSESign1Builder,
  Headers,
  HeaderMap,
  Label,
  ProtectedHeaderMap,
  KeyType,
  COSEKey,
  Int,
  CurveType,
} from '@emurgo/cardano-message-signing-browser';
import { Buffer } from 'buffer';
import { Ed25519PublicKeyHex, Ed25519PrivateKey } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { util } from '@cardano-sdk/core';

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

export function buildSignatureAndCoseKey(addressBytes: Uint8Array<ArrayBufferLike>, payload: string, accountKey: Ed25519PrivateKey) {
  const builder: COSESign1Builder = createSignDataBuilder(addressBytes, payload);
  const toSign = builder.make_data_to_sign().to_bytes();
  const coseKey = createCoseKey(addressBytes, accountKey.toPublic().hex());
  return {
    signature: buildAndSignData(builder, toSign, accountKey),
    key: util.bytesToHex(coseKey.to_bytes())
  };
}

export const buildAndSignData = (builder: COSESign1Builder, signingData: Uint8Array, accountKey: Ed25519PrivateKey | undefined) => {
  const signedData = accountKey ? accountKey.sign(HexBlob.fromBytes(signingData)).bytes() : signingData;
  const coseSign1 = builder.build(signedData);
  const signatureHex = toHexString(coseSign1.to_bytes());
  safeFreeCSLObject(builder);
  safeFreeCSLObject(coseSign1);
  return signatureHex;
};

export const safeFreeCSLObject = (obj2) => {
  if (obj2 && obj2.free) {
    if (obj2.__wbg_ptr > 0) {
      obj2.free();
    }
  }
};

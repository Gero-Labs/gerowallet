import { Serialization } from '@cardano-sdk/core';
import { blake2b } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { decodeAddress, type AddressView, type NetworkId } from './address';
import { readArray, readBytes, readDistinctMap, readItem, readUint, stateOf, toHex, untag, type Bytes } from './cbor';
import { FieldRefusal } from './refusals';
import { decodeValue, type ValueView } from './value';

/**
 * Transaction outputs, in both encodings the ledger reads:
 * - legacy `[address, value]` and `[address, value, datum_hash]`;
 * - post-Alonzo `{0: address, 1: value, ?2: datum_option, ?3: script_ref}`.
 *
 * Every variant is named: another array length, another map key (`output_field_unknown`), a datum
 * option or script language other than those listed (`variant_unknown`) refuses the output. The
 * datum and the reference script are shown by presence and hash, computed here from the bytes
 * the output carries; their contents are not interpreted.
 */

export type DatumView =
  /** A datum hash: the datum itself is not in the output. */
  | { kind: 'hash'; hash: string }
  /** An inline datum: its blake2b-256 hash and its CBOR exactly as the output carries it. */
  | { kind: 'inline'; hash: string; cborHex: string };

export type ScriptLanguage = 'native' | 'plutus_v1' | 'plutus_v2' | 'plutus_v3';

export interface ScriptRefView {
  language: ScriptLanguage;
  /** blake2b-224 over the language tag and the script, as the ledger hashes it. */
  hash: string;
}

export interface OutputView {
  address: AddressView;
  value: ValueView;
  datum: DatumView | null;
  referenceScript: ScriptRefView | null;
}

const LANGUAGES: Record<number, ScriptLanguage> = { 0: 'native', 1: 'plutus_v1', 2: 'plutus_v2', 3: 'plutus_v3' };

const hashHex = (bytes: Bytes, length: 28 | 32): string => blake2b.hash(HexBlob.fromBytes(bytes), length).toString();

function concat(prefix: number, bytes: Bytes): Bytes {
  const out = new Uint8Array(bytes.length + 1);
  out[0] = prefix;
  out.set(bytes, 1);
  return out;
}

/** `#6.24(bytes .cbor T)`: the embedded item's bytes, which must be exactly one data item. */
function embeddedCbor(item: Bytes, path: string): Bytes {
  const inner = untag(item, 24, path);
  if (!inner) throw new FieldRefusal('field_malformed', path, 'expected_tag_24');
  const bytes = readBytes(inner, path);
  readItem(bytes, path);
  return bytes;
}

function decodeDatumOption(item: Bytes, path: string): DatumView {
  const parts = readArray(item, path);
  if (parts.length !== 2) throw new FieldRefusal('field_malformed', path, 'datum_option_length');
  const tag = readUint(parts[0], path);
  if (tag === 0n) return { kind: 'hash', hash: toHex(readBytes(parts[1], path, 32)) };
  if (tag === 1n) {
    const datum = embeddedCbor(parts[1], path);
    return { kind: 'inline', hash: hashHex(datum, 32), cborHex: toHex(datum) };
  }
  throw new FieldRefusal('variant_unknown', path, `datum_option_${tag}`);
}

/** A script `[0, native_script] / [1..3, bytes]`, hashed over the bytes as they are. */
export function decodeScript(scriptBytes: Bytes, path: string): ScriptRefView {
  const parts = readArray(scriptBytes, path);
  if (parts.length !== 2) throw new FieldRefusal('field_malformed', path, 'script_length');
  const tag = Number(readUint(parts[0], path));
  const language = LANGUAGES[tag];
  if (!language) throw new FieldRefusal('variant_unknown', path, `script_${tag}`);
  if (language === 'native') {
    try {
      Serialization.NativeScript.fromCbor(HexBlob.fromBytes(parts[1]));
    } catch {
      throw new FieldRefusal('field_malformed', path, 'native_script');
    }
    return { language, hash: hashHex(concat(0, parts[1]), 28) };
  }
  return { language, hash: hashHex(concat(tag, readBytes(parts[1], path)), 28) };
}

function decodeScriptRef(item: Bytes, path: string): ScriptRefView {
  return decodeScript(embeddedCbor(item, path), path);
}

/** One output, on network `networkId`. */
export function decodeOutput(item: Bytes, path: string, networkId: NetworkId): OutputView {
  if (stateOf(item) === Serialization.CborReaderState.StartArray) {
    const parts = readArray(item, path);
    if (parts.length !== 2 && parts.length !== 3) throw new FieldRefusal('variant_unknown', path, `legacy_output_length_${parts.length}`);
    return {
      address: decodeAddress(parts[0], `${path}.address`, networkId),
      value: decodeValue(parts[1], `${path}.value`),
      datum: parts.length === 3 ? { kind: 'hash', hash: toHex(readBytes(parts[2], `${path}.datum`, 32)) } : null,
      referenceScript: null,
    };
  }
  if (stateOf(item) !== Serialization.CborReaderState.StartMap) throw new FieldRefusal('field_malformed', path, 'expected_output');
  const fields = new Map<number, Bytes>();
  for (const [key, value] of readDistinctMap(item, path, (k) => readUint(k, path))) {
    if (key > 3n) throw new FieldRefusal('output_field_unknown', path, `key_${key}`);
    fields.set(Number(key), value);
  }
  const address = fields.get(0);
  const value = fields.get(1);
  if (!address || !value) throw new FieldRefusal('field_malformed', path, 'output_missing_address_or_value');
  const datum = fields.get(2);
  const script = fields.get(3);
  return {
    address: decodeAddress(address, `${path}.address`, networkId),
    value: decodeValue(value, `${path}.value`),
    datum: datum ? decodeDatumOption(datum, `${path}.datum`) : null,
    referenceScript: script ? decodeScriptRef(script, `${path}.script_ref`) : null,
  };
}

/** The outputs field (body key 1): an array of outputs. */
export function decodeOutputs(item: Bytes, path: string, networkId: NetworkId): OutputView[] {
  return readArray(item, path).map((output, i) => decodeOutput(output, `${path}[${i}]`, networkId));
}

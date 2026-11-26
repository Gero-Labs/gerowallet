import { Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { FieldRefusal } from './refusals';

/**
 * Strict readers over the SDK's CBOR reader. Each takes one encoded data item and reads it
 * whole: trailing bytes, a wrong major type or a wrong length is a {@link FieldRefusal}
 * (`field_malformed`) at the path given. Maps come back as entries in wire order, so a caller
 * sees duplicate keys instead of a decoder silently keeping one of them.
 */

const State = Serialization.CborReaderState;

export type Bytes = Uint8Array;

export const toHex = (bytes: Bytes): string => HexBlob.fromBytes(bytes).toString();

/** Bytes of a hex string; throws for anything that is not hex. */
export function fromHex(hex: string): Bytes {
  const text = HexBlob(hex).toString();
  if (text.length % 2 !== 0) throw new Error('Odd-length hex');
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function reader(item: Bytes): Serialization.CborReader {
  return new Serialization.CborReader(HexBlob.fromBytes(item));
}

function malformed(path: string, detail: string): never {
  throw new FieldRefusal('field_malformed', path, detail);
}

function finish(r: Serialization.CborReader, path: string): void {
  if (r.peekState() !== State.Finished) malformed(path, 'trailing_bytes');
}

export function stateOf(item: Bytes): Serialization.CborReaderState {
  return reader(item).peekState();
}

/** An unsigned integer. */
export function readUint(item: Bytes, path: string): bigint {
  const r = reader(item);
  if (r.peekState() !== State.UnsignedInteger) malformed(path, 'expected_uint');
  const value = r.readUInt();
  finish(r, path);
  return value;
}

/** A byte string (definite or chunked), optionally of an exact length. */
export function readBytes(item: Bytes, path: string, length?: number): Bytes {
  const r = reader(item);
  const state = r.peekState();
  if (state !== State.ByteString && state !== State.StartIndefiniteLengthByteString) malformed(path, 'expected_bytes');
  const value = r.readByteString();
  finish(r, path);
  if (length !== undefined && value.length !== length) malformed(path, `expected_${length}_bytes`);
  return value;
}

export function readBoolean(item: Bytes, path: string): boolean {
  const r = reader(item);
  if (r.peekState() !== State.Boolean) malformed(path, 'expected_boolean');
  const value = r.readBoolean();
  finish(r, path);
  return value;
}

export function isNull(item: Bytes): boolean {
  return stateOf(item) === State.Null;
}

/** The items of an array (definite or indefinite), each still encoded. */
export function readArray(item: Bytes, path: string): Bytes[] {
  const r = reader(item);
  if (r.peekState() !== State.StartArray) malformed(path, 'expected_array');
  r.readStartArray();
  const items: Bytes[] = [];
  while (r.peekState() !== State.EndArray) items.push(r.readEncodedValue());
  r.readEndArray();
  finish(r, path);
  return items;
}

/** The entries of a map (definite or indefinite) in wire order, keys and values still encoded. */
export function readMap(item: Bytes, path: string): Array<[Bytes, Bytes]> {
  const r = reader(item);
  if (r.peekState() !== State.StartMap) malformed(path, 'expected_map');
  r.readStartMap();
  const entries: Array<[Bytes, Bytes]> = [];
  while (r.peekState() !== State.EndMap) entries.push([r.readEncodedValue(), r.readEncodedValue()]);
  r.readEndMap();
  finish(r, path);
  return entries;
}

/** Tag `tag` around an item, if the item is so tagged: the inner item, else null. */
export function untag(item: Bytes, tag: number, path: string): Bytes | null {
  const r = reader(item);
  if (r.peekState() !== State.Tag) return null;
  if (Number(r.readTag()) !== tag) malformed(path, 'unexpected_tag');
  const inner = r.readEncodedValue();
  finish(r, path);
  return inner;
}

/**
 * A set: an array, optionally under tag 258. A repeated element is refused: the ledger reads a
 * set, so a list with a repeat would describe something other than what is counted.
 */
export function readSet(item: Bytes, path: string): Bytes[] {
  const items = readArray(untag(item, 258, path) ?? item, path);
  const seen = new Set<string>();
  for (const element of items) {
    const key = toHex(element);
    if (seen.has(key)) malformed(path, 'duplicate_element');
    seen.add(key);
  }
  return items;
}

/** A map whose keys must be distinct by their decoded meaning (`keyOf`). */
export function readDistinctMap<K>(item: Bytes, path: string, keyOf: (key: Bytes, index: number) => K): Array<[K, Bytes]> {
  const out: Array<[K, Bytes]> = [];
  const seen = new Set<string>();
  readMap(item, path).forEach(([key, value], index) => {
    const decoded = keyOf(key, index);
    const id = typeof decoded === 'bigint' ? decoded.toString() : decoded instanceof Uint8Array ? toHex(decoded) : String(decoded);
    if (seen.has(id)) malformed(path, 'duplicate_key');
    seen.add(id);
    out.push([decoded, value]);
  });
  return out;
}

/** One whole data item: the bytes must hold exactly one, well formed. */
export function readItem(item: Bytes, path: string): Bytes {
  const r = reader(item);
  const value = r.readEncodedValue();
  finish(r, path);
  return value;
}

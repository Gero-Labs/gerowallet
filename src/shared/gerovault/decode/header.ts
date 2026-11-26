import { decodeHash28 } from './address';
import { readSet, readUint, type Bytes } from './cbor';
import type { DecodeContext } from './context';
import { FieldRefusal } from './refusals';

/**
 * The scalar fields: fee (key 2), validity interval (keys 3 and 8, in slots), required signers
 * (key 14) and network id (key 15). Slots stay slots: turning one into a time needs the era
 * history, which is the screen's to supply.
 */

export interface ValidityView {
  /** First slot the transaction is valid in (body key 8), or null: no lower bound. */
  invalidBefore: bigint | null;
  /** First slot it is no longer valid in (body key 3, the TTL), or null: no upper bound. */
  invalidHereafter: bigint | null;
}

export function decodeFee(item: Bytes, path: string): bigint {
  return readUint(item, path);
}

export function decodeSlot(item: Bytes, path: string): bigint {
  return readUint(item, path);
}

/** Required signers: a set of payment key hashes (lower-case hex). */
export function decodeRequiredSigners(item: Bytes, path: string): string[] {
  const signers = readSet(item, path).map((element, i) => decodeHash28(element, `${path}[${i}]`));
  if (new Set(signers).size !== signers.length) throw new FieldRefusal('field_malformed', path, 'duplicate_element');
  return signers;
}

/** Network id 0 (testnets) or 1 (mainnet), which must be the expected one. */
export function decodeNetworkId(item: Bytes, path: string, ctx: DecodeContext): 0 | 1 {
  const id = readUint(item, path);
  if (id !== 0n && id !== 1n) throw new FieldRefusal('field_malformed', path, 'network_id');
  if (Number(id) !== ctx.networkId) throw new FieldRefusal('network_mismatch', path, `network_${id}`);
  return Number(id) as 0 | 1;
}

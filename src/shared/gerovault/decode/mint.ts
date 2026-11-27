import { Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { readBytes, readDistinctMap, toHex, type Bytes } from './cbor';
import { FieldRefusal } from './refusals';

/**
 * Minting and burning (body key 9): `{ policy_id => { asset_name => nonzero_int64 } }`.
 *
 * The decoder reads this field only for the policies its caller names (`plutusMintPolicies`); any
 * other policy refuses by name (`mint_unsupported`). A repeated policy or asset name, a zero
 * quantity, an empty policy map or an asset name longer than 32 bytes is `field_malformed`, as in
 * a value.
 */

export interface MintAmount {
  /** Minting policy (script hash), 56 lower-case hex characters. */
  policyId: string;
  /** Asset name bytes, lower-case hex. */
  assetNameHex: string;
  /** Positive: minted. Negative: burned. Never zero. */
  quantity: bigint;
}

const MAX_ASSET_NAME_BYTES = 32;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** A signed integer of at most 64 bits. */
function readInt(item: Bytes, path: string): bigint {
  const r = new Serialization.CborReader(HexBlob.fromBytes(item));
  const state = r.peekState();
  if (state !== Serialization.CborReaderState.UnsignedInteger && state !== Serialization.CborReaderState.NegativeInteger) {
    throw new FieldRefusal('field_malformed', path, 'expected_int');
  }
  const value = r.readInt();
  if (r.peekState() !== Serialization.CborReaderState.Finished) throw new FieldRefusal('field_malformed', path, 'trailing_bytes');
  if (value < INT64_MIN || value > INT64_MAX) throw new FieldRefusal('field_malformed', path, 'int64_range');
  return value;
}

export function decodeMint(item: Bytes, path: string, allowedPolicies: readonly string[]): MintAmount[] {
  const amounts: MintAmount[] = [];
  const policies = readDistinctMap(item, path, (key) => readBytes(key, path, 28));
  if (policies.length === 0) throw new FieldRefusal('field_malformed', path, 'empty');
  for (const [policy, assets] of policies) {
    const policyId = toHex(policy);
    if (!allowedPolicies.includes(policyId)) throw new FieldRefusal('mint_unsupported', path, policyId);
    const names = readDistinctMap(assets, path, (key) => {
      const name = readBytes(key, path);
      if (name.length > MAX_ASSET_NAME_BYTES) throw new FieldRefusal('field_malformed', path, 'asset_name_length');
      return name;
    });
    if (names.length === 0) throw new FieldRefusal('field_malformed', path, 'empty_policy');
    for (const [name, quantityItem] of names) {
      const quantity = readInt(quantityItem, path);
      if (quantity === 0n) throw new FieldRefusal('field_malformed', path, 'zero_quantity');
      amounts.push({ policyId, assetNameHex: toHex(name), quantity });
    }
  }
  return amounts;
}

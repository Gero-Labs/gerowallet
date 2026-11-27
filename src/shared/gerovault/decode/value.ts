import { readArray, readBytes, readDistinctMap, readUint, stateOf, toHex, type Bytes } from './cbor';
import { FieldRefusal } from './refusals';
import { Serialization } from '@cardano-sdk/core';

/**
 * An output value `coin / [coin, multiasset<positive_coin>]`, every token listed. A repeated
 * policy or asset name, a zero quantity, an empty policy map or an asset name longer than 32
 * bytes is `field_malformed`: each has more than one reading, and the summary shows exactly one.
 */

export interface TokenAmount {
  /** Minting policy (script hash), 56 lower-case hex characters. */
  policyId: string;
  /** Asset name bytes, lower-case hex (0 to 64 characters). Rendering it as text is the screen's choice. */
  assetNameHex: string;
  quantity: bigint;
}

export interface ValueView {
  lovelace: bigint;
  /** Every token, in the order the bytes list them. */
  tokens: TokenAmount[];
}

const MAX_ASSET_NAME_BYTES = 32;

export function decodeValue(item: Bytes, path: string): ValueView {
  const state = stateOf(item);
  if (state === Serialization.CborReaderState.UnsignedInteger) return { lovelace: readUint(item, path), tokens: [] };
  const parts = readArray(item, path);
  if (parts.length !== 2) throw new FieldRefusal('field_malformed', path, 'value_length');
  const lovelace = readUint(parts[0], path);
  const tokens: TokenAmount[] = [];
  for (const [policy, assets] of readDistinctMap(parts[1], path, (key) => readBytes(key, path, 28))) {
    const policyId = toHex(policy);
    const names = readDistinctMap(assets, path, (key) => {
      const name = readBytes(key, path);
      if (name.length > MAX_ASSET_NAME_BYTES) throw new FieldRefusal('field_malformed', path, 'asset_name_length');
      return name;
    });
    if (names.length === 0) throw new FieldRefusal('field_malformed', path, 'empty_policy');
    for (const [name, quantityItem] of names) {
      const quantity = readUint(quantityItem, path);
      if (quantity === 0n) throw new FieldRefusal('field_malformed', path, 'zero_quantity');
      tokens.push({ policyId, assetNameHex: toHex(name), quantity });
    }
  }
  return { lovelace, tokens };
}

/** A running per-asset sum: lovelace under the key `lovelace`, tokens under `policyId.assetNameHex`. */
export class ValueSum {
  private readonly amounts = new Map<string, bigint>();

  add(value: ValueView, sign: 1n | -1n = 1n): this {
    this.addLovelace(value.lovelace * sign);
    for (const token of value.tokens) this.bump(`${token.policyId}.${token.assetNameHex}`, token.quantity * sign);
    return this;
  }

  addLovelace(lovelace: bigint): this {
    this.bump('lovelace', lovelace);
    return this;
  }

  lovelace(): bigint {
    return this.quantity('lovelace');
  }

  quantity(unit: string): bigint {
    return this.amounts.get(unit) ?? 0n;
  }

  /** Units (other than lovelace) whose sum is not zero. */
  nonZeroTokens(): string[] {
    return [...this.amounts].filter(([unit, qty]) => unit !== 'lovelace' && qty !== 0n).map(([unit]) => unit);
  }

  isZero(): boolean {
    return [...this.amounts.values()].every((qty) => qty === 0n);
  }

  private bump(unit: string, qty: bigint): void {
    this.amounts.set(unit, (this.amounts.get(unit) ?? 0n) + qty);
  }
}

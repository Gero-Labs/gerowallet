import { describe, expect, it } from 'vitest';
import { fromHex } from './cbor';
import { FieldRefusal } from './refusals';
import { decodeValue, ValueSum } from './value';
import { array, bytes, coinAnd, GOLD, map, POLICY_1, POLICY_2, uint } from './__fixtures__/vaultTxs';

const decode = (hex: string) => decodeValue(fromHex(hex), 'v');
const refusalOf = (hex: string) => {
  try {
    decode(hex);
  } catch (e) {
    if (e instanceof FieldRefusal) return e.refusal;
    throw e;
  }
  throw new Error('expected a refusal');
};

describe('decodeValue', () => {
  it('reads plain coin and coin with tokens, every token in wire order', () => {
    expect(decode(uint(1_000_000))).toEqual({ lovelace: 1_000_000n, tokens: [] });
    const value = coinAnd(2_000_000, map(
      [bytes(POLICY_2), map([bytes('ff'), uint(3)])],
      [bytes(POLICY_1), map([bytes(GOLD), uint(18_446_744_073_709_551_615n)], [bytes(''), uint(1)])],
    ));
    expect(decode(value)).toEqual({
      lovelace: 2_000_000n,
      tokens: [
        { policyId: POLICY_2, assetNameHex: 'ff', quantity: 3n },
        { policyId: POLICY_1, assetNameHex: GOLD, quantity: 18_446_744_073_709_551_615n },
        { policyId: POLICY_1, assetNameHex: '', quantity: 1n },
      ],
    });
  });

  it('accepts an empty multiasset: no tokens', () => {
    expect(decode(coinAnd(5, map()))).toEqual({ lovelace: 5n, tokens: [] });
  });

  it.each([
    ['a repeated policy', coinAnd(1, map([bytes(POLICY_1), map([bytes(GOLD), uint(1)])], [bytes(POLICY_1), map([bytes('00'), uint(1)])])), 'duplicate_key'],
    ['a repeated asset name', coinAnd(1, map([bytes(POLICY_1), map([bytes(GOLD), uint(1)], [bytes(GOLD), uint(2)])])), 'duplicate_key'],
    ['a zero quantity', coinAnd(1, map([bytes(POLICY_1), map([bytes(GOLD), uint(0)])])), 'zero_quantity'],
    ['an empty policy', coinAnd(1, map([bytes(POLICY_1), map()])), 'empty_policy'],
    ['a 33-byte asset name', coinAnd(1, map([bytes(POLICY_1), map([bytes('00'.repeat(33)), uint(1)])])), 'asset_name_length'],
    ['a short policy id', coinAnd(1, map([bytes('b1'.repeat(27)), map([bytes(GOLD), uint(1)])])), 'expected_28_bytes'],
    ['a negative quantity', coinAnd(1, map([bytes(POLICY_1), map([bytes(GOLD), '20'])])), 'expected_uint'],
    ['three items', array(uint(1), map(), uint(2)), 'value_length'],
  ])('refuses %s', (_, hex, detail) => {
    expect(refusalOf(hex)).toEqual({ code: 'field_malformed', path: 'v', detail });
  });
});

describe('ValueSum', () => {
  it('adds and subtracts per asset', () => {
    const sum = new ValueSum()
      .add({ lovelace: 10n, tokens: [{ policyId: POLICY_1, assetNameHex: GOLD, quantity: 4n }] })
      .add({ lovelace: 3n, tokens: [{ policyId: POLICY_1, assetNameHex: GOLD, quantity: 4n }] }, -1n);
    expect(sum.lovelace()).toBe(7n);
    expect(sum.nonZeroTokens()).toEqual([]);
    expect(sum.addLovelace(-7n).isZero()).toBe(true);
  });
});

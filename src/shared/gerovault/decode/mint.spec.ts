import { describe, expect, it } from 'vitest';
import { Serialization } from '@cardano-sdk/core';
import { fromHex, toHex } from './cbor';
import { decodeMint } from './mint';
import { FieldRefusal } from './refusals';

const POLICY = '7e69087d98fac5869eac14e13dfb6f98228c41e638aa2a59d1f85e9c';
const OTHER = 'ab'.repeat(28);

/** `{ policy => { name => quantity } }` as CBOR. */
function mint(entries: Array<[string, Array<[string, bigint]>]>): Uint8Array {
  const writer = new Serialization.CborWriter();
  writer.writeStartMap(entries.length);
  for (const [policy, assets] of entries) {
    writer.writeByteString(fromHex(policy));
    writer.writeStartMap(assets.length);
    for (const [name, quantity] of assets) {
      writer.writeByteString(fromHex(name));
      writer.writeInt(quantity);
    }
  }
  return writer.encode();
}

const refusal = (read: () => unknown) => {
  try {
    read();
  } catch (error) {
    return error instanceof FieldRefusal ? error.refusal : error;
  }
  return null;
};

describe('the mint field', () => {
  it('reads a mint and a burn of a named policy', () => {
    expect(decodeMint(mint([[POLICY, [['', 1n]]]]), 'body.9', [POLICY])).toEqual([{ policyId: POLICY, assetNameHex: '', quantity: 1n }]);
    expect(decodeMint(mint([[POLICY, [['', -1n]]]]), 'body.9', [POLICY])).toEqual([{ policyId: POLICY, assetNameHex: '', quantity: -1n }]);
  });

  it('refuses another policy by name, a zero, an empty map and a repeated key', () => {
    expect(refusal(() => decodeMint(mint([[OTHER, [['', 1n]]]]), 'body.9', [POLICY]))).toEqual({ code: 'mint_unsupported', path: 'body.9', detail: OTHER });
    expect(refusal(() => decodeMint(mint([[POLICY, [['', 0n]]]]), 'body.9', [POLICY]))).toMatchObject({ code: 'field_malformed', detail: 'zero_quantity' });
    expect(refusal(() => decodeMint(mint([]), 'body.9', [POLICY]))).toMatchObject({ code: 'field_malformed', detail: 'empty' });
    expect(refusal(() => decodeMint(mint([[POLICY, []]]), 'body.9', [POLICY]))).toMatchObject({ code: 'field_malformed', detail: 'empty_policy' });
    const twice = toHex(mint([[POLICY, [['', 1n], ['', 2n]]]]));
    expect(refusal(() => decodeMint(fromHex(twice), 'body.9', [POLICY]))).toMatchObject({ code: 'field_malformed', detail: 'duplicate_key' });
  });
});

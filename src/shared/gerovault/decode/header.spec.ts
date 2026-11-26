import { describe, expect, it } from 'vitest';
import { fromHex } from './cbor';
import type { DecodeContext } from './context';
import { decodeFee, decodeNetworkId, decodeRequiredSigners, decodeSlot } from './header';
import { Refusals } from './refusals';
import { array, bytes, K1, K2, uint } from './__fixtures__/vaultTxs';

const ctx = (networkId: 0 | 1): DecodeContext => ({ networkId, refusals: new Refusals() });

describe('header fields', () => {
  it('fee and slots are unsigned integers, up to 64 bits', () => {
    expect(decodeFee(fromHex(uint(200_000)), 'body.2')).toBe(200_000n);
    expect(decodeSlot(fromHex(uint(18_446_744_073_709_551_615n)), 'body.3')).toBe(18_446_744_073_709_551_615n);
    expect(() => decodeFee(fromHex('20'), 'body.2')).toThrow(/expected_uint/);
  });

  it('required signers: key hashes in order, as a list or a tag 258 set; no repeats', () => {
    expect(decodeRequiredSigners(fromHex(array(bytes(K2), bytes(K1))), 'body.14')).toEqual([K2, K1]);
    expect(decodeRequiredSigners(fromHex(`d90102${array(bytes(K1))}`), 'body.14')).toEqual([K1]);
    expect(() => decodeRequiredSigners(fromHex(array(bytes(K1), bytes(K1))), 'body.14')).toThrow(/duplicate_element/);
    expect(() => decodeRequiredSigners(fromHex(array(array(uint(0), bytes(K1)))), 'body.14')).toThrow(/expected_bytes/);
  });

  it('network id must be 0 or 1 and the expected one', () => {
    expect(decodeNetworkId(fromHex(uint(1)), 'body.15', ctx(1))).toBe(1);
    expect(() => decodeNetworkId(fromHex(uint(0)), 'body.15', ctx(1))).toThrow(/network_mismatch/);
    expect(() => decodeNetworkId(fromHex(uint(2)), 'body.15', ctx(0))).toThrow(/field_malformed/);
  });
});

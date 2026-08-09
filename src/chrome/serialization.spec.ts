import { describe, it, expect } from 'vitest';
import { Serialization, Cardano } from '@cardano-sdk/core';
import { coalesceValueQuantities } from './serialization';

// Regression for @cardano-sdk/core 0.47: Value.multiasset() returns undefined
// for an ADA-only value (0.46 returned an empty Map), so coalesceValueQuantities
// called setMultiasset(undefined) and threw "Cannot read properties of undefined
// (reading 'size')" — crashing getBalance / the portfolio page on any ADA-only
// wallet.
describe('coalesceValueQuantities (SDK 0.47 multiasset undefined)', () => {
  const ada = (n: bigint) => new Serialization.Value(n);
  const withAsset = (n: bigint, assetId: string, qty: bigint) =>
    new Serialization.Value(n, new Map<Cardano.AssetId, bigint>([[assetId as Cardano.AssetId, qty]]));
  const ASSET = '1234567890123456789012345678901234567890123456789012345678'; // policy+name hex

  it('sums ADA-only values without throwing', () => {
    const out = coalesceValueQuantities([ada(1000000n), ada(2500000n)]);
    expect(out.coin()).toBe(3500000n);
    // multiasset stays absent/empty for a pure-ADA total
    expect(out.multiasset() === undefined || out.multiasset()!.size === 0).toBe(true);
  });

  it('handles a mix of ADA-only and asset-bearing values', () => {
    const out = coalesceValueQuantities([ada(1000000n), withAsset(2000000n, ASSET, 5n)]);
    expect(out.coin()).toBe(3000000n);
    expect(out.multiasset()!.get(ASSET as Cardano.AssetId)).toBe(5n);
  });

  it('accumulates the same asset across values', () => {
    const out = coalesceValueQuantities([withAsset(1000000n, ASSET, 3n), withAsset(1000000n, ASSET, 4n)]);
    expect(out.coin()).toBe(2000000n);
    expect(out.multiasset()!.get(ASSET as Cardano.AssetId)).toBe(7n);
  });

  it('is a no-op-safe on an empty list', () => {
    const out = coalesceValueQuantities([]);
    expect(out.coin()).toBe(0n);
  });
});

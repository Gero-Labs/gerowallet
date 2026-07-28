import { describe, it, expect } from 'vitest';
import { useHotFeeKey } from './useHotFeeKey';

const SEED = new Uint8Array(32).fill(7);

describe('useHotFeeKey', () => {
  it('generate derives a stable pubkey + mainnet enterprise address from a seed', async () => {
    const hk = useHotFeeKey(1);
    const a = await hk.generate(SEED);
    expect(a.publicKeyHex).toMatch(/^[0-9a-f]{64}$/i);
    expect(a.enterpriseAddress).toMatch(/^addr1/);
    // deterministic for a fixed seed
    const hk2 = useHotFeeKey(1);
    expect((await hk2.generate(SEED)).enterpriseAddress).toBe(a.enterpriseAddress);
  });

  it('generate on testnet yields an addr_test enterprise address', async () => {
    const hk = useHotFeeKey(0);
    expect((await hk.generate(SEED)).enterpriseAddress).toMatch(/^addr_test1/);
  });

  it('signBodyHash returns a 64-byte sig + matching vkey, verifiable', async () => {
    const { ed25519 } = await import('@noble/curves/ed25519');
    const hk = useHotFeeKey(1);
    const { publicKeyHex } = await hk.generate(SEED);
    const hashHex = 'ab'.repeat(32);
    const { vkey, signature } = hk.signBodyHash(hashHex);
    expect(vkey).toBe(publicKeyHex);
    const ok = ed25519.verify(
      Uint8Array.from(signature.match(/../g)!.map((b) => parseInt(b, 16))),
      Uint8Array.from(hashHex.match(/../g)!.map((b) => parseInt(b, 16))),
      Uint8Array.from(vkey.match(/../g)!.map((b) => parseInt(b, 16))),
    );
    expect(ok).toBe(true);
  });

  it('reset drops the key', async () => {
    const hk = useHotFeeKey(1);
    await hk.generate(SEED);
    expect(hk.hasKey.value).toBe(true);
    hk.reset();
    expect(hk.hasKey.value).toBe(false);
    expect(() => hk.signBodyHash('ab'.repeat(32))).toThrow();
  });

  it('reset does not mutate the caller-supplied seed', async () => {
    const seed = new Uint8Array(32).fill(9);
    const hk = useHotFeeKey(1);
    await hk.generate(seed);
    hk.reset();
    expect(seed.every((b) => b === 9)).toBe(true);
  });
});

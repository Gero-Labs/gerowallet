import { describe, it, expect } from 'vitest';
import { splitEntropy, combineShares, TOTAL_SHARES, THRESHOLD } from './shamir';
import { MpcError } from './types';

const entropy32 = () => crypto.getRandomValues(new Uint8Array(32));

describe('shamir', () => {
  it('splits into TOTAL_SHARES shares', async () => {
    const shares = await splitEntropy(entropy32());
    expect(shares).toHaveLength(TOTAL_SHARES);
  });

  it('reconstructs from any THRESHOLD shares (all 3 pairs)', async () => {
    const secret = entropy32();
    const [a, b, c] = await splitEntropy(secret);
    for (const pair of [[a, b], [a, c], [b, c]]) {
      const out = await combineShares(pair);
      expect(Array.from(out)).toEqual(Array.from(secret));
    }
  });

  it('rejects fewer than THRESHOLD shares', async () => {
    const [a] = await splitEntropy(entropy32());
    await expect(combineShares([a])).rejects.toBeInstanceOf(MpcError);
  });

  it('rejects empty entropy', async () => {
    await expect(splitEntropy(new Uint8Array(0))).rejects.toBeInstanceOf(MpcError);
  });

  it('works for 16-byte entropy', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(16));
    const [a, b] = await splitEntropy(secret);
    expect(Array.from(await combineShares([a, b]))).toEqual(Array.from(secret));
  });

  it('THRESHOLD is 2 and TOTAL_SHARES is 3', () => {
    expect(THRESHOLD).toBe(2);
    expect(TOTAL_SHARES).toBe(3);
  });
});

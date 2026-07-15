import { describe, it, expect } from 'vitest';
import { createMpcShareSet, reconstructEntropy } from './mpcShares';

const entropy = () => crypto.getRandomValues(new Uint8Array(32));

describe('mpcShares', () => {
  it('creates three distinct role-tagged encoded shares', async () => {
    const set = await createMpcShareSet(entropy());
    expect(set.deviceShare.startsWith('gmpc1.01.')).toBe(true);
    expect(set.loginShare.startsWith('gmpc1.02.')).toBe(true);
    expect(set.recoveryShare.startsWith('gmpc1.03.')).toBe(true);
    expect(new Set([set.deviceShare, set.loginShare, set.recoveryShare]).size).toBe(3);
  });

  it('reconstructs the original entropy from ANY pair of shares', async () => {
    const secret = entropy();
    const set = await createMpcShareSet(secret);
    const pairs: [string, string][] = [
      [set.deviceShare, set.loginShare],
      [set.deviceShare, set.recoveryShare],
      [set.loginShare, set.recoveryShare],
    ];
    for (const [a, b] of pairs) {
      const out = await reconstructEntropy(a, b);
      expect(Array.from(out)).toEqual(Array.from(secret));
    }
  });
});

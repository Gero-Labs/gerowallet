// The swap's code → copy table, private-swap refusals included: every code the
// worker can answer has copy in all three languages.
import { describe, expect, it } from 'vitest';
import {
  canProvePrivateSwap, MIDNIGHT_PRIVATE_SWAP_REFUSALS, MIDNIGHT_SWAP_PRIVATE_ESTIMATE_MINUTES, isMidnightSwapCode, midnightSwapCopyKey, privateSwapRefusalCode,
} from './midnightSwapConfig';
import { PRIVATE_SWAP_EXPIRY_MARGIN_MS, PRIVATE_SWAP_REFUSALS, PRIVATE_SWAP_ROOT_WINDOW_MS } from './midnightPrivateSwap9';
import us from '@/plugins/i18n/us';

describe('private-swap refusals', () => {
  it('lists exactly the refusal codes of midnightPrivateSwap9.ts', () => {
    expect([...MIDNIGHT_PRIVATE_SWAP_REFUSALS].sort()).toEqual(Object.keys(PRIVATE_SWAP_REFUSALS).sort());
  });

  it('maps each to copy that exists', () => {
    for (const refusal of MIDNIGHT_PRIVATE_SWAP_REFUSALS) {
      const code = privateSwapRefusalCode(refusal);
      expect(isMidnightSwapCode(code)).toBe(true);
      const key = midnightSwapCopyKey(code);
      expect(key, code).toBeTruthy();
      expect((us as Record<string, string>)[key!], key).toBeTruthy();
    }
    expect(midnightSwapCopyKey('SWAP_PRIVATE_own')).toBe('midnight.swap.error.own');
    expect(midnightSwapCopyKey('SWAP_PRIVATE_nope')).toBeUndefined();
    expect(isMidnightSwapCode('SWAP_PRIVATE_constructor')).toBe(false);
  });

  it('says the same estimate the builder computes for a fully private offer', () => {
    expect(MIDNIGHT_SWAP_PRIVATE_ESTIMATE_MINUTES * 60_000).toBe(PRIVATE_SWAP_ROOT_WINDOW_MS - PRIVATE_SWAP_EXPIRY_MARGIN_MS);
  });

  it('has copy for the wallet\'s own private-swap code', () => {
    expect((us as Record<string, string>)[midnightSwapCopyKey('SWAP_PRIVATE_NO_WITHDRAW')!]).toBeTruthy();
  });
});

describe('canProvePrivateSwap', () => {
  it('takes a proof server always, this computer only with the hosted Zswap keys, never Gero Cloud', () => {
    expect(canProvePrivateSwap('local', false)).toBe(true);
    expect(canProvePrivateSwap('zkpaas', false)).toBe(true);
    expect(canProvePrivateSwap('device', false)).toBe(false);
    expect(canProvePrivateSwap('helper', false)).toBe(false);
    expect(canProvePrivateSwap('device', true)).toBe(true);
    expect(canProvePrivateSwap('helper', true)).toBe(true);
    expect(canProvePrivateSwap('cloud', true)).toBe(false);
    expect(midnightSwapCopyKey('SWAP_PRIVATE_PROVER')).toBe('midnight.swap.error.privateProver');
  });
});

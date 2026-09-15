import { describe, it, expect, beforeEach } from 'vitest';
import { isNativeNight, midnightTokenBalances } from './midnightTokenBalances';
import type { MidnightUnshieldedUtxo } from './midnightTypes';
// Store integration: drives the actual `isNight` guard inside
// `applyUtxoDeltas` rather than re-implementing it in the test body. Safe to
// import under vitest — `context` resolves to `'content'` (no `chrome-extension:`
// protocol in happy-dom), so every `chrome.*` call in this module sits behind
// an `if (context === 'background' | 'browser')` guard that never opens here.
import { midnightActions, midnightStore } from '@/stores/midnightStore';

const USDM = '8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b';
const NIGHT_ZERO = '0'.repeat(64);

function utxo(tokenType: string, value: bigint, outputIndex = 0): MidnightUnshieldedUtxo {
  return {
    owner: 'mn_addr1test',
    tokenType,
    value,
    intentHash: `intent${outputIndex}`,
    outputIndex,
    initialNonce: '',
    registeredForDustGeneration: false,
  };
}

describe('isNativeNight', () => {
  it('treats empty and all-zero token types as native NIGHT', () => {
    expect(isNativeNight('')).toBe(true);
    expect(isNativeNight(undefined)).toBe(true);
    expect(isNativeNight(NIGHT_ZERO)).toBe(true);
  });

  it('treats a real token color as non-native', () => {
    expect(isNativeNight(USDM)).toBe(false);
  });

  it('accepts all-zero strings of any length, and null', () => {
    expect(isNativeNight('0')).toBe(true);
    expect(isNativeNight('00')).toBe(true);
    expect(isNativeNight(null)).toBe(true);
    expect(isNativeNight('0'.repeat(63))).toBe(true);
  });
});

describe('midnightTokenBalances', () => {
  it('returns an empty map when the wallet holds only NIGHT', () => {
    expect(midnightTokenBalances([utxo(NIGHT_ZERO, 100n), utxo('', 50n, 1)])).toEqual({});
  });

  it('sums a single non-native color', () => {
    expect(midnightTokenBalances([utxo(USDM, 5000000n)])).toEqual({ [USDM]: 5000000n });
  });

  it('sums multiple UTxOs of the same color and excludes NIGHT', () => {
    const result = midnightTokenBalances([
      utxo(USDM, 5000000n, 0),
      utxo(USDM, 2500000n, 1),
      utxo(NIGHT_ZERO, 999n, 2),
    ]);
    expect(result).toEqual({ [USDM]: 7500000n });
  });

  it('keeps distinct colors separate', () => {
    const other = 'ab'.repeat(32);
    const result = midnightTokenBalances([utxo(USDM, 1n, 0), utxo(other, 2n, 1)]);
    expect(result).toEqual({ [USDM]: 1n, [other]: 2n });
  });

  it('returns an empty map for an empty UTxO set', () => {
    expect(midnightTokenBalances([])).toEqual({});
  });

  it('handles token colors that collide with Object.prototype keys', () => {
    const result = midnightTokenBalances([
      utxo('__proto__', 7n, 0),
      utxo('constructor', 9n, 1),
    ]);
    expect(result['__proto__']).toBe(7n);
    expect(result['constructor']).toBe(9n);
    expect(Object.entries(result)).toHaveLength(2);
  });
});

describe('NIGHT balance isolation (store integration)', () => {
  // Reset so the test doesn't depend on what ran before it, and so it
  // doesn't leak state into whatever runs after.
  beforeEach(() => {
    midnightStore.utxos = [];
    midnightStore.balances = {
      nightShielded: 0n,
      nightUnshielded: 0n,
      nightRegistered: 0n,
      dust: 0n,
      dustGenerating: 0n,
    };
    midnightStore.lastMidnightTxId = null;
  });

  it('applyUtxoDeltas counts only the NIGHT UTxOs toward nightUnshielded, never USDM', () => {
    // Drives the real per-transaction delta path (the thing Task 2 fixed):
    // a single batch receiving native NIGHT alongside a non-native color.
    midnightActions.applyUtxoDeltas({
      added: [
        utxo(NIGHT_ZERO, 100n, 0),
        utxo(USDM, 5000000n, 1),
        utxo('', 25n, 2),
      ],
      removed: [],
    });

    // 100 + 25 native, USDM excluded — proves the isNight() guard inside
    // applyUtxoDeltas is actually filtering, not just present in the source.
    expect(midnightStore.balances.nightUnshielded).toBe(125n);
    // All three colors are still stored in the UTxO set itself — per-color
    // token balances are derived from it via midnightTokenBalances(), not
    // tracked as separate fields.
    expect(midnightStore.utxos).toHaveLength(3);
    expect(midnightTokenBalances(midnightStore.utxos)).toEqual({ [USDM]: 5000000n });
  });
});

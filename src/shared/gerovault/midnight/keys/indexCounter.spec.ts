// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DISCOVERY_LOOKAHEAD, allocateIndex, discoveryRange, mergeIndexCounters, newIndexCounter, readIndexCounter, recordIndexSeen } from './indexCounter';
import { MAX_KEY_INDEX } from './paths';
import { MidnightNetwork } from './types';

const code = (c: string) => expect.objectContaining({ code: c });

describe('indexCounter: allocation', () => {
  it('starts at 1 and counts up, one counter per network', () => {
    let c = newIndexCounter('preprod');
    expect(c).toEqual({ network: 'preprod', highestAllocated: 0 });
    const got: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = allocateIndex(c);
      got.push(a.index);
      c = a.counter;
    }
    expect(got).toEqual([1, 2, 3, 4]);
    expect(c).toEqual({ network: 'preprod', highestAllocated: 4 });
    expect(allocateIndex(newIndexCounter('mainnet')).index).toBe(1);
  });

  it('never hands out an index again, abandoned or not: only the highest is kept', () => {
    const a = allocateIndex(newIndexCounter('preprod'));
    const b = allocateIndex(a.counter);
    // Whatever happened to index 1 (an abandoned setup), the next one is 3.
    expect(allocateIndex(b.counter).index).toBe(3);
    expect(allocateIndex(a.counter).index).toBe(2);
  });

  it('stops at the end of the hardened range', () => {
    expect(allocateIndex({ network: 'preprod', highestAllocated: MAX_KEY_INDEX - 1 }).index).toBe(MAX_KEY_INDEX);
    expect(() => allocateIndex({ network: 'preprod', highestAllocated: MAX_KEY_INDEX })).toThrow(code('INDEX_SPACE_EXHAUSTED'));
  });
});

describe('indexCounter: restore and discovery', () => {
  it('raises the counter for an index found in use, never lowers it', () => {
    const c = { network: 'preview' as MidnightNetwork, highestAllocated: 5 };
    expect(recordIndexSeen(c, 9)).toEqual({ network: 'preview', highestAllocated: 9 });
    expect(recordIndexSeen(c, 2)).toEqual(c);
    expect(() => recordIndexSeen(c, 0)).toThrow(code('INVALID_INDEX'));
  });

  it('merges the package\'s counter with the device\'s by taking the higher', () => {
    const device = { network: 'preprod' as MidnightNetwork, highestAllocated: 3 };
    const pkg = { network: 'preprod' as MidnightNetwork, highestAllocated: 7 };
    expect(mergeIndexCounters(device, pkg)).toEqual(pkg);
    expect(mergeIndexCounters(pkg, device)).toEqual(pkg);
    expect(() => mergeIndexCounters(device, { network: 'mainnet', highestAllocated: 7 })).toThrow(code('INVALID_COUNTER'));
  });

  it('scans from 1 to the highest allocated plus 20', () => {
    expect(DISCOVERY_LOOKAHEAD).toBe(20);
    expect(discoveryRange(newIndexCounter('preprod'))).toEqual({ first: 1, last: 20 });
    expect(discoveryRange({ network: 'preprod', highestAllocated: 13 })).toEqual({ first: 1, last: 33 });
    expect(discoveryRange({ network: 'preprod', highestAllocated: MAX_KEY_INDEX - 5 })).toEqual({ first: 1, last: MAX_KEY_INDEX });
  });
});

describe('indexCounter: reading a stored counter', () => {
  it('reads exactly a network and a highest index', () => {
    expect(readIndexCounter({ network: 'preprod', highestAllocated: 4 })).toEqual({ network: 'preprod', highestAllocated: 4 });
    expect(readIndexCounter(JSON.parse('{"highestAllocated":0,"network":"mainnet"}'))).toEqual({ network: 'mainnet', highestAllocated: 0 });
  });

  it('refuses anything else and never throws', () => {
    for (const bad of [
      undefined,
      null,
      7,
      [],
      { network: 'preprod' },
      { network: 'preprod', highestAllocated: -1 },
      { network: 'preprod', highestAllocated: 1.5 },
      { network: 'preprod', highestAllocated: '3' },
      { network: 'preprod', highestAllocated: MAX_KEY_INDEX + 1 },
      { network: 'testnet', highestAllocated: 1 },
      { network: 'preprod', highestAllocated: 1, extra: true },
    ]) {
      expect(readIndexCounter(bad)).toBeUndefined();
    }
    expect(() => allocateIndex({ network: 'preprod', highestAllocated: -1 })).toThrow(code('INVALID_COUNTER'));
    expect(() => newIndexCounter('devnet' as MidnightNetwork)).toThrow(code('INVALID_NETWORK'));
  });
});

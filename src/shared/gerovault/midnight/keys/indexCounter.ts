/**
 * Index allocation for Midnight vault keys: one counter per seed and network, across all roles.
 *
 * - The first index is 1; each new vault setup (owner, guardian or delegate) takes the next one.
 * - An index is never reused, not even after an abandoned setup: a key that may have reached
 *   another person stays retired.
 * - The counter records the highest index allocated. It travels in the recovery package, and a
 *   restore takes the higher of the package's and the device's (`mergeIndexCounters`).
 * - Discovery by contract address tries every index from 1 to the highest allocated plus 20
 *   (`discoveryRange`), so a device that lost its counter still finds keys made just before.
 *   Any index found in use raises the counter (`recordIndexSeen`).
 *
 * Pure functions over a small record; storing it is the store's job.
 */
import { MidnightKeyError } from './errors';
import { FIRST_KEY_INDEX, MAX_KEY_INDEX, isMidnightKeyIndex, isMidnightNetwork } from './paths';
import { MidnightNetwork } from './types';

/** How far past the highest allocated index discovery looks. */
export const DISCOVERY_LOOKAHEAD = 20;

export interface MidnightIndexCounter {
  readonly network: MidnightNetwork;
  /** The highest index ever allocated for this seed and network; 0 before the first. */
  readonly highestAllocated: number;
}

const isHighest = (n: unknown): n is number => n === 0 || isMidnightKeyIndex(n);

/** A counter for a seed and network that has allocated nothing yet. */
export function newIndexCounter(network: MidnightNetwork): MidnightIndexCounter {
  if (!isMidnightNetwork(network)) throw new MidnightKeyError('INVALID_NETWORK', 'A Midnight network is mainnet, preprod or preview');
  return Object.freeze({ network, highestAllocated: 0 });
}

/** A stored counter, read strictly: exactly `network` and `highestAllocated`. `undefined` otherwise; never throws. */
export function readIndexCounter(value: unknown): MidnightIndexCounter | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'highestAllocated' || keys[1] !== 'network') return undefined;
  const { network, highestAllocated } = value as Record<string, unknown> as { network: unknown; highestAllocated: unknown };
  if (!isMidnightNetwork(network) || !isHighest(highestAllocated)) return undefined;
  return Object.freeze({ network, highestAllocated });
}

function assertCounter(counter: MidnightIndexCounter): void {
  if (!readIndexCounter(counter)) throw new MidnightKeyError('INVALID_COUNTER', 'An index counter names a network and the highest index allocated');
}

/** The next index and the counter that records it. Throws `INVALID_COUNTER` or `INDEX_SPACE_EXHAUSTED`. */
export function allocateIndex(counter: MidnightIndexCounter): { readonly index: number; readonly counter: MidnightIndexCounter } {
  assertCounter(counter);
  if (counter.highestAllocated >= MAX_KEY_INDEX) throw new MidnightKeyError('INDEX_SPACE_EXHAUSTED', 'Every index of this seed and network is taken');
  const index = Math.max(counter.highestAllocated + 1, FIRST_KEY_INDEX);
  return Object.freeze({ index, counter: Object.freeze({ network: counter.network, highestAllocated: index }) });
}

/** The counter after an index was found in use (on chain, in a file, on another device): never lowered. */
export function recordIndexSeen(counter: MidnightIndexCounter, index: number): MidnightIndexCounter {
  assertCounter(counter);
  if (!isMidnightKeyIndex(index)) throw new MidnightKeyError('INVALID_INDEX', `A vault key index is an integer from ${FIRST_KEY_INDEX} to ${MAX_KEY_INDEX}`);
  return Object.freeze({ network: counter.network, highestAllocated: Math.max(counter.highestAllocated, index) });
}

/** The higher of two counters of the same network, as a restore keeps it. Throws `INVALID_COUNTER` across networks. */
export function mergeIndexCounters(a: MidnightIndexCounter, b: MidnightIndexCounter): MidnightIndexCounter {
  assertCounter(a);
  assertCounter(b);
  if (a.network !== b.network) throw new MidnightKeyError('INVALID_COUNTER', 'Counters of different networks never merge');
  return Object.freeze({ network: a.network, highestAllocated: Math.max(a.highestAllocated, b.highestAllocated) });
}

/** The indexes discovery tries, inclusive: from 1 to the highest allocated plus 20 (at most 2^31 - 1). */
export function discoveryRange(counter: MidnightIndexCounter): { readonly first: number; readonly last: number } {
  assertCounter(counter);
  return Object.freeze({ first: FIRST_KEY_INDEX, last: Math.min(counter.highestAllocated + DISCOVERY_LOOKAHEAD, MAX_KEY_INDEX) });
}

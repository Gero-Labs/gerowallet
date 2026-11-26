/**
 * Vault index allocation, per participant (GV-15). Pure functions over facts the caller gathered;
 * the scans that gather them live elsewhere.
 *
 * Each participant contributes to a vault their keys at their own index `i`
 * (`m/1854'/1815'/0'/0/i` and `.../2/i`), so every participant's own sequence stays sequential
 * and dense, which is what discovery from their seed relies on (CIP-1854 key rules, CIP-0146
 * discovery). Index `i` of a participant is taken when:
 * - `i` is 0 (left to the wallet's existing CIP-1854 witness at `0/0` in the dApp signing path);
 * - the key at `0/i` or `2/i` appears on chain, in a label 1854 registration or in a native
 *   script revealed in any transaction (`onChain`);
 * - it belongs to an accepted vault, a quarantined candidate or a live setup (`held`);
 * - it was released (a cancelled or abandoned setup) and no fresh scan has cleared it.
 * A released index is free again only after a fresh scan found no registration containing the
 * participant's key at `i` and no transaction history at the address the setup would have had,
 * which is CIP-1854's own test of an unused index. Released indexes are reused first. A
 * participant holds at most 10 setups not yet on chain, which keeps their gaps inside the 20-key
 * look-ahead CIP-1854 asks wallets to keep.
 */
import { isVaultIndex } from './paths';
import { MAX_VAULT_INDEX } from './types';

/** Vaults this wallet creates never use index 0. */
export const FIRST_VAULT_INDEX = 1;
/** At most this many live setups not yet on chain per participant. */
export const MAX_PENDING_SETUPS = 10;
/** Look-ahead of a discovery scan of the wallet's own keys (CIP-1854: up to 20 unused keys). */
export const DISCOVERY_GAP_LIMIT = 20;

export type HeldKind = 'vault' | 'candidate' | 'setup';

export interface HeldIndex {
  readonly index: number;
  /** An accepted vault, a quarantined candidate, or a live setup on this device. */
  readonly kind: HeldKind;
}

/** What a fresh scan found for a released index. Anything not exactly `false` keeps it taken. */
export interface ReleaseScan {
  readonly registrationFound: boolean;
  readonly addressHistoryFound: boolean;
}

export interface ReleasedIndex {
  readonly index: number;
  /** The fresh scan for this index, or absent when none has run since the release. */
  readonly scan?: ReleaseScan;
}

/** One participant's index history. */
export interface ParticipantIndexHistory {
  readonly onChain: readonly number[];
  readonly held: readonly HeldIndex[];
  readonly released: readonly ReleasedIndex[];
}

export type VaultIndexRefusal = 'INVALID_HISTORY' | 'TOO_MANY_PENDING' | 'INDEX_SPACE_EXHAUSTED';

export type VaultIndexAllocation =
  | { readonly ok: true; readonly index: number; /** A released index, cleared by its scan. */ readonly reused: boolean }
  | { readonly ok: false; readonly code: VaultIndexRefusal };

interface ReadHistory {
  readonly onChain: ReadonlySet<number>;
  readonly held: ReadonlySet<number>;
  readonly pending: number;
  readonly cleared: readonly number[];
  readonly releasedTaken: ReadonlySet<number>;
}

const HELD_KINDS: readonly string[] = ['vault', 'candidate', 'setup'];

function read(history: ParticipantIndexHistory): ReadHistory | undefined {
  if (!history || !Array.isArray(history.onChain) || !Array.isArray(history.held) || !Array.isArray(history.released)) {
    return undefined;
  }
  if (!history.onChain.every(isVaultIndex)) return undefined;
  if (!history.held.every(h => isVaultIndex(h?.index) && HELD_KINDS.includes(h.kind))) return undefined;
  if (!history.released.every(r => isVaultIndex(r?.index))) return undefined;
  const onChain = new Set(history.onChain);
  const held = new Set(history.held.map(h => h.index));
  const pending = new Set(history.held.filter(h => h.kind === 'setup' && !onChain.has(h.index)).map(h => h.index)).size;
  const cleared = new Set<number>();
  const releasedTaken = new Set<number>();
  for (const r of history.released) {
    const clear = r.scan?.registrationFound === false && r.scan?.addressHistoryFound === false;
    if (clear && !onChain.has(r.index) && !held.has(r.index) && r.index !== 0) cleared.add(r.index);
    else releasedTaken.add(r.index);
  }
  // The same index released twice with different scans stays taken: one of them found something.
  const clearOnly = [...cleared].filter(i => !releasedTaken.has(i)).sort((a, b) => a - b);
  return { onChain, held, pending, cleared: clearOnly, releasedTaken };
}

function takenIn(h: ReadHistory, index: number): boolean {
  return index === 0 || h.onChain.has(index) || h.held.has(index) || h.releasedTaken.has(index);
}

/** Whether the participant's index is taken. Malformed history counts every index as taken. */
export function isIndexTaken(history: ParticipantIndexHistory, index: number): boolean {
  const h = read(history);
  return !h || !isVaultIndex(index) || takenIn(h, index);
}

/**
 * The participant's index for a new vault: the smallest released index a fresh scan cleared,
 * else the smallest index from 1 that nothing takes and that was never released.
 */
export function nextVaultIndex(history: ParticipantIndexHistory): VaultIndexAllocation {
  const h = read(history);
  if (!h) return { ok: false, code: 'INVALID_HISTORY' };
  if (h.pending >= MAX_PENDING_SETUPS) return { ok: false, code: 'TOO_MANY_PENDING' };
  if (h.cleared.length > 0) return { ok: true, index: h.cleared[0], reused: true };
  let index = FIRST_VAULT_INDEX;
  while (index <= MAX_VAULT_INDEX && takenIn(h, index)) index++;
  return index <= MAX_VAULT_INDEX ? { ok: true, index, reused: false } : { ok: false, code: 'INDEX_SPACE_EXHAUSTED' };
}

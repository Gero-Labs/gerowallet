/**
 * The DRep directory's ordering, kept out of the view so the one rule that
 * matters here can be tested without a DOM.
 *
 * NEUTRALITY IS THE POINT. Gero does not rank representatives. The directory
 * arrives ordered by PARTICIPATION and can only ever be ordered by voting power
 * because a person clicked that column. Three properties enforce it:
 *
 *  - `DEFAULT_SORT` is participation, descending, and `nextSort` never produces
 *    an unsorted state that would have to fall back to something else.
 *  - Voting power compares as BigInt. Number() on lovelace is lossy above 2^53,
 *    and a lossy comparator quietly reorders the largest holders.
 *  - Ties break on the DRep credential, never on power, so equal figures cannot
 *    turn into a power ranking by the back door. Unknown figures sort LAST in
 *    BOTH directions: "pending" is not "worst", it is absent.
 *
 * Every order here spans the WHOLE register, never the loaded page. Which of the
 * two mechanisms delivers that is `SERVER_SORT_BY`'s to say — see the comment on
 * it, and `drepRegister.ts` for the client-side half.
 */
import { compareLovelace } from '@/shared/utils/lovelace';

export type SortKey = 'participation' | 'rationale' | 'power' | 'delegators' | 'lastVote';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** The order the page arrives in. Never power. */
export const DEFAULT_SORT: Readonly<SortState> = Object.freeze({ key: 'participation', dir: 'desc' });

/** Every column a header can order by, in header order. */
export const SORTABLE_KEYS: readonly SortKey[] = Object.freeze([
  'participation',
  'rationale',
  'delegators',
  'lastVote',
  'power',
]);

/**
 * Which columns `/api/dreps` can order for us, and under what name.
 *
 * An ALLOW-LIST, not a translation table, because the endpoint does not validate
 * this parameter: `sort_by=participation` and `sort_by=garbage_key` both return
 * HTTP 200 carrying the server's DEFAULT order (verified against mainnet
 * 2026-08-24). Passing a sort key through would therefore paint an arbitrary
 * order under a header claiming to be sorted — the exact failure this whole
 * change exists to remove. Anything mapped to null is ordered client side over
 * the full register instead.
 *
 * `lastVote` is null DELIBERATELY. The endpoint does offer `sort_by=votes`, but
 * that orders by how MANY votes a DRep has cast, and this column shows WHEN they
 * last voted. Wiring the two together would swap one page-local lie for a
 * register-wide one.
 */
export const SERVER_SORT_BY: Readonly<Record<SortKey, string | null>> = Object.freeze({
  participation: null,
  rationale: null,
  delegators: 'delegators',
  lastVote: null,
  power: 'voting_power',
});

/** The `/api/dreps` query fields for one sort state, or null when only the client can order it. */
export function serverSortFor(state: SortState): { sort_by: string; sort_direction: SortDir } | null {
  const sortBy = SERVER_SORT_BY[state.key];
  return sortBy ? { sort_by: sortBy, sort_direction: state.dir } : null;
}

/** True when the server can deliver this column's order across every page. */
export function isServerSortable(key: SortKey): boolean {
  return SERVER_SORT_BY[key] !== null;
}

/**
 * The minimum a row must expose to be ordered. Deliberately structural rather
 * than the view's full row type: the comparator has no business knowing about
 * avatars or labels.
 */
export interface SortableRow {
  /** Stable, neutral tie-break. The DRep credential in practice. */
  key: string;
  stats: {
    participation: { pct: number | null };
    rationaleRate: { pct: number | null };
    delegatorCount: number | null;
    lastVoteBlockTime: number | null;
    votingPower: bigint;
  };
}

/**
 * What clicking a header does. Clicking the active column flips its direction;
 * clicking any other column takes over at descending, which is what "best
 * first" means for every figure on this page. There is no third click that
 * clears the sort: the list must always have an order, and an order that can be
 * cleared has to fall back to something, which is how a default quietly becomes
 * a ranking.
 */
export function nextSort(current: SortState, clicked: SortKey): SortState {
  if (current.key === clicked) {
    return { key: clicked, dir: current.dir === 'desc' ? 'asc' : 'desc' };
  }
  return { key: clicked, dir: 'desc' };
}

/** `aria-sort` for one column: only the active column carries a direction. */
export function ariaSortFor(state: SortState, column: SortKey): 'ascending' | 'descending' | 'none' {
  if (state.key !== column) return 'none';
  return state.dir === 'asc' ? 'ascending' : 'descending';
}

/**
 * Order by a nullable number, unknowns last in both directions, tie-break on the
 * row key. Pure: returns a new array.
 */
function byValue<T extends SortableRow>(rows: T[], value: (row: T) => number | null, dir: SortDir): T[] {
  const sign = dir === 'asc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return a.key.localeCompare(b.key);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return a.key.localeCompare(b.key);
    return sign * (bv - av);
  });
}

/** Apply one sort state to a page of rows. Never mutates the input. */
export function sortDirectory<T extends SortableRow>(rows: T[], state: SortState): T[] {
  const { dir } = state;
  switch (state.key) {
    case 'power': {
      const sign = dir === 'asc' ? -1 : 1;
      return [...rows].sort(
        (a, b) => sign * compareLovelace(b.stats.votingPower, a.stats.votingPower) || a.key.localeCompare(b.key),
      );
    }
    case 'rationale':
      return byValue(rows, row => row.stats.rationaleRate.pct, dir);
    case 'delegators':
      return byValue(rows, row => row.stats.delegatorCount, dir);
    case 'lastVote':
      return byValue(rows, row => row.stats.lastVoteBlockTime, dir);
    case 'participation':
    default:
      return byValue(rows, row => row.stats.participation.pct, dir);
  }
}

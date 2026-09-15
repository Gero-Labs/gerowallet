// The directory's ordering, and above all its NEUTRALITY.
//
// Gero does not rank DReps. The page arrives ordered by participation, and it
// becomes ordered by voting power only because a person clicked that column.
// These tests exist so that stays true after someone "improves" the default,
// and so the comparator keeps its two quieter promises: BigInt-exact power, and
// unknown figures that never masquerade as bad ones.
import { describe, it, expect } from 'vitest';
import {
  ariaSortFor,
  DEFAULT_SORT,
  isServerSortable,
  nextSort,
  SERVER_SORT_BY,
  serverSortFor,
  SORTABLE_KEYS,
  sortDirectory,
  type SortableRow,
  type SortState,
} from './drepDirectory.sort';

interface Row extends SortableRow {
  name: string;
}

/**
 * Absent means "use the filler"; an explicit null means "this DRep's figure is
 * genuinely unknown". `??` cannot tell those apart, and conflating them is how a
 * pending-sorts-last test silently stops testing anything.
 */
function pick(value: number | null | undefined, filler: number): number | null {
  return value === undefined ? filler : value;
}

function row(
  name: string,
  over: {
    participation?: number | null;
    rationale?: number | null;
    delegators?: number | null;
    lastVote?: number | null;
    power?: bigint;
  } = {},
): Row {
  return {
    name,
    key: name,
    stats: {
      participation: { pct: pick(over.participation, 50) },
      rationaleRate: { pct: pick(over.rationale, 50) },
      delegatorCount: pick(over.delegators, 100),
      lastVoteBlockTime: pick(over.lastVote, 1_700_000_000),
      votingPower: over.power ?? 1_000_000n,
    },
  };
}

const order = (rows: Row[]): string[] => rows.map(r => r.name);

describe('DRep directory: the default order', () => {
  it('is participation, descending', () => {
    expect(DEFAULT_SORT.key).toBe('participation');
    expect(DEFAULT_SORT.dir).toBe('desc');
  });

  it('is never voting power, whatever the powers are', () => {
    // The whale is dead last on participation. If power ever leaks into the
    // default it lands first, and this fails.
    const rows = [
      row('whale', { participation: 3, power: 90_000_000_000_000n }),
      row('worker', { participation: 97, power: 12n }),
    ];
    expect(order(sortDirectory(rows, DEFAULT_SORT))).toEqual(['worker', 'whale']);
  });

  it('offers power as one sortable column among five', () => {
    expect([...SORTABLE_KEYS].sort()).toEqual(
      ['delegators', 'lastVote', 'participation', 'power', 'rationale'],
    );
  });
});

describe('DRep directory: which columns the server can order', () => {
  it('maps power and delegators to the names `/api/dreps` understands', () => {
    expect(serverSortFor({ key: 'power', dir: 'desc' })).toEqual({
      sort_by: 'voting_power',
      sort_direction: 'desc',
    });
    expect(serverSortFor({ key: 'delegators', dir: 'asc' })).toEqual({
      sort_by: 'delegators',
      sort_direction: 'asc',
    });
    expect(isServerSortable('power')).toBe(true);
    expect(isServerSortable('delegators')).toBe(true);
  });

  it('refuses to push a column the endpoint cannot really order', () => {
    // `/api/dreps` answers an unrecognised `sort_by` with HTTP 200 and its own
    // default order — verified against mainnet. So a key with no server
    // equivalent must produce NO parameter, never a hopeful pass-through: a
    // header would otherwise sit above an order nobody applied.
    for (const key of ['participation', 'rationale', 'lastVote'] as const) {
      expect(serverSortFor({ key, dir: 'desc' })).toBeNull();
      expect(isServerSortable(key)).toBe(false);
      expect(SERVER_SORT_BY[key]).toBeNull();
    }
  });

  it('never maps last-vote to the endpoint`s vote COUNT sort', () => {
    // `sort_by=votes` exists upstream and orders by how many votes were cast.
    // This column shows WHEN the last one was. Wiring them together would trade
    // a page-local lie for a register-wide one.
    expect(Object.values(SERVER_SORT_BY)).not.toContain('votes');
  });

  it('has an explicit answer for every sortable column', () => {
    // A key added to SORTABLE_KEYS without a decision here would fall through as
    // `undefined`, which `serverSortFor` would read as "client side" by accident
    // rather than by choice.
    for (const key of SORTABLE_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(SERVER_SORT_BY, key)).toBe(true);
    }
  });

  it('leaves the arriving order to nobody: the default is never pushed', () => {
    // Participation is the default AND client-computed, so the first request the
    // page makes carries no `sort_by` at all. The server therefore never gets to
    // choose the order a user sees first.
    expect(serverSortFor(DEFAULT_SORT)).toBeNull();
  });
});

describe('DRep directory: header toggling', () => {
  it('flips direction when the active column is clicked again', () => {
    const first = nextSort(DEFAULT_SORT, 'participation');
    expect(first).toEqual({ key: 'participation', dir: 'asc' });
    expect(nextSort(first, 'participation')).toEqual({ key: 'participation', dir: 'desc' });
  });

  it('takes over at descending when another column is clicked', () => {
    const ascending: SortState = { key: 'participation', dir: 'asc' };
    expect(nextSort(ascending, 'power')).toEqual({ key: 'power', dir: 'desc' });
    expect(nextSort({ key: 'power', dir: 'asc' }, 'delegators')).toEqual({
      key: 'delegators',
      dir: 'desc',
    });
  });

  it('never produces an unsorted state', () => {
    // Twelve clicks around the header row: every result is still a real order.
    let state: SortState = { ...DEFAULT_SORT };
    for (const key of [...SORTABLE_KEYS, ...SORTABLE_KEYS, ...SORTABLE_KEYS.slice(0, 2)]) {
      state = nextSort(state, key);
      expect(SORTABLE_KEYS).toContain(state.key);
      expect(['asc', 'desc']).toContain(state.dir);
    }
  });

  it('announces a direction on the active column only', () => {
    const state: SortState = { key: 'power', dir: 'asc' };
    expect(ariaSortFor(state, 'power')).toBe('ascending');
    expect(ariaSortFor({ key: 'power', dir: 'desc' }, 'power')).toBe('descending');
    expect(ariaSortFor(state, 'participation')).toBe('none');
  });
});

describe('DRep directory: the comparator', () => {
  it('orders voting power with BigInt precision', () => {
    // These two differ by 1 lovelace and are both far above 2^53. Number()
    // collapses them to the same double, so a lossy comparator returns the
    // input order and the tie-break never runs.
    const rows = [
      row('a-smaller', { power: 90_071_992_547_409_920n }),
      row('b-bigger', { power: 90_071_992_547_409_921n }),
    ];
    expect(order(sortDirectory(rows, { key: 'power', dir: 'desc' }))).toEqual([
      'b-bigger',
      'a-smaller',
    ]);
    expect(order(sortDirectory(rows, { key: 'power', dir: 'asc' }))).toEqual([
      'a-smaller',
      'b-bigger',
    ]);
  });

  it('breaks ties on the row key, never on power', () => {
    // Same participation, wildly different power. A power tie-break would put
    // the whale first; the credential order puts "aaa" first.
    const rows = [
      row('zzz', { participation: 60, power: 5_000_000_000n }),
      row('aaa', { participation: 60, power: 1n }),
    ];
    expect(order(sortDirectory(rows, DEFAULT_SORT))).toEqual(['aaa', 'zzz']);
  });

  it('sorts unknown figures last in BOTH directions', () => {
    const rows = [
      row('pending', { participation: null }),
      row('low', { participation: 10 }),
      row('high', { participation: 90 }),
    ];
    expect(order(sortDirectory(rows, { key: 'participation', dir: 'desc' }))).toEqual([
      'high',
      'low',
      'pending',
    ]);
    // Ascending puts the WORST real figure first — not the absent one.
    expect(order(sortDirectory(rows, { key: 'participation', dir: 'asc' }))).toEqual([
      'low',
      'high',
      'pending',
    ]);
  });

  it('orders every other column in both directions', () => {
    const rows = [
      row('mid', { rationale: 50, delegators: 50, lastVote: 500 }),
      row('top', { rationale: 90, delegators: 900, lastVote: 900 }),
      row('bottom', { rationale: 10, delegators: 10, lastVote: 100 }),
    ];
    for (const key of ['rationale', 'delegators', 'lastVote'] as const) {
      expect(order(sortDirectory(rows, { key, dir: 'desc' }))).toEqual(['top', 'mid', 'bottom']);
      expect(order(sortDirectory(rows, { key, dir: 'asc' }))).toEqual(['bottom', 'mid', 'top']);
    }
  });

  it('never mutates the page it was handed', () => {
    const rows = [row('b', { participation: 10 }), row('a', { participation: 90 })];
    const before = order(rows);
    sortDirectory(rows, { key: 'power', dir: 'asc' });
    expect(order(rows)).toEqual(before);
  });
});

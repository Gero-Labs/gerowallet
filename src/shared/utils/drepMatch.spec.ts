import { describe, it, expect } from 'vitest';
import { drepMatch } from '@/shared/utils/drepMatch';
import type { DRepRecord, DRepVoteRecord } from '@/shared/utils/drepStats';
import { compareLovelace } from '@/shared/utils/lovelace';

/**
 * The matcher is the one module where a subtle product failure would be a
 * betrayal rather than a bug: quietly ordering DReps by voting power turns a
 * neutral tool into an advertisement for whales. Two tests below exist purely
 * to make that regression impossible to land — `is independent of the input
 * ordering` and `two seeds order the same pool differently`.
 */

const vote = (over: Partial<DRepVoteRecord> = {}): DRepVoteRecord => ({
  proposal_id: 'p1',
  proposal_tx_hash: 'aa'.repeat(32),
  proposal_index: 0,
  vote_tx_hash: 'bb'.repeat(32),
  block_time: 1_700_000_000,
  vote: 'Yes',
  meta_url: null,
  meta_hash: null,
  ...over,
});

/** Unique 56-char credential hex per index, so every fixture has a distinct identity. */
const hexFor = (index: number) => index.toString(16).padStart(2, '0').repeat(28);

interface FixtureOptions {
  index: number;
  /** How many of the four eligible actions this DRep voted on. */
  votedOf4?: number;
  /** How many of those votes carry a rationale link. */
  withRationale?: number;
  amount?: string;
  active?: boolean;
}

const ELIGIBLE = ['t1', 't2', 'p1', 'p2'];
const TYPES: Record<string, string> = {
  t1: 'TreasuryWithdrawals',
  t2: 'TreasuryWithdrawals',
  p1: 'ParameterChange',
  p2: 'ParameterChange',
};

const context = {
  eligibleActionIds: ELIGIBLE,
  typeResolver: (id: string) => TYPES[id] ?? null,
  activeDRepPower: '1000000000000',
  topNCutoffPower: '100000000000',
};

function fixture({
  index,
  votedOf4 = 4,
  withRationale = 4,
  amount = '1000000',
  active = true,
}: FixtureOptions): DRepRecord {
  const votes = ELIGIBLE.slice(0, votedOf4).map((proposalId, i) =>
    vote({
      proposal_id: proposalId,
      meta_url: i < withRationale ? `https://example.org/${proposalId}.json` : null,
    }),
  );
  return {
    drep_id: null,
    hex: hexFor(index),
    has_script: false,
    registered: true,
    deposit: '500000000',
    active,
    expires_epoch_no: 620,
    amount,
    url: null,
    hash: null,
    votes,
    metadata: null,
    delegators: [],
  };
}

/** Ten identical-behaviour DReps that differ only in identity and in power. */
const pool = Array.from({ length: 10 }, (_, i) =>
  fixture({ index: i + 1, amount: String((i + 1) * 1_000_000) }),
);

const keysOf = (result: { matches: { stats: { credentialHex: string | null } }[] }) =>
  result.matches.map(m => m.stats.credentialHex);

describe('drepMatch — criteria are boolean pass or fail', () => {
  it('passes a DRep that clears every criterion', () => {
    const result = drepMatch(
      { participationMin: 80, rationaleMin: 60, focusArea: 'TreasuryWithdrawals', outsideTopN: true, excludeInactive: true },
      [fixture({ index: 1 })],
      { seed: 'seed', ...context },
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].failing).toEqual([]);
    expect(result.poolSize).toBe(1);
  });

  it('fails participation below the floor and names the criterion', () => {
    const result = drepMatch(
      { participationMin: 80 },
      [fixture({ index: 1, votedOf4: 2 })],
      { seed: 'seed', ...context },
    );
    expect(result.matches).toHaveLength(0);
    expect(result.nearMisses[0].failing).toEqual(['participationMin']);
  });

  it('fails a rationale rate below the floor', () => {
    const result = drepMatch(
      { rationaleMin: 60 },
      [fixture({ index: 1, withRationale: 1 })],
      { seed: 'seed', ...context },
    );
    expect(result.nearMisses[0].failing).toEqual(['rationaleMin']);
  });

  it('fails a focus area the DRep never voted on', () => {
    const result = drepMatch(
      { focusArea: 'HardForkInitiation' },
      [fixture({ index: 1 })],
      { seed: 'seed', ...context },
    );
    expect(result.matches).toHaveLength(0);
    expect(result.nearMisses[0].failing).toEqual(['focusArea']);
  });

  it('matches a focus area case-insensitively', () => {
    const result = drepMatch(
      { focusArea: 'treasurywithdrawals' },
      [fixture({ index: 1 })],
      { seed: 'seed', ...context },
    );
    expect(result.matches).toHaveLength(1);
  });

  it('fails outsideTopN for a DRep at or above the cutoff', () => {
    const big = fixture({ index: 1, amount: '900000000000' });
    const result = drepMatch({ outsideTopN: true }, [big], { seed: 'seed', ...context });
    expect(result.matches).toHaveLength(0);
    expect(result.nearMisses[0].failing).toEqual(['outsideTopN']);
  });

  it('fails excludeInactive for a retired DRep', () => {
    const result = drepMatch(
      { excludeInactive: true },
      [fixture({ index: 1, active: false })],
      { seed: 'seed', ...context },
    );
    expect(result.nearMisses[0].failing).toEqual(['excludeInactive']);
  });

  it('matches everyone when no criterion is set', () => {
    const result = drepMatch({}, pool, { seed: 'seed', ...context });
    expect(result.matches).toHaveLength(10);
    expect(result.activeCriteria).toEqual([]);
    expect(result.nearMisses).toHaveLength(0);
  });

  it('fails — rather than silently passes — a criterion it has no data to judge', () => {
    // No typeResolver, so focus areas are unknown. Unknown must never read as a pass.
    const result = drepMatch({ focusArea: 'TreasuryWithdrawals' }, [fixture({ index: 1 })], {
      seed: 'seed',
      eligibleActionIds: ELIGIBLE,
    });
    expect(result.matches).toHaveLength(0);
    expect(result.nearMisses[0].failing).toEqual(['focusArea']);
  });

  it('reports every failing criterion, not just the first', () => {
    const result = drepMatch(
      { participationMin: 90, rationaleMin: 90, excludeInactive: true },
      [fixture({ index: 1, votedOf4: 1, withRationale: 0, active: false })],
      { seed: 'seed', ...context },
    );
    expect(result.nearMisses[0].failing).toEqual(['participationMin', 'rationaleMin', 'excludeInactive']);
  });
});

describe('drepMatch — neutrality', () => {
  it('is independent of the input ordering, including by descending power', () => {
    const byPowerDesc = [...pool].sort((a, b) => compareLovelace(b.amount, a.amount));
    const byPowerAsc = [...byPowerDesc].reverse();

    const asGiven = keysOf(drepMatch({}, pool, { seed: 'stake1abc:epoch580', ...context }));
    const descending = keysOf(drepMatch({}, byPowerDesc, { seed: 'stake1abc:epoch580', ...context }));
    const ascending = keysOf(drepMatch({}, byPowerAsc, { seed: 'stake1abc:epoch580', ...context }));

    expect(descending).toEqual(asGiven);
    expect(ascending).toEqual(asGiven);
  });

  it('does not order the pool by voting power', () => {
    const powers = drepMatch({}, pool, { seed: 'stake1abc:epoch580', ...context }).matches.map(m =>
      m.stats.votingPower,
    );
    const descending = [...powers].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    expect(powers).not.toEqual(descending);
  });

  it('gives two seeds different orders of the same pool', () => {
    const a = keysOf(drepMatch({}, pool, { seed: 'stake1aaa:epoch580', ...context }));
    const b = keysOf(drepMatch({}, pool, { seed: 'stake1bbb:epoch580', ...context }));
    expect(a).not.toEqual(b);
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('gives the same seed the same order every time', () => {
    const a = keysOf(drepMatch({}, pool, { seed: 'stake1aaa:epoch580', ...context }));
    const b = keysOf(drepMatch({}, pool, { seed: 'stake1aaa:epoch580', ...context }));
    expect(a).toEqual(b);
  });

  it('reshuffles when the epoch half of the seed rolls over', () => {
    const before = keysOf(drepMatch({}, pool, { seed: 'stake1aaa:epoch580', ...context }));
    const after = keysOf(drepMatch({}, pool, { seed: 'stake1aaa:epoch581', ...context }));
    expect(after).not.toEqual(before);
  });

  it('accepts a bare seed string in place of an options object', () => {
    const a = keysOf(drepMatch({}, pool, 'plain-seed'));
    const b = keysOf(drepMatch({}, pool, { seed: 'plain-seed' }));
    expect(a).toEqual(b);
  });
});

describe('drepMatch — near misses', () => {
  it('separates DReps failing exactly one criterion from full matches', () => {
    const records = [
      fixture({ index: 1 }),
      fixture({ index: 2, votedOf4: 2 }),
      fixture({ index: 3 }),
    ];
    const result = drepMatch({ participationMin: 80, rationaleMin: 50 }, records, {
      seed: 'seed',
      ...context,
    });
    expect(result.matches).toHaveLength(2);
    expect(result.poolSize).toBe(2);
    expect(result.nearMisses).toHaveLength(1);
    expect(result.nearMisses[0].stats.credentialHex).toBe(hexFor(2));
  });

  it('carries the stats alongside the record so the UI needs no second pass', () => {
    const result = drepMatch({ participationMin: 80 }, [fixture({ index: 1 })], {
      seed: 'seed',
      ...context,
    });
    expect(result.matches[0].record.hex).toBe(hexFor(1));
    expect(result.matches[0].stats.participation.pct).toBe(100);
  });
});

describe('drepMatch — malformed input', () => {
  it('skips unusable records, counts them, and never throws', () => {
    const result = drepMatch({}, [fixture({ index: 1 }), null, 'drep1abc', { amount: '1' }] as unknown[], {
      seed: 'seed',
      ...context,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.skipped).toBe(3);
  });

  it('returns an empty result for a non-array record list', () => {
    const result = drepMatch({}, null as unknown as unknown[], { seed: 'seed' });
    expect(result.matches).toEqual([]);
    expect(result.poolSize).toBe(0);
    expect(result.skipped).toBe(0);
  });
});

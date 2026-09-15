import { describe, it, expect } from 'vitest';
import { drepStats, type DRepRecord, type DRepVoteRecord } from '@/shared/utils/drepStats';

/**
 * Fixtures mirror the LIVE gero-backend `/api/dreps` shape (snake_case), verified
 * against mainnet on 2026-08-23. Two facts from that capture drive several tests:
 *  - `amount` and `deposit` are decimal STRINGS, and stake sums exceed 2^53.
 *  - the same `proposal_id` appears more than once with different `vote_tx_hash`
 *    (a DRep changing its vote) on 4 of the 20 records on page 1.
 */

const vote = (over: Partial<DRepVoteRecord> = {}): DRepVoteRecord => ({
  proposal_id: 'gov_action1aaa',
  proposal_tx_hash: 'aa'.repeat(32),
  proposal_index: 0,
  vote_tx_hash: 'bb'.repeat(32),
  block_time: 1_700_000_000,
  vote: 'Yes',
  meta_url: null,
  meta_hash: null,
  ...over,
});

const record = (over: Partial<DRepRecord> = {}): DRepRecord => ({
  drep_id: 'drep1ygxxgq3hw7yqxe94ndl6sqkkdlrpudlnrstj7a7654y66csnkd9tu',
  hex: '0c'.repeat(28),
  has_script: false,
  registered: true,
  deposit: '500000000',
  active: true,
  expires_epoch_no: 620,
  amount: '20151607590',
  url: null,
  hash: null,
  votes: [],
  metadata: null,
  delegators: [],
  ...over,
});

describe('drepStats — malformed input', () => {
  it('returns null instead of throwing for non-object input', () => {
    expect(drepStats(null)).toBeNull();
    expect(drepStats(undefined)).toBeNull();
    expect(drepStats('drep1abc' as unknown)).toBeNull();
    expect(drepStats(42 as unknown)).toBeNull();
  });

  it('returns null for a record carrying no identifier at all', () => {
    expect(drepStats({ amount: '1', votes: [] })).toBeNull();
  });

  it('accepts a record identified only by hex', () => {
    const stats = drepStats({ hex: '0a'.repeat(28), amount: '1' });
    expect(stats).not.toBeNull();
    expect(stats?.credentialHex).toBe('0a'.repeat(28));
  });

  it('survives a votes field that is not an array', () => {
    const stats = drepStats(record({ votes: 'nope' as unknown as [] }));
    expect(stats?.votePattern.total).toBe(0);
    expect(stats?.participation.state).toBe('pending');
  });
});

describe('drepStats — participation', () => {
  it('reports voted over the caller-supplied eligible count', () => {
    const stats = drepStats(
      record({
        votes: [
          vote({ proposal_id: 'p1' }),
          vote({ proposal_id: 'p2' }),
          vote({ proposal_id: 'p3' }),
        ],
      }),
      { totalEligibleActions: 4 },
    );
    expect(stats?.participation.numerator).toBe(3);
    expect(stats?.participation.denominator).toBe(4);
    expect(stats?.participation.pct).toBe(75);
    expect(stats?.participation.state).toBe('ok');
  });

  it('is pending — not 0% — when no action was eligible', () => {
    const stats = drepStats(record({ votes: [vote()] }), { totalEligibleActions: 0 });
    expect(stats?.participation.state).toBe('pending');
    expect(stats?.participation.pct).toBeNull();
  });

  it('is pending when the caller supplies no eligible count at all', () => {
    const stats = drepStats(record({ votes: [vote()] }));
    expect(stats?.participation.state).toBe('pending');
    expect(stats?.participation.pct).toBeNull();
  });

  it('counts only votes inside the eligible id set when one is supplied', () => {
    const stats = drepStats(
      record({ votes: [vote({ proposal_id: 'p1' }), vote({ proposal_id: 'outside' })] }),
      { eligibleActionIds: ['p1', 'p2', 'p3'] },
    );
    expect(stats?.participation.numerator).toBe(1);
    expect(stats?.participation.denominator).toBe(3);
  });

  it('never exceeds 100% when the DRep voted on more actions than the supplied window', () => {
    const stats = drepStats(
      record({ votes: [vote({ proposal_id: 'p1' }), vote({ proposal_id: 'p2' })] }),
      { totalEligibleActions: 1 },
    );
    expect(stats?.participation.pct).toBe(100);
    expect(stats?.participation.numerator).toBe(1);
  });
});

describe('drepStats — vote de-duplication', () => {
  const changedVote = record({
    votes: [
      vote({ proposal_id: 'p1', vote: 'Yes', block_time: 1_738_263_517, vote_tx_hash: 'old' }),
      vote({ proposal_id: 'p1', vote: 'No', block_time: 1_738_264_729, vote_tx_hash: 'new' }),
    ],
  });

  it('counts a re-vote on the same proposal once', () => {
    const stats = drepStats(changedVote, { totalEligibleActions: 1 });
    expect(stats?.participation.numerator).toBe(1);
    expect(stats?.votePattern.total).toBe(1);
  });

  it('keeps the latest vote by block_time', () => {
    const stats = drepStats(changedVote, { totalEligibleActions: 1 });
    expect(stats?.votePattern.no).toBe(1);
    expect(stats?.votePattern.yes).toBe(0);
  });

  it('uses the latest revision when scoring the rationale rate', () => {
    const stats = drepStats(
      record({
        votes: [
          vote({ proposal_id: 'p1', block_time: 10, meta_url: 'https://example.org/r.json' }),
          vote({ proposal_id: 'p1', block_time: 20, meta_url: null }),
        ],
      }),
    );
    expect(stats?.rationaleRate.numerator).toBe(0);
    expect(stats?.rationaleRate.denominator).toBe(1);
  });
});

describe('drepStats — rationale rate', () => {
  it('scores votes carrying a meta_url over all cast votes', () => {
    const stats = drepStats(
      record({
        votes: [
          vote({ proposal_id: 'p1', meta_url: 'https://example.org/1.json' }),
          vote({ proposal_id: 'p2', meta_url: 'https://example.org/2.json' }),
          vote({ proposal_id: 'p3', meta_url: null }),
          vote({ proposal_id: 'p4', meta_url: '   ' }),
        ],
      }),
    );
    expect(stats?.rationaleRate.numerator).toBe(2);
    expect(stats?.rationaleRate.denominator).toBe(4);
    expect(stats?.rationaleRate.pct).toBe(50);
  });

  it('is pending — not 0% — for a DRep that has never voted', () => {
    const stats = drepStats(record({ votes: [] }));
    expect(stats?.rationaleRate.state).toBe('pending');
    expect(stats?.rationaleRate.pct).toBeNull();
  });
});

describe('drepStats — vote pattern', () => {
  it('splits the DRep own votes into yes / no / abstain percentages', () => {
    const stats = drepStats(
      record({
        votes: [
          vote({ proposal_id: 'p1', vote: 'Yes' }),
          vote({ proposal_id: 'p2', vote: 'Yes' }),
          vote({ proposal_id: 'p3', vote: 'No' }),
          vote({ proposal_id: 'p4', vote: 'Abstain' }),
        ],
      }),
    );
    expect(stats?.votePattern).toMatchObject({ yes: 2, no: 1, abstain: 1, total: 4 });
    expect(stats?.votePattern.yesPct).toBe(50);
    expect(stats?.votePattern.noPct).toBe(25);
    expect(stats?.votePattern.abstainPct).toBe(25);
  });

  it('accepts the choice in any casing the indexer emits', () => {
    const stats = drepStats(
      record({ votes: [vote({ proposal_id: 'p1', vote: 'yes' }), vote({ proposal_id: 'p2', vote: 'ABSTAIN' })] }),
    );
    expect(stats?.votePattern).toMatchObject({ yes: 1, abstain: 1, total: 2 });
  });

  it('leaves the percentages null when nothing was voted', () => {
    const stats = drepStats(record({ votes: [] }));
    expect(stats?.votePattern.yesPct).toBeNull();
  });

  it('skips malformed vote rows and counts them', () => {
    const stats = drepStats(
      record({
        votes: [
          vote({ proposal_id: 'p1', vote: 'Yes' }),
          { proposal_id: 'p2', vote: 'Maybe' } as never,
          { vote: 'Yes' } as never,
          null as never,
        ],
      }),
    );
    expect(stats?.votePattern.total).toBe(1);
    expect(stats?.skippedVotes).toBe(3);
  });
});

describe('drepStats — focus areas', () => {
  const voted = record({
    votes: [
      vote({ proposal_id: 'treasury-1' }),
      vote({ proposal_id: 'treasury-2' }),
      vote({ proposal_id: 'param-1' }),
      vote({ proposal_id: 'unknown-1' }),
    ],
  });

  const types: Record<string, string> = {
    'treasury-1': 'TreasuryWithdrawals',
    'treasury-2': 'TreasuryWithdrawals',
    'param-1': 'ParameterChange',
    'treasury-3': 'TreasuryWithdrawals',
  };
  const typeResolver = (id: string) => types[id] ?? null;

  it('returns null — never a guess — when no type resolver is supplied', () => {
    expect(drepStats(voted)?.focusAreas).toBeNull();
  });

  it('groups the DRep votes by governance action type', () => {
    const areas = drepStats(voted, { typeResolver })?.focusAreas;
    expect(areas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'TreasuryWithdrawals', voted: 2 }),
        expect.objectContaining({ type: 'ParameterChange', voted: 1 }),
      ]),
    );
  });

  it('drops votes whose proposal type the resolver cannot resolve', () => {
    const areas = drepStats(voted, { typeResolver })?.focusAreas ?? [];
    const total = areas.reduce((sum, a) => sum + a.voted, 0);
    expect(total).toBe(3);
  });

  it('leaves the per-type eligible count null when the eligible set is unknown', () => {
    const areas = drepStats(voted, { typeResolver })?.focusAreas ?? [];
    expect(areas.every(a => a.eligible === null)).toBe(true);
  });

  it('reports voted / eligible per type once the eligible id set is supplied', () => {
    const areas = drepStats(voted, {
      typeResolver,
      eligibleActionIds: ['treasury-1', 'treasury-2', 'treasury-3', 'param-1'],
    })?.focusAreas ?? [];
    expect(areas).toEqual(
      expect.arrayContaining([
        { type: 'TreasuryWithdrawals', voted: 2, eligible: 3 },
        { type: 'ParameterChange', voted: 1, eligible: 1 },
      ]),
    );
  });

  it('lists a type the DRep skipped entirely as 0 of N', () => {
    const areas = drepStats(record({ votes: [] }), {
      typeResolver,
      eligibleActionIds: ['treasury-1', 'treasury-3'],
    })?.focusAreas ?? [];
    expect(areas).toEqual([{ type: 'TreasuryWithdrawals', voted: 0, eligible: 2 }]);
  });
});

describe('drepStats — voting power', () => {
  it('parses lovelace as BigInt without precision loss', () => {
    const stats = drepStats(record({ amount: '25000000000000001' }));
    expect(stats?.votingPower).toBe(25000000000000001n);
  });

  it('computes the share of active power in BigInt', () => {
    const stats = drepStats(record({ amount: '25000000000000000' }), {
      activeDRepPower: '100000000000000000',
    });
    expect(stats?.shareOfActivePower).toBe(25);
  });

  it('returns a null share — not 0% — when the denominator is unknown', () => {
    expect(drepStats(record())?.shareOfActivePower).toBeNull();
    expect(drepStats(record(), { activeDRepPower: '0' })?.shareOfActivePower).toBeNull();
  });

  it('buckets rank against the cutoff, inclusive of the boundary', () => {
    const ctx = { topNCutoffPower: '1000' };
    expect(drepStats(record({ amount: '1001' }), ctx)?.powerRankBucket).toBe('topN');
    expect(drepStats(record({ amount: '1000' }), ctx)?.powerRankBucket).toBe('topN');
    expect(drepStats(record({ amount: '999' }), ctx)?.powerRankBucket).toBe('outsideTopN');
  });

  it('leaves the bucket null when no cutoff is supplied', () => {
    expect(drepStats(record({ amount: '1' }))?.powerRankBucket).toBeNull();
  });
});

describe('drepStats — delegators and recency', () => {
  it('counts the delegators array', () => {
    const stats = drepStats(
      record({ delegators: [{ stake_address: 'stake1a', amount: '1', epoch_no: 544 }] }),
    );
    expect(stats?.delegatorCount).toBe(1);
  });

  it('returns a null count — not 0 — when the endpoint omitted delegators', () => {
    expect(drepStats(record({ delegators: null }))?.delegatorCount).toBeNull();
  });

  it('reports the most recent vote timestamp', () => {
    const stats = drepStats(
      record({
        votes: [
          vote({ proposal_id: 'p1', block_time: 1_732_210_548 }),
          vote({ proposal_id: 'p2', block_time: 1_739_780_045 }),
        ],
      }),
    );
    expect(stats?.lastVoteBlockTime).toBe(1_739_780_045);
  });

  it('reports a null timestamp for a DRep that never voted', () => {
    expect(drepStats(record({ votes: [] }))?.lastVoteBlockTime).toBeNull();
  });
});

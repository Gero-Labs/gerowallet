import { describe, it, expect } from 'vitest';
import {
  activeCommitteeSize,
  ccProgress,
  ccTallies,
  composition,
  drepTallies,
  spoTallies,
} from '@/shared/utils/govTally';
import type { Committee, GovVotingSummary } from '@/api/governance.types';

describe('composition', () => {
  it('denominates over yes+no only — abstain is excluded, not counted against', () => {
    const c = composition('60', '40', '900');
    expect(c.yesPct).toBe(60);
    expect(c.noPct).toBe(40);
    expect(c.available).toBe(true);
  });

  it('is exact past MAX_SAFE_INTEGER', () => {
    const c = composition('16000000000000000', '9000000000000000', null);
    expect(c.yesPct).toBeCloseTo(64, 1);
  });

  it('reports unavailable when both sides are null rather than showing 0%', () => {
    const c = composition(null, null, null);
    expect(c.available).toBe(false);
    expect(c.yesPct).toBeNull();
    expect(c.noPct).toBeNull();
  });

  it('reports unavailable when eligible power is zero — nobody has voted yet', () => {
    const c = composition('0', '0', '500');
    expect(c.available).toBe(false);
    expect(c.yesPct).toBeNull();
  });

  it('treats a present zero on one side as real data', () => {
    const c = composition('100', '0', null);
    expect(c.available).toBe(true);
    expect(c.yesPct).toBe(100);
    expect(c.noPct).toBe(0);
  });
});

describe('drepTallies', () => {
  const summary = {
    yesVotePower: '60',
    noVotePower: '40',
    abstainVotePower: null,
    yesPct: null,
    noPct: null,
  } as unknown as GovVotingSummary;

  it('prefers locally computed shares over the server-supplied pct', () => {
    expect(drepTallies(summary).yesPct).toBe(60);
  });

  it('falls back to the server pct when the power fields are missing', () => {
    const partial = { yesVotePower: null, noVotePower: null, yesPct: 71.5, noPct: 28.5 } as unknown as GovVotingSummary;
    const t = drepTallies(partial);
    expect(t.yesPct).toBe(71.5);
    expect(t.available).toBe(true);
  });

  it('is unavailable when neither powers nor pcts are present', () => {
    expect(drepTallies({} as GovVotingSummary).available).toBe(false);
  });
});

describe('spoTallies', () => {
  it('uses the spo* power fields', () => {
    const s = { spoYesVotePower: '30', spoNoVotePower: '70' } as unknown as GovVotingSummary;
    expect(spoTallies(s).yesPct).toBe(30);
  });

  it('is unavailable when the SPO fields are absent', () => {
    expect(spoTallies({} as GovVotingSummary).available).toBe(false);
  });
});

describe('composition yesShare', () => {
  it('keeps the unrounded share for threshold checks while yesPct is rounded for display', () => {
    // 66.996%: displays as 67.00, and must still read as BELOW a 67% threshold.
    const c = composition('66996', '33004', null);
    expect(c.yesPct).toBe(67);
    expect(c.yesShare).toBeCloseTo(66.996, 6);
    expect(c.yesShare as number).toBeLessThan(67);
  });
});

/**
 * The mainnet committee on 2026-09-24: seven seats, quorum 2/3, every member
 * with an authorised hot key (Nexus sends `hotHashes` for each of them).
 */
function committee(members: Partial<Committee['members'][number]>[] = []): Committee {
  const seat = { hash: 'h', credType: 'SCRIPTHASH', startEpoch: 581, expiredEpoch: 726, hotHashes: ['hot'] };
  const seats = members.length ? members : Array.from({ length: 7 }, () => ({}));
  return {
    thresholdNumerator: 2,
    thresholdDenominator: 3,
    members: seats.map((over, i) => ({ ...seat, hash: `h${i}`, ...over })),
  };
}

/** The live summary for 418df598…#0: counts right, pct divided by 14. */
const LIVE_CC = { ccYesVotes: 2, ccNoVotes: 0, ccAbstainVotes: 0, ccYesPct: 14.29, ccNoPct: 85.71 } as GovVotingSummary;

describe('activeCommitteeSize', () => {
  it('counts the seats that can vote in the epoch', () => {
    expect(activeCommitteeSize(committee(), 657)).toBe(7);
  });

  it('leaves out expired and not-yet-seated members, and a member with no hot key', () => {
    const c = committee([{}, { expiredEpoch: 650 }, { startEpoch: 700 }, { hotHashes: [] }, { hotHashes: ['x'] }]);
    expect(activeCommitteeSize(c, 657)).toBe(2);
  });

  it('is unknown without a committee or an epoch', () => {
    expect(activeCommitteeSize(null, 657)).toBeNull();
    expect(activeCommitteeSize(committee(), null)).toBeNull();
  });

  it('is unknown when Nexus omits hotHashes for a seated member, rather than counting it eligible', () => {
    // The Nexus contract: no known authorisation => the field is left out, never [].
    const sixAuthorised = committee([{}, {}, {}, {}, {}, {}, { hotHashes: undefined }]);
    expect(activeCommitteeSize(sixAuthorised, 657)).toBeNull();
    // An expired or not-yet-seated member without the field does not block the count.
    expect(activeCommitteeSize(committee([{}, {}, { expiredEpoch: 650, hotHashes: undefined }]), 657)).toBe(2);
  });
});

describe('ccTallies', () => {
  it('derives the share from the counts over the active seats, not the server pct', () => {
    const c = ccTallies(LIVE_CC, 7);
    // Two of seven, as api.koios.rest reports it; the five silent seats count against.
    expect(c.yesPct).toBe(28.57);
    expect(c.noPct).toBe(71.43);
    expect(c.available).toBe(true);
  });

  it('takes abstentions out of the denominator', () => {
    const c = ccTallies({ ccYesVotes: 4, ccNoVotes: 0, ccAbstainVotes: 1 } as GovVotingSummary, 7);
    expect(c.yesPct).toBe(66.67);
    // An exact 4-of-6 tie must compare EQUAL to a 2/3 quorum computed the same way.
    expect(c.yesShare).toBe((2 / 3) * 100);
  });

  it('falls back to the server pct when the seat count is unknown or cannot hold the votes', () => {
    expect(ccTallies(LIVE_CC, null).yesPct).toBe(14.29);
    expect(ccTallies({ ...LIVE_CC, ccYesVotes: 9 }, 7).yesPct).toBe(14.29);
  });

  it('uses the server share, not 4 of 7, when one seated member has no known hot key', () => {
    // Independent-review reproduction: six authorised, one omitted, four yes.
    // Over the unsupported 7 seats this read 57.14% and missed a 2/3 quorum;
    // the ledger's own denominator is 6, which the server share reflects.
    const summary = { ccYesVotes: 4, ccNoVotes: 0, ccAbstainVotes: 0, ccYesPct: 66.67, ccNoPct: 33.33 } as GovVotingSummary;
    const seats = activeCommitteeSize(committee([{}, {}, {}, {}, {}, {}, { hotHashes: undefined }]), 657);
    expect(ccTallies(summary, seats)).toMatchObject({ yesPct: 66.67, available: true });
    expect(ccProgress(summary, 2, 3, seats)).toMatchObject({ notVoted: null });
  });

  it('is unavailable with nothing to go on', () => {
    expect(ccTallies(null, 7).available).toBe(false);
    expect(ccTallies({} as GovVotingSummary, null).available).toBe(false);
  });
});

describe('ccProgress', () => {
  it('reads the quorum from the committee and counts the silent seats', () => {
    const progress = ccProgress(LIVE_CC, 2, 3, 7);
    expect(progress).toMatchObject({ yes: 2, no: 0, abstain: 0, notVoted: 5 });
    expect(progress?.requiredPct).toBeCloseTo(66.667, 3);
  });

  it('leaves the quorum and the silent seats unknown when not given', () => {
    expect(ccProgress(LIVE_CC, null, null)).toMatchObject({ requiredPct: null, notVoted: null });
  });
});

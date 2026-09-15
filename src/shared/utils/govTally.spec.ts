import { describe, it, expect } from 'vitest';
import { composition, drepTallies, spoTallies } from '@/shared/utils/govTally';
import type { GovVotingSummary } from '@/api/governance.types';

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

import { describe, it, expect } from 'vitest';
import { votingBodies, evaluateThresholds, hasOnchainThreshold } from '@/shared/utils/govThresholds';
import type { GovThresholdParams } from '@/shared/utils/govThresholds';

// Realistic mainnet fractions. Every value is a fraction 0..1.
const PARAMS: GovThresholdParams = {
  dvtMotionNoConfidence: 0.67,
  dvtCommitteeNormal: 0.67,
  dvtCommitteeNoConfidence: 0.6,
  dvtUpdateConstitution: 0.75,
  dvtHardFork: 0.6,
  dvtPpNetwork: 0.67,
  dvtPpEconomic: 0.67,
  dvtPpTechnical: 0.67,
  dvtPpGov: 0.75,
  dvtTreasuryWithdrawal: 0.67,
  pvtMotionNoConfidence: 0.51,
  pvtCommitteeNormal: 0.51,
  pvtCommitteeNoConfidence: 0.51,
  pvtHardFork: 0.51,
  pvtSecurityGroup: 0.51,
  committeeMinSize: 5,
};

describe('hasOnchainThreshold', () => {
  it('is false only for InfoAction', () => {
    expect(hasOnchainThreshold('InfoAction')).toBe(false);
    for (const t of ['NoConfidence', 'NewCommittee', 'NewConstitution', 'HardForkInitiation', 'TreasuryWithdrawals', 'ParameterChange']) {
      expect(hasOnchainThreshold(t), t).toBe(true);
    }
  });
});

describe('votingBodies', () => {
  it('NoConfidence: DRep + SPO, no committee', () => {
    expect(votingBodies('NoConfidence', PARAMS)).toEqual([
      { body: 'DRep', thresholdPct: 67 },
      { body: 'SPO', thresholdPct: 51 },
    ]);
  });

  it('NewCommittee: DRep + SPO, no committee', () => {
    expect(votingBodies('NewCommittee', PARAMS).map(b => b.body)).toEqual(['DRep', 'SPO']);
  });

  it('NewConstitution: DRep + CC, no SPO', () => {
    expect(votingBodies('NewConstitution', PARAMS).map(b => b.body)).toEqual(['DRep', 'CC']);
  });

  it('TreasuryWithdrawals: DRep + CC, no SPO', () => {
    expect(votingBodies('TreasuryWithdrawals', PARAMS).map(b => b.body)).toEqual(['DRep', 'CC']);
  });

  it('HardForkInitiation: all three bodies', () => {
    expect(votingBodies('HardForkInitiation', PARAMS).map(b => b.body)).toEqual(['DRep', 'SPO', 'CC']);
  });

  it('InfoAction: nobody — it can never ratify', () => {
    expect(votingBodies('InfoAction', PARAMS)).toEqual([]);
  });

  it('ParameterChange uses the strictest threshold of the touched groups', () => {
    const bodies = votingBodies('ParameterChange', PARAMS, { groups: ['economic', 'gov'], touchesSecurity: false });
    // gov (0.75) is stricter than economic (0.67)
    expect(bodies).toEqual([{ body: 'DRep', thresholdPct: 75 }, { body: 'CC', thresholdPct: null }]);
  });

  it('ParameterChange adds the SPO row only when a security parameter is touched', () => {
    const bodies = votingBodies('ParameterChange', PARAMS, { groups: ['network'], touchesSecurity: true });
    expect(bodies.map(b => b.body)).toEqual(['DRep', 'SPO', 'CC']);
    expect(bodies.find(b => b.body === 'SPO')!.thresholdPct).toBe(51);
  });

  it('ParameterChange with an unavailable payload falls back to the strictest of all four groups and omits SPO', () => {
    const bodies = votingBodies('ParameterChange', PARAMS, null);
    expect(bodies.map(b => b.body)).toEqual(['DRep', 'CC']);
    expect(bodies.find(b => b.body === 'DRep')!.thresholdPct).toBe(75);
  });

  it('reports a null threshold when the protocol parameter is missing, rather than guessing', () => {
    const bodies = votingBodies('NoConfidence', { ...PARAMS, dvtMotionNoConfidence: undefined });
    expect(bodies.find(b => b.body === 'DRep')!.thresholdPct).toBeNull();
  });
});

describe('evaluateThresholds', () => {
  it('marks a body met when its yes-share reaches the threshold', () => {
    const result = evaluateThresholds('NoConfidence', PARAMS, { drepYesPct: 67, spoYesPct: 55, ccYesPct: null });
    expect(result.find(r => r.body === 'DRep')).toEqual({ body: 'DRep', thresholdPct: 67, yesPct: 67, met: true });
    expect(result.find(r => r.body === 'SPO')!.met).toBe(true);
  });

  it('marks a body not met just below the threshold', () => {
    const result = evaluateThresholds('NoConfidence', PARAMS, { drepYesPct: 66.99, spoYesPct: 10, ccYesPct: null });
    expect(result.find(r => r.body === 'DRep')!.met).toBe(false);
  });

  it('is never met when the threshold is unknown', () => {
    const result = evaluateThresholds(
      'NoConfidence',
      { ...PARAMS, dvtMotionNoConfidence: undefined },
      { drepYesPct: 99, spoYesPct: 99, ccYesPct: null },
    );
    expect(result.find(r => r.body === 'DRep')!.met).toBe(false);
  });

  it('is never met when the yes-share is unknown', () => {
    const result = evaluateThresholds('NoConfidence', PARAMS, { drepYesPct: null, spoYesPct: null, ccYesPct: null });
    expect(result.every(r => r.met === false)).toBe(true);
  });

  it('returns an empty list for InfoAction', () => {
    expect(evaluateThresholds('InfoAction', PARAMS, { drepYesPct: 100, spoYesPct: 100, ccYesPct: 100 })).toEqual([]);
  });
});

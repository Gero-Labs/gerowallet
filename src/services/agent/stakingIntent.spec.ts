// src/services/agent/stakingIntent.spec.ts
import { describe, it, expect } from 'vitest';
import { parseStakingIntent } from './stakingIntent';

describe('parseStakingIntent', () => {
  it('parses delegate-to-pool', () => {
    expect(parseStakingIntent('delegate to GERO')).toEqual({ type: 'delegate', poolSymbol: 'GERO' });
    expect(parseStakingIntent('stake with adapools')).toEqual({ type: 'delegate', poolSymbol: 'ADAPOOLS' });
  });
  it('parses claim-rewards', () => {
    expect(parseStakingIntent('claim my rewards')).toEqual({ type: 'claimRewards' });
    expect(parseStakingIntent('withdraw my staking rewards')).toEqual({ type: 'claimRewards' });
  });
  it('returns null otherwise', () => {
    expect(parseStakingIntent('what is my balance')).toBeNull();
    expect(parseStakingIntent('swap 1 ada for gero')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { validateAssembledUpdate } from './poolUpdateValidation';

const good = {
  witnessCount: 3, expectedWitnessCount: 3,
  vrf: 'd4'.repeat(16) + 'ab'.repeat(16), expectedVrf: 'd4'.repeat(16) + 'ab'.repeat(16),
  owners: ['stakeL'], expectedOwners: ['stakeL'],
};

describe('validateAssembledUpdate', () => {
  it('passes when everything matches', () => {
    expect(validateAssembledUpdate(good).ok).toBe(true);
  });
  it('fails on wrong VRF', () => {
    const r = validateAssembledUpdate({ ...good, vrf: '00'.repeat(32) });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/vrf/i);
  });
  it('fails on wrong owners', () => {
    const r = validateAssembledUpdate({ ...good, owners: ['stakeL', 'stakeX'] });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/owner/i);
  });
  it('fails on missing witness', () => {
    const r = validateAssembledUpdate({ ...good, witnessCount: 2 });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/witness/i);
  });
});

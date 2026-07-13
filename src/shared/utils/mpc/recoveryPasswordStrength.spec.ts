import { describe, it, expect } from 'vitest';
import {
  scoreRecoveryPassword,
  isAcceptableRecoveryPassword,
  MIN_RECOVERY_PASSWORD_LENGTH,
} from './recoveryPasswordStrength';

describe('recoveryPasswordStrength', () => {
  it('rejects an empty password', () => {
    expect(isAcceptableRecoveryPassword('')).toBe(false);
    expect(scoreRecoveryPassword('').score).toBe(0);
  });

  it('rejects anything shorter than the minimum, however varied', () => {
    // 11 chars, all four classes present, still under the floor.
    const almost = 'Ab1!Ab1!Ab' + '2'; // length 11
    expect(almost.length).toBe(MIN_RECOVERY_PASSWORD_LENGTH - 1);
    expect(isAcceptableRecoveryPassword(almost)).toBe(false);
  });

  it('rejects the weakest tier at/above the length floor (single character class)', () => {
    const longButFlat = 'aaaaaaaaaaaaaa'; // 14 lowercase-only
    expect(longButFlat.length).toBeGreaterThanOrEqual(MIN_RECOVERY_PASSWORD_LENGTH);
    const res = scoreRecoveryPassword(longButFlat);
    expect(res.score).toBeLessThan(2);
    expect(res.acceptable).toBe(false);
    expect(isAcceptableRecoveryPassword(longButFlat)).toBe(false);
  });

  it('accepts a 12+ char password with mixed character classes', () => {
    const good = 'Recover-Me-42';
    expect(good.length).toBeGreaterThanOrEqual(MIN_RECOVERY_PASSWORD_LENGTH);
    expect(isAcceptableRecoveryPassword(good)).toBe(true);
    expect(scoreRecoveryPassword(good).score).toBeGreaterThanOrEqual(2);
  });

  it('scores a long, all-classes password at the top tier', () => {
    expect(scoreRecoveryPassword('Sup3r-Secret-Recovery-Phrase!').score).toBe(4);
  });

  it('always returns a label key for its score', () => {
    for (const pw of ['', 'a', 'Recover-Me-42', 'Sup3r-Secret-Recovery-Phrase!']) {
      expect(scoreRecoveryPassword(pw).labelKey).toMatch(/^welcome\.recoveryStrength/);
    }
  });
});

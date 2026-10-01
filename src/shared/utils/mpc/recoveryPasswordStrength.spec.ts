import { describe, it, expect } from 'vitest';
import {
  scoreRecoveryPassword,
  isAcceptableRecoveryPassword,
  MIN_RECOVERY_PASSWORD_LENGTH,
  isCommonRecoveryPattern,
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
    const good = 'Kestrel.Moss.Lantern.9';
    expect(good.length).toBeGreaterThanOrEqual(MIN_RECOVERY_PASSWORD_LENGTH);
    expect(isAcceptableRecoveryPassword(good)).toBe(true);
    expect(scoreRecoveryPassword(good).score).toBeGreaterThanOrEqual(2);
  });

  it('accepts exactly 12 chars with two character classes', () => {
    const exact = 'tqmzvbrkwp47'; // 12 chars, lower + digit, no pattern
    expect(exact.length).toBe(MIN_RECOVERY_PASSWORD_LENGTH);
    expect(isAcceptableRecoveryPassword(exact)).toBe(true);
  });

  it('rejects 11 chars even with mixed character classes', () => {
    const short = 'abcdefghi12'; // 11 chars, lower + digit
    expect(short.length).toBe(MIN_RECOVERY_PASSWORD_LENGTH - 1);
    expect(isAcceptableRecoveryPassword(short)).toBe(false);
  });

  it('never accepts a single character class, no matter how long (D3 custody gate)', () => {
    // Regression: length-only signals (>=8, >=16 buckets) used to be able to
    // reach the acceptance threshold on their own with zero class variety.
    expect(isAcceptableRecoveryPassword('a'.repeat(16))).toBe(false);
    expect(isAcceptableRecoveryPassword('a'.repeat(20))).toBe(false);
    expect(isAcceptableRecoveryPassword('1'.repeat(16))).toBe(false);
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

describe('common recovery-password patterns (offline-crack resistance)', () => {
  // Every one of these clears the length + two-class floor on its own.
  const guessable = [
    'Password1234', 'P@ssw0rd2024!', 'MyPassword2024', 'Cardano12345', 'Qwerty123456!',
    'Gero-Wallet-2024', 'Wallet-Backup-2025', 'Welcome2Gero!', 'Recover-Me-42',
    'Abcdefgh1234', 'abcdefghij12', '12345678901!', 'Aaaa1111aaaa', 'Ab1!Ab1!Ab1!Ab1!',
  ];
  it.each(guessable)('refuses %s and caps it at the weakest tier', (pw) => {
    expect(pw.length).toBeGreaterThanOrEqual(MIN_RECOVERY_PASSWORD_LENGTH);
    expect(isCommonRecoveryPattern(pw)).toBe(true);
    expect(isAcceptableRecoveryPassword(pw)).toBe(false);
    expect(scoreRecoveryPassword(pw).score).toBeLessThanOrEqual(1);
  });

  const fine = ['tqmzvbrkwp47', 'Kestrel.Moss.Lantern.9', 'correct-horse-battery-staple', '8#4!9$2&7*1@', 'Sup3r-Secret-Recovery-Phrase!'];
  it.each(fine)('accepts %s', (pw) => {
    expect(isCommonRecoveryPattern(pw)).toBe(false);
    expect(isAcceptableRecoveryPassword(pw)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { formatPan, isValidPan, panDigits, pinProblem } from './cardSecrets';

describe('card number input', () => {
  it('keeps digits only, at most 19', () => {
    expect(panDigits('5375 2410-8805 4121')).toBe('5375241088054121');
    expect(panDigits('1'.repeat(25))).toHaveLength(19);
  });

  it('groups digits in fours', () => {
    expect(formatPan('5375241088054121')).toBe('5375 2410 8805 4121');
    expect(formatPan('53752')).toBe('5375 2');
  });

  it('accepts 16-19 digits that pass the Luhn check', () => {
    expect(isValidPan('4111111111111111')).toBe(true);
    expect(isValidPan('5555555555554444')).toBe(true);
    expect(isValidPan('4111111111111112')).toBe(false);
    expect(isValidPan('411111111111111')).toBe(false);
    expect(isValidPan('41111111111111111111')).toBe(false);
  });
});

describe('pinProblem', () => {
  it('needs exactly four digits', () => {
    expect(pinProblem('123', '123')).toBe('length');
    expect(pinProblem('12a4', '12a4')).toBe('length');
  });

  it('refuses repeated digits and straight runs', () => {
    for (const pin of ['0000', '7777', '1234', '6789', '9876', '3210']) {
      expect(pinProblem(pin, pin)).toBe('weak');
    }
  });

  it('needs the confirmation to match', () => {
    expect(pinProblem('2580', '2581')).toBe('mismatch');
    expect(pinProblem('2580', '2580')).toBeNull();
    expect(pinProblem('1357', '1357')).toBeNull();
  });
});

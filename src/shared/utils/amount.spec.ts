import { describe, it, expect } from 'vitest';
import { decimalToBaseUnits, baseUnitsToDecimalString } from './amount';

describe('decimalToBaseUnits', () => {
  // The defect #933 was filed for: Math.floor(Number(x) * 10 ** d) lands just
  // under an integer for these inputs and silently under-sends one unit.
  it.each([
    ['0.29', 2, '29'],
    ['0.57', 2, '57'],
    ['0.58', 2, '58'],
    ['1.001', 6, '1001000'],
    ['1.005', 6, '1005000'],
    ['0.009', 8, '900000'],
    ['0.018', 8, '1800000'],
    ['0.036', 8, '3600000'],
  ])('converts %s at %i decimals without float drift', (amount, decimals, expected) => {
    expect(decimalToBaseUnits(amount, decimals).toString()).toBe(expected);
    // Guard the regression directly: the old expression really is wrong here
    expect(Math.floor(Number(amount) * Math.pow(10, decimals)).toString()).not.toBe(expected);
  });

  it('truncates beyond the token precision rather than rounding up', () => {
    expect(decimalToBaseUnits('1.9999', 2)).toBe(BigInt(199));
    expect(decimalToBaseUnits('0.999999999', 6)).toBe(BigInt(999999));
  });

  it('keeps integer precision above 2^53', () => {
    expect(decimalToBaseUnits('9007199254740993', 0)).toBe(BigInt('9007199254740993'));
    expect(decimalToBaseUnits('123456789012345678901234567890', 0).toString())
      .toBe('123456789012345678901234567890');
  });

  it('normalizes scientific notation', () => {
    expect(decimalToBaseUnits('1e-7', 8)).toBe(BigInt(10));
    // Collectible quantities arrive as numbers straight off the UTxO scan and
    // large ones stringify to exponent form — the sweep netting relies on this.
    expect(decimalToBaseUnits(1e21, 0)).toBe(BigInt('1000000000000000000000'));
  });

  it('accepts grouped input and plain numbers', () => {
    expect(decimalToBaseUnits('1,234.5', 2)).toBe(BigInt(123450));
    expect(decimalToBaseUnits(0.29, 2)).toBe(BigInt(29));
  });

  it('handles negatives and pads short fractions', () => {
    expect(decimalToBaseUnits('-0.29', 2)).toBe(BigInt(-29));
    expect(decimalToBaseUnits('1.5', 6)).toBe(BigInt(1500000));
  });

  it('yields 0n for empty, null and non-numeric input', () => {
    expect(decimalToBaseUnits('', 6)).toBe(BigInt(0));
    expect(decimalToBaseUnits(null, 6)).toBe(BigInt(0));
    expect(decimalToBaseUnits(undefined, 6)).toBe(BigInt(0));
    expect(decimalToBaseUnits('abc', 6)).toBe(BigInt(0));
  });
});

describe('baseUnitsToDecimalString', () => {
  it('shifts the point without float division', () => {
    expect(baseUnitsToDecimalString(BigInt(29), 2)).toBe('0.29');
    expect(baseUnitsToDecimalString(BigInt(900000), 8)).toBe('0.009');
    expect(baseUnitsToDecimalString(BigInt(1005000), 6)).toBe('1.005');
  });

  it('trims trailing fractional zeros but keeps the whole part', () => {
    expect(baseUnitsToDecimalString(BigInt(1500000), 6)).toBe('1.5');
    expect(baseUnitsToDecimalString(BigInt(1000000), 6)).toBe('1');
    expect(baseUnitsToDecimalString(BigInt(0), 6)).toBe('0');
  });

  it('handles zero decimals and negatives', () => {
    expect(baseUnitsToDecimalString(BigInt(42), 0)).toBe('42');
    expect(baseUnitsToDecimalString(BigInt(-29), 2)).toBe('-0.29');
  });

  it('survives quantities above 2^53', () => {
    expect(baseUnitsToDecimalString(BigInt('9007199254740993'), 0)).toBe('9007199254740993');
  });

  it('round-trips every #933 case', () => {
    for (const [amount, decimals] of [['0.29', 2], ['0.009', 8], ['1.005', 6]] as [string, number][]) {
      expect(baseUnitsToDecimalString(decimalToBaseUnits(amount, decimals), decimals)).toBe(amount);
    }
  });
});

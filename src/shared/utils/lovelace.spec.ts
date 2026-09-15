import { describe, it, expect } from 'vitest';
import { toLovelace, compareLovelace, pctOf, sumLovelace } from '@/shared/utils/lovelace';

describe('toLovelace', () => {
  it('parses a decimal string without precision loss above MAX_SAFE_INTEGER', () => {
    // 25,000,000,000,000,000 lovelace = 25bn ADA, well past Number.MAX_SAFE_INTEGER
    expect(toLovelace('25000000000000001')).toBe(25000000000000001n);
  });

  it('accepts number and bigint inputs', () => {
    expect(toLovelace(42)).toBe(42n);
    expect(toLovelace(42n)).toBe(42n);
  });

  it('returns 0n for null, undefined and empty string', () => {
    expect(toLovelace(null)).toBe(0n);
    expect(toLovelace(undefined)).toBe(0n);
    expect(toLovelace('')).toBe(0n);
  });

  it('returns 0n for a non-numeric string rather than throwing', () => {
    expect(toLovelace('not-a-number')).toBe(0n);
  });

  it('truncates a fractional number input rather than throwing', () => {
    expect(toLovelace(42.9)).toBe(42n);
  });
});

describe('compareLovelace', () => {
  it('orders two values past MAX_SAFE_INTEGER correctly', () => {
    // Both round to the same Number; only BigInt can tell them apart.
    expect(compareLovelace('9007199254740993', '9007199254740992')).toBe(1);
    expect(compareLovelace('9007199254740992', '9007199254740993')).toBe(-1);
    expect(compareLovelace('9007199254740992', '9007199254740992')).toBe(0);
  });
});

describe('pctOf', () => {
  it('computes a percentage with two decimals without float drift', () => {
    expect(pctOf('1', '3')).toBe(33.33);
  });

  it('is exact for huge denominators', () => {
    expect(pctOf('12500000000000000', '25000000000000000')).toBe(50);
  });

  it('returns 0 when the denominator is zero', () => {
    expect(pctOf('5', '0')).toBe(0);
  });
});

describe('sumLovelace', () => {
  it('sums past MAX_SAFE_INTEGER exactly', () => {
    expect(sumLovelace(['9007199254740992', '9007199254740992'])).toBe(18014398509481984n);
  });

  it('returns 0n for an empty list', () => {
    expect(sumLovelace([])).toBe(0n);
  });
});

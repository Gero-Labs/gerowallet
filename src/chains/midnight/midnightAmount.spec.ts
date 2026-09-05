import { describe, expect, it } from 'vitest';
import {
  formatTokenAmount,
  parseTokenAmount,
  toAmountInput,
  tokenDivisor,
} from './midnightAmount';

const NIGHT_DECIMALS = 6;
const USDM_DECIMALS = 6;

describe('tokenDivisor', () => {
  it('scales by the exponent', () => {
    expect(tokenDivisor(6)).toBe(1_000_000n);
    expect(tokenDivisor(0)).toBe(1n);
  });

  it('treats unknown decimals as unscaled', () => {
    expect(tokenDivisor(null)).toBe(1n);
  });
});

describe('parseTokenAmount', () => {
  it('scales a decimal amount into base units', () => {
    expect(parseTokenAmount('5', NIGHT_DECIMALS)).toBe(5_000_000n);
    expect(parseTokenAmount('5.25', USDM_DECIMALS)).toBe(5_250_000n);
    expect(parseTokenAmount('0.000001', USDM_DECIMALS)).toBe(1n);
  });

  it('pads a short fraction rather than misreading it', () => {
    // '.5' is half, not five base units.
    expect(parseTokenAmount('1.5', 6)).toBe(1_500_000n);
    expect(parseTokenAmount('1.05', 6)).toBe(1_050_000n);
  });

  it('truncates excess precision instead of rounding up', () => {
    // Rounding up would spend more than the user typed.
    expect(parseTokenAmount('1.9999999', 6)).toBe(1_999_999n);
    expect(parseTokenAmount('0.9999999999', 2)).toBe(99n);
  });

  it('treats an UNKNOWN exponent as raw base units, never as NIGHT', () => {
    // The bug this guards: defaulting unknown decimals to 6 turns a request
    // for 5 base units into 5,000,000 of them.
    expect(parseTokenAmount('5', null)).toBe(5n);
    expect(parseTokenAmount('5', 6)).toBe(5_000_000n);
  });

  it('drops a fractional part when there are no decimal places', () => {
    // 0.5 of an indivisible unit is not representable; it must not become 5.
    expect(parseTokenAmount('1.5', null)).toBe(1n);
    expect(parseTokenAmount('1.9', 0)).toBe(1n);
  });

  it('rejects exponential notation rather than accepting it as a number', () => {
    // Load-bearing: <input type="number"> accepts '1e2' and Number('1e2') is
    // 100, so callers must gate positivity on THIS function, not Number().
    // Treating it as 100 here would silently scale by the wrong magnitude.
    expect(parseTokenAmount('1e2', 6)).toBe(0n);
    expect(parseTokenAmount('1e-6', 6)).toBe(0n);
    expect(parseTokenAmount('1E2', 6)).toBe(0n);
  });

  it('truncates an amount below one base unit to zero', () => {
    // The caller must reject this: Number() calls it positive, but there is no
    // representable amount here and the tx would move 0.
    expect(parseTokenAmount('0.0000001', 6)).toBe(0n);
  });

  it('rejects signs, whitespace and separators', () => {
    expect(parseTokenAmount('-1', 6)).toBe(0n);
    expect(parseTokenAmount('+1', 6)).toBe(0n);
    expect(parseTokenAmount('1 000', 6)).toBe(0n);
    expect(parseTokenAmount('1,000', 6)).toBe(0n);
  });

  it('returns 0n for empty, blank and unparseable input', () => {
    expect(parseTokenAmount('', 6)).toBe(0n);
    expect(parseTokenAmount('   ', 6)).toBe(0n);
    expect(parseTokenAmount('abc', 6)).toBe(0n);
    expect(parseTokenAmount('1.2.3', 6)).toBe(0n);
  });

  it('handles a bare decimal point form', () => {
    expect(parseTokenAmount('.5', 6)).toBe(500_000n);
  });

  it('carries amounts beyond Number.MAX_SAFE_INTEGER exactly', () => {
    // The whole point of bigint here: float maths would corrupt this.
    expect(parseTokenAmount('9007199254740993', 6)).toBe(9_007_199_254_740_993_000_000n);
  });
});

describe('formatTokenAmount', () => {
  it('renders two fraction digits by default', () => {
    expect(formatTokenAmount(5_250_000n, 6)).toBe('5.25');
    expect(formatTokenAmount(5_000_000n, 6)).toBe('5.00');
  });

  it('groups thousands', () => {
    expect(formatTokenAmount(1_234_567_000_000n, 6)).toBe('1,234,567.00');
  });

  it('renders unknown decimals as a plain integer with no point', () => {
    expect(formatTokenAmount(5_000_000n, null)).toBe('5,000,000');
  });

  it('does not round the hidden digits up', () => {
    expect(formatTokenAmount(1_999_999n, 6)).toBe('1.99');
  });
});

describe('toAmountInput', () => {
  it('drops trailing zeros and the point for whole amounts', () => {
    expect(toAmountInput(5_000_000n, 6)).toBe('5');
    expect(toAmountInput(5_250_000n, 6)).toBe('5.25');
  });

  it('keeps full precision for the smallest unit', () => {
    expect(toAmountInput(1n, 6)).toBe('0.000001');
  });

  it('renders raw units when decimals are unknown', () => {
    expect(toAmountInput(1234n, null)).toBe('1234');
  });

  it('round-trips through parseTokenAmount', () => {
    for (const [value, decimals] of [
      [5_250_000n, 6],
      [1n, 6],
      [9_999_999n, 6],
      [1234n, null],
      [0n, 6],
    ] as Array<[bigint, number | null]>) {
      expect(parseTokenAmount(toAmountInput(value, decimals), decimals)).toBe(value);
    }
  });
});

/**
 * Amount scaling for Midnight tokens.
 *
 * Pure and dependency-free so it can be tested directly — this is the code
 * that decides how much money leaves the wallet, and it used to live inline in
 * a 1500-line dialog where nothing could reach it.
 *
 * `decimals === null` means the exponent is genuinely UNKNOWN (the colour
 * isn't in the registry), not "zero". Amounts are then entered and shown as
 * raw base units and the UI says so. Defaulting an unknown token to NIGHT's 6
 * would send 1,000,000x the intended amount for a 0-decimal token.
 */

/** Divisor for a decimal exponent. Unknown/zero decimals scale by 1. */
export function tokenDivisor(decimals: number | null): bigint {
  return 10n ** BigInt(decimals ?? 0);
}

/**
 * Parse user input into base units for a token with `decimals`.
 *
 * Truncates rather than rounds: a user typing more precision than the token
 * has is asking for something unrepresentable, and rounding UP would spend
 * more than they typed. Returns 0n for anything unparseable so callers can
 * treat "invalid" and "zero" alike (the amount rules reject both).
 */
export function parseTokenAmount(input: string, decimals: number | null): bigint {
  if (!input) return 0n;
  const trimmed = input.trim();
  if (!trimmed) return 0n;
  // Reject anything that is not a plain decimal. The previous inline version
  // destructured split('.') into two parts, so '1.2.3' silently parsed as 1.2
  // — a malformed amount must not become a plausible one.
  if (!/^[0-9]*\.?[0-9]*$/.test(trimmed)) return 0n;
  const exponent = decimals ?? 0;
  const [whole = '0', fractionRaw = ''] = trimmed.split('.');
  // With no fractional places, anything after the point is meaningless — drop
  // it rather than let it slide into the whole part.
  const fraction = exponent === 0
    ? '0'
    : (fractionRaw + '0'.repeat(exponent)).slice(0, exponent);
  try {
    return BigInt(whole || '0') * tokenDivisor(decimals) + BigInt(fraction || '0');
  } catch {
    return 0n;
  }
}

/**
 * Render base units for display. `fractionDigits` caps the visible decimals
 * (default 2, matching the balance row); pass `null` decimals to render the
 * raw integer with no point at all.
 */
export function formatTokenAmount(
  value: bigint,
  decimals: number | null,
  fractionDigits = 2,
): string {
  const divisor = tokenDivisor(decimals);
  if (divisor === 1n) return value.toLocaleString('en-US');
  const whole = value / divisor;
  const remainder = value % divisor;
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

/**
 * Full-precision decimal string for prefilling an input (the MAX button).
 * Trailing zeros are stripped so the field reads the way a person would type
 * it, and an exact whole number has no decimal point.
 */
export function toAmountInput(value: bigint, decimals: number | null): string {
  const divisor = tokenDivisor(decimals);
  if (divisor === 1n) return value.toString();
  const whole = value / divisor;
  const remainder = value % divisor;
  if (remainder === 0n) return whole.toString();
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  return `${whole}.${remainderStr.replace(/0+$/, '')}`;
}

/** Exact BTC string for satoshis (no float rounding), e.g. 123456789n → "1.23456789". */
export function satsToBtcString(sats: bigint): string {
  const negative = sats < 0n;
  const abs = negative ? -sats : sats;
  const whole = abs / 100_000_000n;
  const fraction = (abs % 100_000_000n).toString().padStart(8, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

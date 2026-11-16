/**
 * SOL and SPL amounts. Values are bigint raw units: a u64 can exceed Number.MAX_SAFE_INTEGER,
 * and the wire carries them as decimal strings.
 */

export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
const U64_MAX = (1n << 64n) - 1n;

/** Parses a raw-unit decimal string (as Nexus and gero-sync send it), or throws. */
export function parseRawAmount(raw: string | number | bigint): bigint {
  if (typeof raw === 'bigint') return assertU64(raw);
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) throw new Error('Raw amount must be a safe integer');
    return assertU64(BigInt(raw));
  }
  if (!/^\d+$/.test(raw)) throw new Error('Raw amount must be a non-negative integer string');
  return assertU64(BigInt(raw));
}

/** Formats raw units as a decimal string with trailing zeros trimmed: `1500000000` → `1.5`. */
export function formatUnits(raw: string | number | bigint, decimals: number): string {
  const value = parseRawAmount(raw);
  if (decimals === 0) return value.toString();
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Parses a user-entered decimal amount into raw units. Rejects more decimals than the token has. */
export function parseUnits(input: string, decimals: number): bigint {
  const text = input.trim();
  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') {
    throw new Error('Invalid amount');
  }
  const [whole = '0', fraction = ''] = text.split('.');
  if (fraction.length > decimals) {
    throw new Error(`At most ${decimals} decimal places`);
  }
  const raw = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return assertU64(raw);
}

export function formatSol(lamports: string | number | bigint): string {
  return formatUnits(lamports, SOL_DECIMALS);
}

export function parseSol(input: string): bigint {
  return parseUnits(input, SOL_DECIMALS);
}

function assertU64(value: bigint): bigint {
  if (value < 0n || value > U64_MAX) throw new Error('Amount out of range');
  return value;
}

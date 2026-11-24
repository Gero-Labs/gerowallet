// How the swap screens name and count a token. NIGHT is the chain's own;
// a token listed in Gero's catalog (verified) or built in has a ticker and
// decimals; anything else is shown by its truncated token type, in base units,
// with the "not in Gero's token list" warning: a name a token's issuer chose
// is never shown for it, because anyone can choose any name.

import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { formatTokenAmount, parseTokenAmount, toAmountInput } from '@/chains/midnight/midnightAmount';
import { isNativeNight } from '@/chains/midnight/midnightTokenBalances';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import type { MidnightSwapLeg } from '@/chains/midnight/midnightSwapRecords';

export const NIGHT_TOKEN_TYPE = '00'.repeat(32);

export interface SwapTokenInfo {
  readonly tokenType: string;
  /** Ticker, or the truncated token type for a token in no list. */
  readonly symbol: string;
  /** `null` for a token in no list: amounts are base units. */
  readonly decimals: number | null;
  /** NIGHT, a verified catalog token or a built-in one. */
  readonly listed: boolean;
  readonly isNight: boolean;
  /** One or two letters for the token mark. */
  readonly mark: string;
}

/** `d0c8…399c`. */
export function shortTokenType(tokenType: string): string {
  return tokenType.length > 12 ? `${tokenType.slice(0, 4)}…${tokenType.slice(-4)}` : tokenType;
}

/** The token type in groups of four, `d0c8 0ff1 … 5e60 399c`, for the unlisted warning. */
export function groupedTokenType(tokenType: string): string {
  const groups = tokenType.match(/.{1,4}/g) ?? [tokenType];
  return groups.length > 8 ? [...groups.slice(0, 4), '…', ...groups.slice(-4)].join(' ') : groups.join(' ');
}

export function nightTicker(network: string | null | undefined): string {
  return network === Network.MAINNET ? 'NIGHT' : 'tNIGHT';
}

export function swapTokenInfo(tokenType: string, network: string | null | undefined): SwapTokenInfo {
  const type = tokenType.toLowerCase();
  if (isNativeNight(type)) {
    return { tokenType: NIGHT_TOKEN_TYPE, symbol: nightTicker(network), decimals: MIDNIGHT_DECIMALS.NIGHT, listed: true, isNight: true, mark: 'N' };
  }
  const meta = midnightTokenMeta(type);
  if (meta) return { tokenType: type, symbol: meta.symbol, decimals: meta.decimals, listed: true, isNight: false, mark: meta.symbol.slice(0, 1).toUpperCase() };
  return { tokenType: type, symbol: shortTokenType(type), decimals: null, listed: false, isNight: false, mark: type.slice(0, 1).toUpperCase() };
}

/** Full precision, grouped: `2,000` or `1,240.5`. */
export function swapAmountText(value: bigint, decimals: number | null): string {
  const plain = toAmountInput(value, decimals);
  const [whole, fraction] = plain.split('.');
  const grouped = BigInt(whole).toLocaleString('en-US');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** `100 tNIGHT`. */
export function swapLegText(leg: MidnightSwapLeg, network: string | null | undefined): string {
  const info = swapTokenInfo(leg.tokenType, network);
  return `${swapAmountText(BigInt(leg.amount), info.decimals)} ${info.symbol}`;
}

/** Base units of what the user typed for `info` (0n when not a positive amount). */
export function parseSwapAmount(input: string, info: SwapTokenInfo): bigint {
  return parseTokenAmount(input.replace(/,/g, ''), info.decimals);
}

/** A balance for the "Available" line. */
export function swapBalanceText(value: bigint, info: SwapTokenInfo): string {
  return formatTokenAmount(value, info.decimals, info.decimals === null ? 0 : Math.min(info.decimals, 2));
}

/**
 * How many `quote` one `base` buys at `baseAmount` for `quoteAmount`, for a
 * label (`1 tNIGHT = 20 TTK`): up to six significant digits, never used to
 * compute what moves.
 */
export function swapRateText(base: MidnightSwapLeg, quote: MidnightSwapLeg, network: string | null | undefined): string {
  const b = swapTokenInfo(base.tokenType, network);
  const q = swapTokenInfo(quote.tokenType, network);
  const baseUnits = Number(BigInt(base.amount)) / 10 ** (b.decimals ?? 0);
  const quoteUnits = Number(BigInt(quote.amount)) / 10 ** (q.decimals ?? 0);
  if (!(baseUnits > 0) || !Number.isFinite(quoteUnits)) return '';
  const rate = quoteUnits / baseUnits;
  const shown = rate >= 1e6 ? Math.round(rate).toLocaleString('en-US') : Number(rate.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 6 });
  return `1 ${b.symbol} = ${shown} ${q.symbol}`;
}

/** Whole minutes left, rounded up; 0 once past. */
export function minutesLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

/** `29:42`. */
export function countdownText(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Share of the offer's life still ahead, 0..1, for the time-left bar. */
export function lifeLeftFraction(createdAt: number, expiresAt: number, now: number): number {
  const total = expiresAt - createdAt;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (expiresAt - now) / total));
}
